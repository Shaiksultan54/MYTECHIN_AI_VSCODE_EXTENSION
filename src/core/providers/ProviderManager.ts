import * as vscode from 'vscode';
import type { ModelInfo, ProviderId, ProviderStatusView, SettingsView } from '../../shared/types.js';
import type { SecretStore } from '../storage/SecretStore.js';
import type { SettingsStore } from '../storage/SettingsStore.js';
import { Logger } from '../logging/Logger.js';
import type { AIProvider } from './AIProvider.js';
import { AnthropicProvider } from './anthropic/AnthropicProvider.js';
import { OllamaProvider } from './ollama/OllamaProvider.js';
import { OpenAICompatibleProvider } from './openai-compatible/OpenAICompatibleProvider.js';
import { OpenAIProvider } from './openai/OpenAIProvider.js';
import { PuterProvider } from './puter/PuterProvider.js';
import { GeminiProvider } from './gemini/GeminiProvider.js';
import { GroqProvider } from './groq/GroqProvider.js';
import { OpenRouterProvider } from './openrouter/OpenRouterProvider.js';
import { GitHubProvider } from './github/GitHubProvider.js';
import { OmniRouteProvider } from './omniroute/OmniRouteProvider.js';
import { ProviderError, type ProviderStatus } from './ProviderTypes.js';

/**
 * Owns the provider registry and keeps each one configured from settings plus
 * SecretStorage. The agent asks for `active()` and nothing else.
 */
export class ProviderManager implements vscode.Disposable {
  private readonly providers = new Map<ProviderId, AIProvider>();
  private readonly statuses = new Map<ProviderId, ProviderStatus>();
  private readonly modelCache = new Map<ProviderId, { at: number; models: ModelInfo[] }>();
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;

  constructor(
    private readonly settings: SettingsStore,
    private readonly secrets: SecretStore
  ) {
    this.providers.set('ollama', new OllamaProvider());
    this.providers.set('omniroute', new OmniRouteProvider());
    this.providers.set('puter', new PuterProvider());
    this.providers.set('openai', new OpenAIProvider());
    this.providers.set('anthropic', new AnthropicProvider());
    this.providers.set('openai-compatible', new OpenAICompatibleProvider());
    this.providers.set('gemini', new GeminiProvider());
    this.providers.set('groq', new GroqProvider());
    this.providers.set('openrouter', new OpenRouterProvider());
    this.providers.set('github', new GitHubProvider());

    for (const id of this.providers.keys()) {
      this.statuses.set(id, { state: id === 'ollama' || id === 'puter' || id === 'omniroute' ? 'checking' : 'not-configured' });
    }
  }

  get activeId(): ProviderId {
    return this.settings.read().provider;
  }

  /** Returns the active provider, configured and ready to use. */
  async active(): Promise<AIProvider> {
    const id = this.activeId;
    const provider = this.providers.get(id);
    if (!provider) {
      throw new ProviderError('not-configured', `Unknown provider "${id}".`, 'Pick a provider in settings.');
    }
    await this.applyConfig(id, provider);
    return provider;
  }

  get(id: ProviderId): AIProvider | undefined {
    return this.providers.get(id);
  }

  private async applyConfig(id: ProviderId, provider: AIProvider): Promise<void> {
    const s: SettingsView = this.settings.read();
    const apiKey = await this.secrets.get(id);
    switch (id) {
      case 'ollama':
        provider.configure({ endpoint: s.ollamaEndpoint });
        break;
      case 'puter':
        provider.configure({ baseUrl: s.puterBaseUrl, apiKey });
        break;
      case 'openai':
        provider.configure({ apiKey });
        break;
      case 'anthropic':
        provider.configure({ apiKey });
        break;
      case 'openai-compatible':
        provider.configure({
          baseUrl: s.openaiCompatibleBaseUrl,
          organization: s.openaiCompatibleOrganization,
          apiKey
        });
        break;
      case 'omniroute':
        provider.configure({
          baseUrl: s.omniRouteBaseUrl,
          apiKey
        });
        break;
      case 'gemini':
      case 'groq':
      case 'openrouter':
      case 'github':
        provider.configure({ apiKey });
        break;
      default:
        break;
    }
  }

  /** Instantly returns cached models without blocking on network requests. */
  getCachedModels(id: ProviderId = this.activeId): ModelInfo[] {
    return this.modelCache.get(id)?.models ?? [];
  }

  /** Model list for the active provider, cached for a minute. */
  async listModels(force = false): Promise<ModelInfo[]> {
    const id = this.activeId;
    const cached = this.modelCache.get(id);
    if (!force && cached && Date.now() - cached.at < 60_000) {
      return cached.models;
    }
    try {
      const provider = await this.active();
      const models = await provider.listModels();
      this.modelCache.set(id, { at: Date.now(), models });
      if (models.length > 0 && this.statuses.get(id)?.state !== 'connected') {
        this.statuses.set(id, { state: 'connected' });
        this.emitter.fire();
      }
      return models;
    } catch (error) {
      Logger.get().warn(`Could not list models for ${id}`, error);
      return cached?.models ?? [];
    }
  }

  async testConnection(id: ProviderId = this.activeId): Promise<ProviderStatus> {
    const provider = this.providers.get(id);
    if (!provider) {
      return { state: 'error', message: `Unknown provider "${id}".` };
    }
    this.statuses.set(id, { state: 'checking' });
    this.emitter.fire();
    await this.applyConfig(id, provider);

    let status: ProviderStatus;
    try {
      status = await provider.testConnection();
    } catch (error) {
      status = { state: 'error', message: (error as Error).message };
    }
    this.statuses.set(id, status);
    this.modelCache.delete(id);
    this.emitter.fire();
    return status;
  }

  async statusViews(): Promise<ProviderStatusView[]> {
    const out: ProviderStatusView[] = [];
    for (const [id, provider] of this.providers) {
      const status = this.statuses.get(id) ?? { state: 'not-configured' as const };
      out.push({
        id,
        name: provider.name,
        state: status.state,
        message: status.message,
        isCloud: provider.isCloud,
        requiresSecret: provider.requiresSecret,
        hasSecret: provider.requiresSecret ? await this.secrets.has(id) : undefined
      });
    }
    return out;
  }

  /** Marks a provider stale so the next status read re-checks it. */
  invalidate(id: ProviderId = this.activeId): void {
    this.modelCache.delete(id);
    this.statuses.set(id, { state: 'checking' });
    this.emitter.fire();
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
