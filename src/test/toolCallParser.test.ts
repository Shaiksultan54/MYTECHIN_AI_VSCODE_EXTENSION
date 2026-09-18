import { describe, expect, it } from 'vitest';
import { ToolCallParser } from '../core/agent/ToolCallParser.js';

/** Feeds a string through the parser one chunk at a time, as a stream would. */
function stream(text: string, chunkSize: number) {
  const parser = new ToolCallParser();
  let visible = '';
  let call: ReturnType<ToolCallParser['push']>['call'];

  for (let i = 0; i < text.length; i += chunkSize) {
    const result = parser.push(text.slice(i, i + chunkSize));
    visible += result.text;
    if (result.call && !call) {
      call = result.call;
      break;
    }
  }

  if (!call) {
    const flushed = parser.flush();
    visible += flushed.text;
    call = flushed.call;
  }

  return { visible, call };
}

describe('ToolCallParser', () => {
  it('passes plain prose straight through', () => {
    const { visible, call } = stream('The auth flow lives in AuthService.', 5);
    expect(visible).toBe('The auth flow lives in AuthService.');
    expect(call).toBeUndefined();
  });

  it('extracts a tool call and keeps the preceding text', () => {
    const { visible, call } = stream(
      'Let me look.\n<tool name="read_file">{"path":"src/auth.ts"}</tool>',
      7
    );
    expect(visible.trim()).toBe('Let me look.');
    expect(call?.name).toBe('read_file');
    expect(call?.arguments).toEqual({ path: 'src/auth.ts' });
  });

  it.each([1, 2, 3, 5, 13, 200])('produces the same result at chunk size %i', (size) => {
    const { call } = stream('ok <tool name="search_code">{"query":"login"}</tool>', size);
    expect(call?.name).toBe('search_code');
    expect(call?.arguments).toEqual({ query: 'login' });
  });

  it('never leaks a partial opening tag into visible text', () => {
    const parser = new ToolCallParser();
    const first = parser.push('Reading now <to');
    expect(first.text).not.toContain('<to');
    expect(first.text.trim()).toBe('Reading now');
  });

  it('recovers text when what looked like a tag was ordinary prose', () => {
    const { visible, call } = stream('Use the <toolbar> element for this.', 4);
    expect(visible).toBe('Use the <toolbar> element for this.');
    expect(call).toBeUndefined();
  });

  it('strips a code fence wrapped around the tool block', () => {
    const { call } = stream(
      '```xml\n<tool name="list_directory">{"path":"src"}</tool>\n```',
      9
    );
    expect(call?.name).toBe('list_directory');
    expect(call?.arguments).toEqual({ path: 'src' });
  });

  it('repairs trailing commas in the argument object', () => {
    const { call } = stream('<tool name="read_file">{"path":"a.ts",}</tool>', 6);
    expect(call?.parseError).toBeUndefined();
    expect(call?.arguments).toEqual({ path: 'a.ts' });
  });

  it('repairs single-quoted JSON', () => {
    const { call } = stream("<tool name=\"read_file\">{'path':'a.ts'}</tool>", 6);
    expect(call?.arguments).toEqual({ path: 'a.ts' });
  });

  it('reports a parse error instead of throwing on unusable arguments', () => {
    const { call } = stream('<tool name="read_file">not json at all</tool>', 6);
    expect(call?.name).toBe('read_file');
    expect(call?.parseError).toBeTruthy();
  });

  it('salvages a tool call truncated mid-stream', () => {
    const parser = new ToolCallParser();
    parser.push('<tool name="read_file">{"path":"src/app.ts"}');
    const flushed = parser.flush();
    expect(flushed.call?.name).toBe('read_file');
    expect(flushed.call?.arguments).toEqual({ path: 'src/app.ts' });
  });

  it('handles an empty argument object', () => {
    const { call } = stream('<tool name="get_problems">{}</tool>', 4);
    expect(call?.name).toBe('get_problems');
    expect(call?.arguments).toEqual({});
  });

  it('keeps multi-line string arguments intact', () => {
    const body = JSON.stringify({ path: 'a.ts', content: 'line one\nline two' });
    const { call } = stream(`<tool name="write_file">${body}</tool>`, 11);
    expect(call?.arguments).toEqual({ path: 'a.ts', content: 'line one\nline two' });
  });

  it('marks itself finished after a call so later text is ignored', () => {
    const parser = new ToolCallParser();
    parser.push('<tool name="get_problems">{}</tool>');
    expect(parser.finished).toBe(true);
  });
});
