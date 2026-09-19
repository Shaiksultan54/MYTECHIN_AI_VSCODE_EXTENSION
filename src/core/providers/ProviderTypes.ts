import type { ModelInfo, ProviderId, ProviderState } from '../../shared/types.js';

export type { ModelInfo, ProviderId };

export type AIMessageContent = 
  | string 
  | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;

export interface AIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: AIMessageContent;
  /** Present on `tool` messages so native tool-calling providers can match up results. */
  toolCallId?: string;
  name?: string;
}

export interface AIToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AIRequest {
  model: string;
  messages: AIMessage[];
  system?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: AIToolSchema[];
  /** Aborts the HTTP request. Providers must honour it. */
  signal?: AbortSignal;
}

export interface AIToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface AIResponse {
  text: string;
  toolCalls: AIToolCall[];
  finishReason: 'stop' | 'length' | 'tool_call' | 'aborted' | 'error';
  usage?: { promptTokens?: number; completionTokens?: number };
}

export type AIStreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'tool_call'; call: AIToolCall }
  | { type: 'usage'; promptTokens?: number; completionTokens?: number }
  | { type: 'done'; finishReason: AIResponse['finishReason'] };

export interface ProviderStatus {
  state: ProviderState;
  message?: string;
}

export interface ProviderConfig {
  endpoint?: string;
  baseUrl?: string;
  organization?: string;
  apiKey?: string;
}

/** Errors the UI knows how to explain. */
export type ProviderErrorKind =
  | 'unavailable'
  | 'auth'
  | 'not-configured'
  | 'model-not-found'
  | 'rate-limit'
  | 'context-too-large'
  | 'aborted'
  | 'bad-response'
  | 'unknown';

export class ProviderError extends Error {
  constructor(
    public readonly kind: ProviderErrorKind,
    message: string,
    public readonly hint?: string,
    public readonly retryable = false
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
