import { joinUrl, request } from '../http.js';
import type { ModelInfo } from '../ProviderTypes.js';
import type { PuterAuthManager } from './PuterAuthManager.js';
import { PuterErrorMapper } from './PuterErrorMapper.js';

/**
 * Resolves the model list for the `puter-chat-completion` driver. Puter proxies
 * several upstreams, so the list is fetched live and only falls back to a small
 * static set when the endpoint is unavailable.
 */
export class PuterModelResolver {
  private cache: { at: number; models: ModelInfo[] } | undefined;

  constructor(private readonly auth: PuterAuthManager) {}

  invalidate(): void {
    this.cache = undefined;
  }

  async list(): Promise<ModelInfo[]> {
    if (this.cache && Date.now() - this.cache.at < 5 * 60_000) {
      return this.cache.models;
    }
    try {
      const headers = await this.auth.authHeadersAsync();
      const response = await request(joinUrl(this.auth.apiBase, '/puterai/chat/models'), {
        headers,
        timeoutMs: 12000
      });
      const data = (await response.json()) as
        | { models?: { id?: string; name?: string; provider?: string }[] }
        | { result?: { id?: string; name?: string; provider?: string }[] }
        | string[];

      const models = PuterModelResolver.normalize(data);
      if (models.length > 0) {
        this.cache = { at: Date.now(), models };
        return models;
      }
    } catch (error) {
      const mapped = PuterErrorMapper.map(error);
      if (mapped.kind === 'auth' || mapped.kind === 'not-configured') {
        throw mapped;
      }
    }
    return PuterModelResolver.FALLBACK;
  }

  private static normalize(data: unknown): ModelInfo[] {
    const rows = Array.isArray(data)
      ? data
      : ((data as { models?: unknown[]; result?: unknown[] })?.models ??
         (data as { result?: unknown[] })?.result ??
         []);
    const out: ModelInfo[] = [];
    for (const row of rows as unknown[]) {
      if (typeof row === 'string') {
        out.push({ id: row, name: row, supportsTools: true });
      } else if (row && typeof row === 'object') {
        const item = row as { id?: string; name?: string; provider?: string };
        if (item.id) {
          out.push({
            id: item.id,
            name: item.provider ? `${item.id} · ${item.provider}` : item.name ?? item.id,
            supportsTools: true
          });
        }
      }
    }
    return out;
  }

  /** Used only when the live list cannot be fetched, so the UI is never empty. */
  static readonly FALLBACK: ModelInfo[] = [
    { id: 'gpt-4o-mini', name: 'gpt-4o-mini', supportsTools: true },
    { id: 'gpt-4o', name: 'gpt-4o', supportsTools: true },
    { id: 'claude-sonnet-5', name: 'claude-sonnet-5', supportsTools: true },
    { id: 'claude-fable-5-1', name: 'claude-fable-5-1', supportsTools: true },
    { id: 'claude-opus-5', name: 'claude-opus-5', supportsTools: true },
    { id: 'claude-haiku-4-5', name: 'claude-haiku-4-5', supportsTools: true },
    { id: 'claude-sonnet-4', name: 'claude-sonnet-4', supportsTools: true },
    { id: 'claude-3-7-sonnet', name: 'claude-3-7-sonnet', supportsTools: true },
    { id: 'deepseek-chat', name: 'deepseek-chat', supportsTools: true },
    { id: 'mistral-large-latest', name: 'mistral-large-latest', supportsTools: true }
  ];
}
