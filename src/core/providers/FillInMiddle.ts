import type { AIProvider } from './AIProvider.js';

export interface FillInMiddleRequest {
  model: string;
  prefix: string;
  suffix: string;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface FillInMiddleCapable {
  supportsFillInMiddle(model: string): boolean;
  fillInMiddle(req: FillInMiddleRequest, onText: (delta: string) => void): Promise<void>;
}

export class FillInMiddleUnsupportedError extends Error {
  constructor(public readonly model: string) {
    super(`${model} does not support fill-in-the-middle.`);
    this.name = 'FillInMiddleUnsupportedError';
  }
}

export function isFillInMiddleCapable(provider: AIProvider): provider is AIProvider & FillInMiddleCapable {
  const candidate = provider as Partial<FillInMiddleCapable>;
  return typeof candidate.fillInMiddle === 'function' && typeof candidate.supportsFillInMiddle === 'function';
}
