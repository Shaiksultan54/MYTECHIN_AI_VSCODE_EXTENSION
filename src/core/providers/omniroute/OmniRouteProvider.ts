import { OpenAICompatibleProvider } from '../openai-compatible/OpenAICompatibleProvider.js';
import { joinUrl, request } from '../http.js';
import {
  ProviderError,
  type AIRequest,
  type AIStreamEvent,
  type ModelInfo,
  type ProviderStatus
} from '../ProviderTypes.js';

/**
 * OmniRoute model routing gateway adapter.
 * Connects MYTECHIN to OmniRoute for intelligent model routing, quota awareness,
 * multi-model fallback, and model capability aggregation.
 */
export class OmniRouteProvider extends OpenAICompatibleProvider {
  override readonly id = 'omniroute';
  override readonly name = 'OmniRoute';
  override readonly requiresSecret = false;

  protected override defaultBaseUrl = 'http://127.0.0.1:8000/v1';

  override readonly isCloud: boolean = false;

  override async listModels(): Promise<ModelInfo[]> {
    try {
      const response = await request(joinUrl(this.baseUrl, '/models'), {
        headers: this.headers(),
        timeoutMs: 8000
      });
      const data = (await response.json()) as { data?: Array<{ id: string; name?: string }> };
      const list = data.data ?? [];

      if (list.length === 0) {
        // Default virtual routed models if endpoint doesn't return custom list
        return [
          { id: 'omniroute/auto', name: 'OmniRoute Auto (Optimal Routing)', supportsTools: true },
          { id: 'omniroute/free-first', name: 'OmniRoute Free-First', supportsTools: true },
          { id: 'omniroute/coder', name: 'OmniRoute Coding Specialist', supportsTools: true },
          { id: 'omniroute/fast', name: 'OmniRoute Low Latency', supportsTools: true }
        ];
      }

      return list.map((m) => ({
        id: m.id,
        name: m.name ?? m.id,
        supportsTools: true
      }));
    } catch {
      // Fallback list when offline/local gateway is launching
      return [
        { id: 'omniroute/auto', name: 'OmniRoute Auto (Optimal Routing)', supportsTools: true },
        { id: 'omniroute/free-first', name: 'OmniRoute Free-First', supportsTools: true },
        { id: 'omniroute/coder', name: 'OmniRoute Coding Specialist', supportsTools: true }
      ];
    }
  }

  override async testConnection(): Promise<ProviderStatus> {
    try {
      const models = await this.listModels();
      return {
        state: 'connected',
        message: `OmniRoute gateway active (${models.length} routes available)`
      };
    } catch (error) {
      return {
        state: 'error',
        message: `Could not reach OmniRoute gateway at ${this.baseUrl}: ${(error as Error).message}`
      };
    }
  }

  override supportsTools(): boolean {
    return true;
  }

  override supportsVision(): boolean {
    return true;
  }

  override supportsReasoning(): boolean {
    return true;
  }

  override async stream(request: AIRequest, onEvent: (event: AIStreamEvent) => void): Promise<void> {
    try {
      await super.stream(request, onEvent);
    } catch (error) {
      if (error instanceof ProviderError && (error.kind === 'rate-limit' || error.kind === 'unavailable')) {
        // Auto-fallback: if specific route fails, attempt auto-routed fallback
        if (request.model !== 'omniroute/auto') {
          const fallbackReq = { ...request, model: 'omniroute/auto' };
          await super.stream(fallbackReq, onEvent);
          return;
        }
      }
      throw error;
    }
  }
}
