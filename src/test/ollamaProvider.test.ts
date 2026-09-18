import { afterEach, describe, expect, it, vi } from 'vitest';
import { OllamaProvider } from '../core/providers/ollama/OllamaProvider.js';
import { ProviderError, type AIStreamEvent } from '../core/providers/ProviderTypes.js';

/** Builds a Response whose body streams the given lines as NDJSON. */
function ndjson(lines: unknown[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const line of lines) {
        controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
      }
      controller.close();
    }
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } });
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function provider(): OllamaProvider {
  const p = new OllamaProvider();
  p.configure({ endpoint: 'http://127.0.0.1:11434' });
  return p;
}

async function collect(
  p: OllamaProvider,
  model = 'qwen2.5-coder:7b'
): Promise<AIStreamEvent[]> {
  const events: AIStreamEvent[] = [];
  await p.stream({ model, messages: [{ role: 'user', content: 'hi' }] }, (event) =>
    events.push(event)
  );
  return events;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OllamaProvider.listModels', () => {
  it('maps tags to model info and flags tool-capable models', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          models: [
            { name: 'qwen2.5-coder:7b', details: { parameter_size: '7B' } },
            { name: 'tinyllama:latest' }
          ]
        })
      )
    );

    const models = await provider().listModels();
    expect(models).toHaveLength(2);
    expect(models[0].id).toBe('qwen2.5-coder:7b');
    expect(models[0].name).toContain('7B');
    expect(models[0].supportsTools).toBe(true);
    expect(models[1].supportsTools).toBe(false);
  });

  it('returns an empty list when Ollama has no models', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({})));
    await expect(provider().listModels()).resolves.toEqual([]);
  });
});

describe('OllamaProvider.testConnection', () => {
  it('reports connected when the server responds and has models', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/api/version')
          ? json({ version: '0.3.0' })
          : json({ models: [{ name: 'qwen2.5-coder:7b' }] })
      )
    );

    const status = await provider().testConnection();
    expect(status.state).toBe('connected');
    expect(status.message).toContain('0.3.0');
  });

  it('explains what to do when the server is up but empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/api/version') ? json({ version: '0.3.0' }) : json({ models: [] })
      )
    );

    const status = await provider().testConnection();
    expect(status.state).toBe('error');
    expect(status.message).toContain('ollama pull');
  });

  it('does not throw when Ollama is not running', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('fetch failed: ECONNREFUSED');
      })
    );

    const status = await provider().testConnection();
    expect(status.state).toBe('error');
    expect(status.message).toBeTruthy();
  });
});

describe('OllamaProvider.stream', () => {
  it('emits text deltas in order and finishes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        ndjson([
          { message: { content: 'Auth ' } },
          { message: { content: 'lives in ' } },
          { message: { content: 'AuthService.' } },
          { done: true, done_reason: 'stop', prompt_eval_count: 120, eval_count: 30 }
        ])
      )
    );

    const events = await collect(provider());
    const text = events
      .filter((event): event is Extract<AIStreamEvent, { type: 'text' }> => event.type === 'text')
      .map((event) => event.delta)
      .join('');

    expect(text).toBe('Auth lives in AuthService.');
    expect(events.at(-1)?.type).toBe('done');
  });

  it('reports token usage when the server sends it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ndjson([{ done: true, prompt_eval_count: 120, eval_count: 30 }]))
    );

    const usage = (await collect(provider())).find((event) => event.type === 'usage');
    expect(usage).toMatchObject({ promptTokens: 120, completionTokens: 30 });
  });

  it('surfaces a native tool call', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        ndjson([
          {
            message: {
              tool_calls: [{ function: { name: 'read_file', arguments: { path: 'src/auth.ts' } } }]
            }
          },
          { done: true }
        ])
      )
    );

    const call = (await collect(provider())).find((event) => event.type === 'tool_call');
    expect(call).toMatchObject({ type: 'tool_call' });
    expect((call as { call: { name: string } }).call.name).toBe('read_file');
  });

  it('keeps private reasoning out of the text stream', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        ndjson([
          { message: { thinking: 'The user wants…' } },
          { message: { content: 'Here is the answer.' } },
          { done: true }
        ])
      )
    );

    const events = await collect(provider());
    const text = events
      .filter((event): event is Extract<AIStreamEvent, { type: 'text' }> => event.type === 'text')
      .map((event) => event.delta)
      .join('');

    expect(text).toBe('Here is the answer.');
    expect(events.some((event) => event.type === 'reasoning')).toBe(true);
  });

  it('refuses to run without a model rather than guessing one', async () => {
    vi.stubGlobal('fetch', vi.fn());
    await expect(
      provider().stream({ model: '', messages: [{ role: 'user', content: 'hi' }] }, () => undefined)
    ).rejects.toBeInstanceOf(ProviderError);
  });

  it('maps a missing model to an actionable error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'model not found' }, 404)));

    await expect(collect(provider(), 'not-installed')).rejects.toMatchObject({
      kind: 'model-not-found'
    });
  });

  it('maps a server failure to a retryable error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ error: 'boom' }, 500)));

    await expect(collect(provider())).rejects.toMatchObject({ retryable: true });
  });

  it('tolerates a blank line in the stream', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                const encoder = new TextEncoder();
                controller.enqueue(encoder.encode('{"message":{"content":"a"}}\n\n'));
                controller.enqueue(encoder.encode('{"done":true}\n'));
                controller.close();
              }
            }),
            { status: 200 }
          )
      )
    );

    const events = await collect(provider());
    expect(events.some((event) => event.type === 'text')).toBe(true);
  });
});
