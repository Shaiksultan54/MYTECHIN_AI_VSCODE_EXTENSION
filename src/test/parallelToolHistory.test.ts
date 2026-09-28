import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAICompatibleProvider } from '../core/providers/openai-compatible/OpenAICompatibleProvider.js';
import { OllamaProvider } from '../core/providers/ollama/OllamaProvider.js';

function sse(lines: string[]): Response {
  return new Response(lines.map((l) => `${l}\n\n`).join(''), { status: 200 });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const history = [
  { role: 'user' as const, content: 'compare a and b' },
  {
    role: 'assistant' as const,
    content:
      'Reading both.\n<tool name="read_file" id="id-a">\n{"path":"a.ts"}\n</tool>\n<tool name="read_file" id="id-b">\n{"path":"b.ts"}\n</tool>'
  },
  { role: 'tool' as const, name: 'read_file', toolCallId: 'id-a', content: 'A contents' },
  { role: 'tool' as const, name: 'read_file', toolCallId: 'id-b', content: 'B contents' }
];

describe('parallel tool history: OpenAI-compatible', () => {
  it('sends one assistant message with every tool_call and pairs each result by id', async () => {
    let sent: any;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init: RequestInit) => {
        sent = JSON.parse(init.body as string);
        return sse(['data: [DONE]']);
      })
    );
    const p = new OpenAICompatibleProvider();
    p.configure({ apiKey: 'k', baseUrl: 'https://example.test/v1' });
    await p.stream({ model: 'm', messages: history }, () => undefined);

    const assistant = sent.messages[1];
    expect(assistant.tool_calls.map((c: any) => c.id)).toEqual(['id-a', 'id-b']);
    expect(assistant.tool_calls[1].function.name).toBe('read_file');
    expect(sent.messages[2]).toMatchObject({ role: 'tool', tool_call_id: 'id-a' });
    expect(sent.messages[3]).toMatchObject({ role: 'tool', tool_call_id: 'id-b' });
  });

  it('emits every tool_call the model streams back, not just the first', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sse([
          'data: ' +
            JSON.stringify({
              choices: [
                {
                  delta: {
                    tool_calls: [
                      { index: 0, id: 'x', function: { name: 'read_file', arguments: '{"path":"a"}' } },
                      { index: 1, id: 'y', function: { name: 'search_code', arguments: '{"query":"q"}' } }
                    ]
                  },
                  finish_reason: 'tool_calls'
                }
              ]
            }),
          'data: [DONE]'
        ])
      )
    );
    const p = new OpenAICompatibleProvider();
    p.configure({ apiKey: 'k', baseUrl: 'https://example.test/v1' });
    const calls: string[] = [];
    await p.stream({ model: 'm', messages: [{ role: 'user', content: 'go' }] }, (e) => {
      if (e.type === 'tool_call') calls.push(e.call.id);
    });
    expect(calls).toEqual(['x', 'y']);
  });
});

describe('parallel tool history: Ollama', () => {
  it('sends every tool call in one assistant message', async () => {
    let sent: any;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        sent = JSON.parse(init.body as string);
        return new Response('{"done":true}\n', { status: 200 });
      })
    );
    await new OllamaProvider().stream({ model: 'qwen2.5-coder', messages: history }, () => undefined);

    const assistant = sent.messages.find((m: any) => m.role === 'assistant');
    expect(assistant.tool_calls).toHaveLength(2);
    expect(assistant.tool_calls[1].function.arguments).toEqual({ path: 'b.ts' });
    expect(sent.messages.filter((m: any) => m.role === 'tool')).toHaveLength(2);
  });
});
