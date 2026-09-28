import { afterEach, describe, expect, it, vi } from 'vitest';
import { OllamaProvider } from '../core/providers/ollama/OllamaProvider.js';
import { FillInMiddleUnsupportedError } from '../core/providers/FillInMiddle.js';
import { InlineCompletionEngine, type InlineCompletionSettings } from '../core/completion/InlineCompletionEngine.js';

afterEach(() => vi.unstubAllGlobals());

const ndjson = (objects: unknown[]): Response =>
  new Response(objects.map((value) => JSON.stringify(value)).join('\n') + '\n', { status: 200 });

describe('Ollama fill-in-the-middle', () => {
  it('recognizes code models and streams native insertion output', async () => {
    expect(new OllamaProvider().supportsFillInMiddle('qwen2.5-coder:7b')).toBe(true);
    expect(new OllamaProvider().supportsFillInMiddle('llama3.1:8b')).toBe(false);
    let body: Record<string, unknown> | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      body = JSON.parse(init.body as string) as Record<string, unknown>;
      return ndjson([{ response: 'value' }, { response: '', done: true }]);
    }));
    const output: string[] = [];
    await new OllamaProvider().fillInMiddle(
      { model: 'qwen2.5-coder', prefix: 'const x = ', suffix: ';\n', maxTokens: 32 },
      (delta) => output.push(delta)
    );
    expect(body).toMatchObject({ model: 'qwen2.5-coder', prompt: 'const x = ', suffix: ';\n', stream: true });
    expect(output.join('')).toBe('value');
  });

  it('remembers an insert-mode refusal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"does not support insert"}', { status: 400 })));
    const provider = new OllamaProvider();
    await expect(provider.fillInMiddle({ model: 'codellama', prefix: 'a', suffix: '' }, () => undefined))
      .rejects.toBeInstanceOf(FillInMiddleUnsupportedError);
    expect(provider.supportsFillInMiddle('codellama')).toBe(false);
  });
});

describe('inline completion FIM routing', () => {
  const settings: InlineCompletionSettings = {
    maxPrefixChars: 200,
    maxSuffixChars: 100,
    maxTokens: 32,
    maxLines: 6,
    model: 'qwen2.5-coder',
    fillInMiddle: true
  };
  const context = { prefix: 'let value = ', suffix: ';\n', languageId: 'typescript', relativePath: 'a.ts' };

  it('uses FIM and falls back to chat when insert mode is unsupported', async () => {
    const calls: string[] = [];
    const provider = {
      supportsFillInMiddle: () => true,
      fillInMiddle: async () => {
        calls.push('fim');
        throw new FillInMiddleUnsupportedError('qwen2.5-coder');
      },
      stream: async (_request: unknown, onEvent: (event: { type: 'text'; delta: string }) => void) => {
        calls.push('chat');
        onEvent({ type: 'text', delta: 'fallback' });
      }
    };
    const engine = new InlineCompletionEngine({
      provider: async () => provider as never,
      defaultModel: () => 'qwen2.5-coder',
      settings: () => settings
    });
    await expect(engine.complete(context)).resolves.toBe('fallback');
    expect(calls).toEqual(['fim', 'chat']);
  });
});
