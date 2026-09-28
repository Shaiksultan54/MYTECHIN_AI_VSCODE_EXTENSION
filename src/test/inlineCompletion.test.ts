import { describe, expect, it } from 'vitest';
import {
  InlineCompletionEngine,
  buildPrompt,
  cleanCompletion,
  isMidLine,
  trimContext,
  type CompletionContext,
  type InlineCompletionSettings
} from '../core/completion/InlineCompletionEngine.js';
import { ProviderError, type AIStreamEvent } from '../core/providers/ProviderTypes.js';

const settings: InlineCompletionSettings = {
  maxPrefixChars: 200,
  maxSuffixChars: 100,
  maxTokens: 64,
  maxLines: 6,
  model: '',
  fillInMiddle: false
};

function ctx(prefix: string, suffix = '', extra: Partial<CompletionContext> = {}): CompletionContext {
  return { prefix, suffix, languageId: 'typescript', relativePath: 'src/a.ts', ...extra };
}

describe('trimContext', () => {
  it('keeps short text untouched', () => {
    expect(trimContext('abc', 10, 'end')).toBe('abc');
  });
  it('keeps the end and starts on a line boundary', () => {
    const text = 'line one\nline two\nline three';
    expect(trimContext(text, 15, 'end')).toBe('line three');
  });
  it('keeps the start and ends on a line boundary', () => {
    const text = 'line one\nline two\nline three';
    expect(trimContext(text, 15, 'start')).toBe('line one');
  });
});

describe('buildPrompt', () => {
  it('places the cursor marker between prefix and suffix and names the file', () => {
    const { user, system } = buildPrompt(ctx('const a = ', ';\n'), settings);
    expect(user).toContain('src/a.ts (typescript)');
    expect(user).toContain('const a = <CURSOR>;\n');
    expect(system).toContain('ONLY the text to insert');
  });
});

describe('cleanCompletion', () => {
  it('strips markdown fences', () => {
    expect(cleanCompletion('```ts\nreturn 1;\n```', ctx('function f() {\n  '))).toBe('return 1;');
  });

  it('removes a repeated copy of what was already typed on the line', () => {
    expect(cleanCompletion('const total = items.length', ctx('  const total = '))).toBe('items.length');
  });

  it('does not treat a short coincidental overlap as an echo', () => {
    expect(cleanCompletion('(x)', ctx('foo('))).toBe('(x)');
  });

  it('completes only the current line when code follows the cursor', () => {
    expect(cleanCompletion('a + b);\nconsole.log(1)', ctx('add(', ')\nnext'))).toBe('a + b');
  });

  it('drops closing brackets the file already has, when the completion is unbalanced', () => {
    expect(cleanCompletion('x)', ctx('bar(', ')'))).toBe('x');
  });

  it('keeps a balanced call in front of an existing closer', () => {
    expect(cleanCompletion('foo()', ctx('bar(', ')'))).toBe('foo()');
  });

  it('caps the number of lines', () => {
    const many = Array.from({ length: 30 }, (_, i) => `line${i}`).join('\n');
    expect(cleanCompletion(many, ctx('\n'), 5).split('\n')).toHaveLength(5);
  });

  it('returns nothing for empty or whitespace-only output', () => {
    expect(cleanCompletion('  \n ', ctx('x'))).toBe('');
  });

  it('returns nothing when the text is already right after the cursor', () => {
    expect(cleanCompletion('return 1;', ctx('  ', 'return 1;\n}'))).toBe('');
  });

  it('strips an echoed cursor marker', () => {
    expect(cleanCompletion('foo<CURSOR>bar', ctx('x = '))).toBe('foobar');
  });
});

describe('isMidLine', () => {
  it('detects code after the cursor on the same line', () => {
    expect(isMidLine(')\nnext')).toBe(true);
    expect(isMidLine('\nnext line')).toBe(false);
    expect(isMidLine('   \nnext')).toBe(false);
  });
});

interface FakeOptions {
  chunks?: string[];
  fail?: Error;
  hang?: boolean;
}

function fakeProvider(options: FakeOptions) {
  const calls: any[] = [];
  return {
    calls,
    provider: {
      async stream(req: any, onEvent: (e: AIStreamEvent) => void) {
        calls.push(req);
        if (options.fail) throw options.fail;
        if (req.signal?.aborted) throw new ProviderError('aborted', 'x');
        if (options.hang) {
          await new Promise<void>((_, reject) =>
            req.signal.addEventListener('abort', () => reject(new ProviderError('aborted', 'x')))
          );
        }
        for (const chunk of options.chunks ?? []) {
          if (req.signal?.aborted) throw new ProviderError('aborted', 'x');
          onEvent({ type: 'text', delta: chunk });
        }
        onEvent({ type: 'done', finishReason: 'stop' });
      }
    } as any
  };
}

function engine(options: FakeOptions, extra: { model?: string; now?: () => number } = {}) {
  const fake = fakeProvider(options);
  const e = new InlineCompletionEngine({
    provider: async () => fake.provider,
    defaultModel: () => extra.model ?? 'chat-model',
    settings: () => settings,
    now: extra.now
  });
  return { e, fake };
}

describe('InlineCompletionEngine', () => {
  it('streams a completion and cleans it', async () => {
    const { e, fake } = engine({ chunks: ['```ts\n', 'items.', 'length\n```'] });
    expect(await e.complete(ctx('const n = '))).toBe('items.length');
    expect(fake.calls[0].model).toBe('chat-model');
    expect(fake.calls[0].tools).toBeUndefined();
    expect(fake.calls[0].maxTokens).toBe(64);
  });

  it('prefers the dedicated completion model when configured', async () => {
    const fake = fakeProvider({ chunks: ['x'] });
    const e = new InlineCompletionEngine({
      provider: async () => fake.provider,
      defaultModel: () => 'chat-model',
      settings: () => ({ ...settings, model: 'fast-model' })
    });
    await e.complete(ctx('a'));
    expect(fake.calls[0].model).toBe('fast-model');
  });

  it('serves repeated identical contexts from cache without calling the model', async () => {
    const { e, fake } = engine({ chunks: ['value'] });
    await e.complete(ctx('let a = '));
    expect(await e.complete(ctx('let a = '))).toBe('value');
    expect(fake.calls).toHaveLength(1);
  });

  it('stops paying for output once a mid-line completion has a full line', async () => {
    const { e } = engine({ chunks: ['first);', '\nsecond', '\nthird', '\nfourth'] });
    expect(await e.complete(ctx('call(', ')\nrest'))).toBe('first');
  });

  it('returns nothing and pauses after a provider failure, then recovers', async () => {
    let clock = 1000;
    const { e, fake } = engine({ fail: new ProviderError('unavailable', 'down', undefined, true) }, { now: () => clock });
    expect(await e.complete(ctx('a'))).toBe('');
    expect(e.paused).toBe(true);

    expect(await e.complete(ctx('b'))).toBe('');
    expect(fake.calls).toHaveLength(1); // paused: no second request

    clock += 31_000;
    expect(e.paused).toBe(false);
    await e.complete(ctx('c'));
    expect(fake.calls).toHaveLength(2);
  });

  it('does not call the model at all when already cancelled', async () => {
    const { e, fake } = engine({ chunks: ['x'] });
    const controller = new AbortController();
    const pending = e.complete(ctx('a'), controller.signal);
    controller.abort();
    expect(await pending).toBe('');
    expect(fake.calls).toHaveLength(0);
    expect(e.paused).toBe(false);
  });

  it('treats a mid-flight cancellation as neither a failure nor a cacheable result', async () => {
    const { e, fake } = engine({ hang: true });
    const controller = new AbortController();
    const pending = e.complete(ctx('a'), controller.signal);
    await new Promise((r) => setTimeout(r, 5));
    controller.abort();
    expect(await pending).toBe('');
    expect(e.paused).toBe(false);
    expect(fake.calls).toHaveLength(1);
  });

  it('aborts the previous in-flight request when a new one starts', async () => {
    const { e, fake } = engine({ hang: true });
    const first = e.complete(ctx('a'));
    await new Promise((r) => setTimeout(r, 5));
    void e.complete(ctx('ab')).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 5));
    expect(fake.calls[0].signal.aborted).toBe(true);
    expect(await first).toBe('');
    e.cancel();
  });

  it('does nothing when no model is available', async () => {
    const { e, fake } = engine({ chunks: ['x'] }, { model: '' });
    expect(await e.complete(ctx('a'))).toBe('');
    expect(fake.calls).toHaveLength(0);
  });
});
