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

  protected override defaultBaseUrl = 'http://127.0.0.1:20128/v1';

  override readonly isCloud: boolean = false;

  override async listModels(): Promise<ModelInfo[]> {
    const response = await request(`${joinUrl(this.baseUrl, '/models')}?prefix=alias`, {
      headers: this.headers(),
      timeoutMs: 8000
    });
    const data = (await response.json()) as {
      data?: Array<{
        id: string;
        name?: string;
        type?: string;
        supports_tools?: boolean;
        supports_vision?: boolean;
        context_window?: number;
      }>;
    };
    const list = data.data ?? [];

    return list
      .filter((m) => !m.type || !['embedding', 'image', 'video', 'audio', 'rerank', 'moderation'].includes(m.type))
      .map((m) => ({
        id: m.id,
        name: m.name ?? m.id,
        supportsTools: m.supports_tools ?? true,
        supportsVision: m.supports_vision,
        contextWindow: m.context_window
      }));
  }

  override async testConnection(): Promise<ProviderStatus> {
    try {
      const models = await this.listModels();
      if (models.length === 0) {
        return {
          state: 'error',
          message: `OmniRoute gateway at ${this.baseUrl} is reachable but returned no models.`
        };
      }
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
