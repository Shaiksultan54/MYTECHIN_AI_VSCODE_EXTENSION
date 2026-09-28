import type { AIProvider } from '../providers/AIProvider.js';
import { ProviderError } from '../providers/ProviderTypes.js';
import { FillInMiddleUnsupportedError, isFillInMiddleCapable } from '../providers/FillInMiddle.js';

export interface CompletionContext {
  /** Text before the cursor (already bounded by the caller). */
  prefix: string;
  /** Text after the cursor (already bounded by the caller). */
  suffix: string;
  languageId: string;
  relativePath: string;
}

export interface InlineCompletionSettings {
  maxPrefixChars: number;
  maxSuffixChars: number;
  maxTokens: number;
  maxLines: number;
  /** Empty means "use the active chat model". */
  model: string;
  fillInMiddle: boolean;
}

export interface EngineDeps {
  provider: () => Promise<AIProvider>;
  /** Model used when the completion-specific model is empty. */
  defaultModel: () => string;
  settings: () => InlineCompletionSettings;
  now?: () => number;
  log?: (message: string) => void;
}

const CURSOR = '<CURSOR>';
const FAILURE_COOLDOWN_MS = 30_000;
const CACHE_LIMIT = 40;

const SYSTEM_PROMPT = [
  'You are a code completion engine inside a code editor.',
  `Continue the code at the ${CURSOR} marker.`,
  'Output ONLY the text to insert at the cursor: no explanation, no markdown fences, no comments about what you did.',
  'Never repeat code that appears before or after the cursor.',
  'Match the surrounding indentation, naming and style.',
  'If the cursor is in the middle of a line, complete only that line.',
  'If nothing sensible belongs at the cursor, output nothing.'
].join('\n');

/** Keeps the end (`'end'`) or start (`'start'`) of `text`, cutting on a line boundary when it can. */
export function trimContext(text: string, max: number, keep: 'end' | 'start'): string {
  if (text.length <= max) {
    return text;
  }
  if (keep === 'end') {
    const cut = text.slice(text.length - max);
    const newline = cut.indexOf('\n');
    return newline >= 0 && newline < cut.length - 1 ? cut.slice(newline + 1) : cut;
  }
  const cut = text.slice(0, max);
  const newline = cut.lastIndexOf('\n');
  return newline > 0 ? cut.slice(0, newline) : cut;
}

export function buildPrompt(ctx: CompletionContext, settings: InlineCompletionSettings): { system: string; user: string } {
  const prefix = trimContext(ctx.prefix, settings.maxPrefixChars, 'end');
  const suffix = trimContext(ctx.suffix, settings.maxSuffixChars, 'start');
  return {
    system: SYSTEM_PROMPT,
    user: `File: ${ctx.relativePath} (${ctx.languageId})\n\n${prefix}${CURSOR}${suffix}`
  };
}

/** True when there is real code after the cursor on the same line, so only that line should be completed. */
export function isMidLine(suffix: string): boolean {
  const restOfLine = suffix.split('\n', 1)[0] ?? '';
  return restOfLine.trim().length > 0;
}

/**
 * Turns raw model output into text that is safe to insert. Chat models
 * decorate their answers (fences, echoed context, duplicated closing
 * brackets); ghost text that fights the surrounding code is worse than none,
 * so this returns '' whenever the result is not clearly usable.
 */
export function cleanCompletion(raw: string, ctx: CompletionContext, maxLines = 12): string {
  let text = raw.replace(/\r\n/g, '\n');
  const controlToken = /<\|(?:endoftext|eot|fim_[^|]+)\|>|<fim_[^>]+>|<EOT>/i;
  const tokenIndex = text.search(controlToken);
  if (tokenIndex >= 0) {
    text = text.slice(0, tokenIndex);
  }

  // Markdown fences, opening (with optional language) and closing.
  text = text.replace(/^\s*```[\w+-]*\n?/, '').replace(/\n?```\s*$/, '');
  text = text.split(CURSOR).join('');

  // The model repeated the end of the current line instead of continuing it.
  const lineStart = ctx.prefix.lastIndexOf('\n') + 1;
  const typed = ctx.prefix.slice(lineStart);
  const overlap = longestOverlap(typed, text);
  if (overlap.trim().length >= 3) {
    text = text.slice(overlap.length);
  }

  if (isMidLine(ctx.suffix)) {
    text = text.split('\n', 1)[0] ?? '';
  }

  text = dropDuplicatedTail(text, ctx.suffix);

  const lines = text.split('\n');
  if (lines.length > maxLines) {
    text = lines.slice(0, maxLines).join('\n');
  }
  text = text.replace(/\s+$/, '');

  if (text.trim().length === 0) {
    return '';
  }
  // Already there: the code after the cursor starts with exactly this text.
  if (ctx.suffix.startsWith(text)) {
    return '';
  }
  return text;
}

/** Longest suffix of `typed` that `text` starts with. */
function longestOverlap(typed: string, text: string): string {
  const max = Math.min(typed.length, text.length, 200);
  for (let length = max; length > 0; length--) {
    if (text.startsWith(typed.slice(typed.length - length))) {
      return typed.slice(typed.length - length);
    }
  }
  return '';
}

/**
 * Removes closing brackets the model added that the file already has after
 * the cursor â€” but only when the completion is *unbalanced* without them.
 * `foo()` before an existing `)` is balanced and must be left alone.
 */
function dropDuplicatedTail(text: string, suffix: string): string {
  const restOfLine = suffix.split('\n', 1)[0] ?? '';
  const closers = restOfLine.match(/^[)\]}\s;,]+/)?.[0] ?? '';
  if (!closers.trim()) {
    return text;
  }
  // The model often writes `x);` where the file already has the `)`. Look
  // past a trailing `;`/`,` when checking for the duplicate.
  const core = text.replace(/[;,\s]+$/, '');
  const pairs: Array<[string, string]> = [['(', ')'], ['[', ']'], ['{', '}']];
  for (let length = Math.min(closers.length, core.length); length > 0; length--) {
    const overlap = closers.slice(0, length);
    if (!core.endsWith(overlap) || overlap.trim().length === 0) {
      continue;
    }
    const excess = pairs.some(([open, close]) => {
      if (!overlap.includes(close)) return false;
      return core.split(close).length - 1 > core.split(open).length - 1;
    });
    if (excess) {
      return core.slice(0, core.length - overlap.length);
    }
  }
  return text;
}

/** Small LRU keyed on exact context, so backspacing and retyping does not re-bill the model. */
class CompletionCache {
  private readonly entries = new Map<string, string>();

  get(key: string): string | undefined {
    const hit = this.entries.get(key);
    if (hit !== undefined) {
      this.entries.delete(key);
      this.entries.set(key, hit);
    }
    return hit;
  }

  set(key: string, value: string): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    if (this.entries.size > CACHE_LIMIT) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) {
        this.entries.delete(oldest);
      }
    }
  }
}

export function cacheKey(ctx: CompletionContext): string {
  return [ctx.languageId, ctx.relativePath, ctx.prefix.slice(-600), '\u0000', ctx.suffix.slice(0, 200)].join('|');
}

/**
 * Produces one inline completion at a time. Concurrency is capped at one
 * request: a new keystroke aborts the previous in-flight call. After a
 * provider failure completions pause briefly, so a dead endpoint is not
 * hammered on every keystroke.
 */
export class InlineCompletionEngine {
  private readonly cache = new CompletionCache();
  private inflight: AbortController | undefined;
  private pausedUntil = 0;

  constructor(private readonly deps: EngineDeps) {}

  get paused(): boolean {
    return (this.deps.now ?? Date.now)() < this.pausedUntil;
  }

  cancel(): void {
    this.inflight?.abort();
    this.inflight = undefined;
  }

  async complete(ctx: CompletionContext, signal?: AbortSignal): Promise<string> {
    const now = this.deps.now ?? Date.now;
    if (now() < this.pausedUntil) {
      return '';
    }

    const key = cacheKey(ctx);
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const settings = this.deps.settings();
    const model = settings.model.trim() || this.deps.defaultModel();
    if (!model) {
      return '';
    }

    this.inflight?.abort();
    const controller = new AbortController();
    this.inflight = controller;
    const onOuterAbort = (): void => controller.abort();
    signal?.addEventListener('abort', onOuterAbort, { once: true });
    if (signal?.aborted) {
      controller.abort();
    }

    const midLine = isMidLine(ctx.suffix);
    // Enough characters for the lines we would keep, plus slack for cleanup.
    const charBudget = settings.maxTokens * 6;
    let raw = '';

    try {
      const provider = await this.deps.provider();
      if (controller.signal.aborted) {
        return '';
      }
      const onText = (delta: string): void => {
        raw += delta;
        const lineCount = raw.split('\n').length;
        if (raw.length > charBudget || lineCount > settings.maxLines + 2 || (midLine && lineCount > 1)) {
          controller.abort();
        }
      };

      let done = false;
      if (settings.fillInMiddle && isFillInMiddleCapable(provider) && provider.supportsFillInMiddle(model)) {
        try {
          await provider.fillInMiddle(
            {
              model,
              prefix: trimContext(ctx.prefix, settings.maxPrefixChars, 'end'),
              suffix: trimContext(ctx.suffix, settings.maxSuffixChars, 'start'),
              maxTokens: settings.maxTokens,
              temperature: 0.1,
              signal: controller.signal
            },
            onText
          );
          done = true;
        } catch (error) {
          if (!(error instanceof FillInMiddleUnsupportedError)) {
            throw error;
          }
          this.deps.log?.(`${model} does not support fill-in-the-middle; using the chat prompt.`);
        }
      }

      if (!done) {
        const prompt = buildPrompt(ctx, settings);
        await provider.stream(
          {
            model,
            system: prompt.system,
            messages: [{ role: 'user', content: prompt.user }],
            temperature: 0.1,
            maxTokens: settings.maxTokens,
            signal: controller.signal
          },
          (event) => {
            if (event.type === 'text') onText(event.delta);
          }
        );
      }
    } catch (error) {
      const aborted = error instanceof ProviderError && error.kind === 'aborted';
      if (!aborted) {
        this.pausedUntil = now() + FAILURE_COOLDOWN_MS;
        this.deps.log?.(`Inline completion paused after error: ${(error as Error)?.message ?? String(error)}`);
        return '';
      }
    } finally {
      signal?.removeEventListener('abort', onOuterAbort);
      if (this.inflight === controller) {
        this.inflight = undefined;
      }
    }

    // A request the editor no longer wants must not populate the cache.
    if (signal?.aborted) {
      return '';
    }

    const cleaned = cleanCompletion(raw, ctx, settings.maxLines);
    this.cache.set(key, cleaned);
    return cleaned;
  }
}
