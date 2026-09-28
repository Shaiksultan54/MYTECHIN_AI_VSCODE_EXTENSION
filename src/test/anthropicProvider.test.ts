import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnthropicProvider } from '../core/providers/anthropic/AnthropicProvider.js';
import type { AIStreamEvent } from '../core/providers/ProviderTypes.js';

function sse(events: unknown[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      controller.close();
    }
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

function provider(): AnthropicProvider {
  const p = new AnthropicProvider();
  p.configure({ apiKey: 'sk-test' });
  return p;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AnthropicProvider.stream', () => {
  it('emits text deltas and a tool call from native SSE events', async () => {
    let sentBody: any;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        sentBody = JSON.parse(init.body as string);
        return sse([
          { type: 'content_block_start', content_block: { type: 'text' } },
          { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Auth lives in ' } },
          { type: 'content_block_delta', delta: { type: 'text_delta', text: 'AuthService.' } },
          { type: 'content_block_stop' },
          {
            type: 'content_block_start',
            content_block: { type: 'tool_use', id: 'toolu_1', name: 'read_file' }
          },
          {
            type: 'content_block_delta',
            delta: { type: 'input_json_delta', partial_json: '{"path":"src/auth.ts"}' }
          },
          { type: 'content_block_stop' },
          { type: 'message_delta', delta: {}, usage: { output_tokens: 42 } }
        ]);
      })
    );

    const events: AIStreamEvent[] = [];
    await provider().stream(
      { model: 'claude-sonnet-4-6', system: 'You are a coding agent.', messages: [{ role: 'user', content: 'hi' }] },
      (event) => events.push(event)
    );

    const text = events
      .filter((e): e is Extract<AIStreamEvent, { type: 'text' }> => e.type === 'text')
      .map((e) => e.delta)
      .join('');
    expect(text).toBe('Auth lives in AuthService.');

    const call = events.find((e) => e.type === 'tool_call');
    expect(call).toMatchObject({ call: { name: 'read_file', arguments: { path: 'src/auth.ts' } } });
    expect(events.at(-1)?.type).toBe('done');

    // The request itself was well-formed native tool-calling.
    expect(sentBody.stream).toBe(true);
    expect(sentBody.model).toBe('claude-sonnet-4-6');
  });

  it('marks the system prompt as an ephemeral cache breakpoint', async () => {
    let sentBody: any;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        sentBody = JSON.parse(init.body as string);
        return sse([{ type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } }]);
      })
    );

    await provider().stream(
      { model: 'claude-sonnet-4-6', system: 'Long stable system prompt.', messages: [{ role: 'user', content: 'hi' }] },
      () => undefined
    );

    expect(sentBody.system).toEqual([
      { type: 'text', text: 'Long stable system prompt.', cache_control: { type: 'ephemeral' } }
    ]);
  });

  it('marks the last tool definition as a cache breakpoint', async () => {
    let sentBody: any;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        sentBody = JSON.parse(init.body as string);
        return sse([{ type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } }]);
      })
    );

    await provider().stream(
      {
        model: 'claude-sonnet-4-6',
        messages: [{ role: 'user', content: 'hi' }],
        tools: [
          { name: 'read_file', description: 'Reads a file', parameters: {} },
          { name: 'write_file', description: 'Writes a file', parameters: {} }
        ]
      },
      () => undefined
    );

    expect(sentBody.tools[0].cache_control).toBeUndefined();
    expect(sentBody.tools[1].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('caches the growing transcript prefix but leaves the newest message alone', async () => {
    let sentBody: any;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        sentBody = JSON.parse(init.body as string);
        return sse([{ type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } }]);
      })
    );

    await provider().stream(
      {
        model: 'claude-sonnet-4-6',
        messages: [
          { role: 'user', content: 'first message' },
          { role: 'assistant', content: 'first reply' },
          { role: 'user', content: 'newest message' }
        ]
      },
      () => undefined
    );

    // Three Anthropic-shaped messages come out of the three request messages above.
    const secondToLast = sentBody.messages.at(-2);
    const last = sentBody.messages.at(-1);
    expect(secondToLast.content[0].cache_control).toEqual({ type: 'ephemeral' });
    // The newest message is left as a plain string: untouched, and never cached.
    expect(last.content).toBe('newest message');
  });

  it('refuses to run without a model rather than guessing one', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await expect(
      provider().stream({ model: '', messages: [{ role: 'user', content: 'hi' }] }, () => undefined)
    ).rejects.toMatchObject({ kind: 'not-configured' });
  });

  it('rebuilds parallel tool calls with their own ids and merges the results into one message', async () => {
    let sentBody: any;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        sentBody = JSON.parse(init.body as string);
        return sse([{ type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } }]);
      })
    );

    await provider().stream(
      {
        model: 'claude-sonnet-4-6',
        messages: [
          { role: 'user', content: 'compare a and b' },
          {
            role: 'assistant',
            content:
              'Reading both.\n<tool name="read_file" id="id-a">\n{"path":"a.ts"}\n</tool>\n<tool name="read_file" id="id-b">\n{"path":"b.ts"}\n</tool>'
          },
          { role: 'tool', name: 'read_file', toolCallId: 'id-a', content: 'A contents' },
          { role: 'tool', name: 'read_file', toolCallId: 'id-b', content: 'B contents' },
          { role: 'user', content: 'Continue.' }
        ]
      },
      () => undefined
    );

    const assistant = sentBody.messages[1];
    const uses = assistant.content.filter((b: any) => b.type === 'tool_use');
    expect(uses.map((b: any) => b.id)).toEqual(['id-a', 'id-b']);
    expect(uses[1].input).toEqual({ path: 'b.ts' });

    const results = sentBody.messages[2].content;
    expect(results.map((b: any) => b.tool_use_id)).toEqual(['id-a', 'id-b']);
    expect(sentBody.messages[3].content).toBe('Continue.');
  });

  it('still handles single-call transcripts saved before ids existed', async () => {
    let sentBody: any;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        sentBody = JSON.parse(init.body as string);
        return sse([{ type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } }]);
      })
    );

    await provider().stream(
      {
        model: 'claude-sonnet-4-6',
        messages: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: '<tool name="get_problems">\n{}\n</tool>' },
          { role: 'tool', name: 'get_problems', content: 'none' }
        ]
      },
      () => undefined
    );

    const use = sentBody.messages[1].content.find((b: any) => b.type === 'tool_use');
    expect(sentBody.messages[2].content[0].tool_use_id).toBe(use.id);
  });
});

