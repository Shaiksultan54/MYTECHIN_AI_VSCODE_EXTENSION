import type {
  AIRequest,
  AIResponse,
  AIStreamEvent,
  ModelInfo,
  ProviderConfig,
  ProviderStatus
} from './ProviderTypes.js';

/**
 * The single seam between the agent and any vendor. AgentRuntime depends on
 * this interface only, so a provider can be swapped without touching the loop.
 * Implementations must not import `vscode`.
 */
export interface AIProvider {
  readonly id: string;
  readonly name: string;
  /** True when requests leave the machine. Drives the cloud warning in the UI. */
  readonly isCloud: boolean;
  readonly requiresSecret: boolean;

  configure(config: ProviderConfig): void;

  listModels(): Promise<ModelInfo[]>;

  chat(request: AIRequest): Promise<AIResponse>;

  stream(request: AIRequest, onEvent: (event: AIStreamEvent) => void): Promise<void>;

  testConnection(): Promise<ProviderStatus>;

  supportsTools(): boolean;
  supportsVision(): boolean;
  supportsReasoning(): boolean;
}

/**
 * Shared implementation of `chat` in terms of `stream`, so providers only have
 * to implement streaming once.
 */
export abstract class BaseProvider implements AIProvider {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly isCloud: boolean;
  abstract readonly requiresSecret: boolean;

  protected config: ProviderConfig = {};

  configure(config: ProviderConfig): void {
    this.config = { ...this.config, ...config };
  }

  abstract listModels(): Promise<ModelInfo[]>;
  abstract stream(request: AIRequest, onEvent: (event: AIStreamEvent) => void): Promise<void>;
  abstract testConnection(): Promise<ProviderStatus>;

  async chat(request: AIRequest): Promise<AIResponse> {
    let text = '';
    const toolCalls: AIResponse['toolCalls'] = [];
    let finishReason: AIResponse['finishReason'] = 'stop';
    const usage: { promptTokens?: number; completionTokens?: number } = {};

    await this.stream(request, (event) => {
      switch (event.type) {
        case 'text':
          text += event.delta;
          break;
        case 'tool_call':
          toolCalls.push(event.call);
          break;
        case 'usage':
          usage.promptTokens = event.promptTokens ?? usage.promptTokens;
          usage.completionTokens = event.completionTokens ?? usage.completionTokens;
          break;
        case 'done':
          finishReason = event.finishReason;
          break;
        default:
          break;
      }
    });

    return { text, toolCalls, finishReason, usage };
  }

  supportsTools(): boolean {
    return false;
  }
  supportsVision(): boolean {
    return false;
  }
  supportsReasoning(): boolean {
    return false;
  }
}
