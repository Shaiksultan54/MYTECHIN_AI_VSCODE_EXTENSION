import { joinUrl, request } from '../http.js';
import type { ModelInfo } from '../ProviderTypes.js';
import type { PuterAuth } from './PuterAuth.js';
import { PuterErrorMapper } from './PuterErrorMapper.js';

/** Extended model info with Puter-specific metadata. */
export interface PuterModel extends ModelInfo {
  /** True for all Puter models (free under User-Pays model). */
  isFree: boolean;
  /** Upstream provider name (e.g. "anthropic", "openai", "mistral"). */
  provider?: string;
}

/**
 * Resolves the model list for the Puter AI gateway using the
 * OpenAI-compatible `/models` endpoint. This replaces the old
 * `/puterai/chat/models` call.
 *
 * Models are cached for 5 minutes. Call `invalidate()` or click
 * "Refresh Models" in the UI to clear the cache.
 */
export class PuterModelService {
  private cache: { at: number; models: PuterModel[] } | undefined;

  constructor(private readonly auth: PuterAuth) {}

  invalidate(): void {
    this.cache = undefined;
  }

  async list(): Promise<PuterModel[]> {
    if (this.cache && Date.now() - this.cache.at < 5 * 60_000) {
      return this.cache.models;
    }

    try {
      const headers = await this.auth.authHeadersAsync();
      const response = await request(
        joinUrl(this.auth.openaiBase, '/models'),
        { headers, timeoutMs: 12000 }
      );
      const data = (await response.json()) as {
        data?: { id: string; owned_by?: string; object?: string }[];
      };

      const models = PuterModelService.normalize(data.data ?? []);
      if (models.length > 0) {
        this.cache = { at: Date.now(), models };
        return models;
      }
    } catch (error) {
      const mapped = PuterErrorMapper.map(error);
      if (mapped.kind === 'auth' || mapped.kind === 'not-configured') {
        throw mapped;
      }
      // Network errors: return cache if available, else fallback
    }

    if (this.cache) {
      return this.cache.models;
    }
    return PuterModelService.FALLBACK;
  }

  /** Count of free models in the last fetched list. */
  get freeModelCount(): number {
    return this.cache?.models.filter((m) => m.isFree).length ?? 0;
  }

  /** Total model count in the last fetched list. */
  get modelCount(): number {
    return this.cache?.models.length ?? 0;
  }

  // ─── Normalization ────────────────────────────────────────────────

  private static normalize(
    data: { id: string; owned_by?: string; object?: string }[]
  ): PuterModel[] {
    const models: PuterModel[] = [];

    for (const entry of data) {
      if (!entry.id) continue;

      const provider = PuterModelService.inferProvider(entry.id, entry.owned_by);
      const displayName = PuterModelService.buildDisplayName(entry.id, provider);
      const supportsTools = PuterModelService.inferToolSupport(entry.id);

      models.push({
        id: entry.id,
        name: displayName,
        isFree: true, // All Puter models are free under User-Pays model
        provider,
        supportsTools,
        supportsVision: PuterModelService.inferVisionSupport(entry.id)
      });
    }

    // Sort: coding-capable models first, then alphabetical
    return models.sort((a, b) => {
      const aScore = PuterModelService.codingScore(a.id);
      const bScore = PuterModelService.codingScore(b.id);
      if (aScore !== bScore) return bScore - aScore;
      return a.id.localeCompare(b.id);
    });
  }

  private static inferProvider(id: string, ownedBy?: string): string | undefined {
    if (ownedBy && ownedBy !== 'system') return ownedBy;
    if (/claude|anthropic/i.test(id)) return 'anthropic';
    if (/gpt|o[13-9]-|chatgpt|dall-e/i.test(id)) return 'openai';
    if (/gemini|gemma/i.test(id)) return 'google';
    if (/mistral|mixtral|codestral|pixtral/i.test(id)) return 'mistral';
    if (/llama|meta-llama/i.test(id)) return 'meta';
    if (/deepseek/i.test(id)) return 'deepseek';
    if (/qwen/i.test(id)) return 'qwen';
    if (/grok/i.test(id)) return 'xai';
    return undefined;
  }

  private static buildDisplayName(id: string, provider?: string): string {
    if (provider) {
      return `${id} · ${provider}`;
    }
    return id;
  }

  private static inferToolSupport(id: string): boolean {
    // Most modern chat models support tools. Exclude known non-tool models.
    if (/embed|whisper|dall-e|tts|stt|moderation/i.test(id)) return false;
    return true;
  }

  private static inferVisionSupport(id: string): boolean {
    if (/vision|4o|claude-(sonnet|opus|haiku|fable)|gemini/i.test(id)) return true;
    return false;
  }

  /** Higher score = better for coding tasks. Used for sort order only. */
  private static codingScore(id: string): number {
    const lower = id.toLowerCase();
    if (/claude-fable|claude-sonnet-5|claude-opus-5/i.test(lower)) return 10;
    if (/claude-sonnet|claude-opus/i.test(lower)) return 9;
    if (/gpt-4o|gpt-5/i.test(lower)) return 8;
    if (/deepseek-chat|deepseek-coder/i.test(lower)) return 7;
    if (/codestral|qwen.*coder/i.test(lower)) return 7;
    if (/claude-haiku/i.test(lower)) return 6;
    if (/gemini/i.test(lower)) return 5;
    if (/mistral-large/i.test(lower)) return 5;
    if (/gpt-4/i.test(lower)) return 4;
    return 1;
  }

  // ─── Fallback ─────────────────────────────────────────────────────

  /** Used only when the live list cannot be fetched, so the UI is never empty. */
  static readonly FALLBACK: PuterModel[] = [
    { id: 'claude-sonnet-5', name: 'claude-sonnet-5 · anthropic', isFree: true, provider: 'anthropic', supportsTools: true },
    { id: 'claude-fable-5-1', name: 'claude-fable-5-1 · anthropic', isFree: true, provider: 'anthropic', supportsTools: true },
    { id: 'claude-opus-5', name: 'claude-opus-5 · anthropic', isFree: true, provider: 'anthropic', supportsTools: true },
    { id: 'claude-haiku-4-5', name: 'claude-haiku-4-5 · anthropic', isFree: true, provider: 'anthropic', supportsTools: true },
    { id: 'gpt-4o', name: 'gpt-4o · openai', isFree: true, provider: 'openai', supportsTools: true },
    { id: 'gpt-4o-mini', name: 'gpt-4o-mini · openai', isFree: true, provider: 'openai', supportsTools: true },
    { id: 'deepseek-chat', name: 'deepseek-chat · deepseek', isFree: true, provider: 'deepseek', supportsTools: true },
    { id: 'mistral-large-latest', name: 'mistral-large-latest · mistral', isFree: true, provider: 'mistral', supportsTools: true }
  ];
}
