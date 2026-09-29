import type { WebviewMessage } from '../../src/shared/messages/index.js';

interface VsCodeApi {
  postMessage(message: WebviewMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare global {
  interface Window {
    acquireVsCodeApi?: () => VsCodeApi;
  }
}

import { setupMockVsCode } from './mock/mockVsCode.js';

setupMockVsCode();
const api = window.acquireVsCodeApi?.();

/** The only channel out of the webview. Everything is typed and validated. */
export function post(message: WebviewMessage): void {
  api?.postMessage(message);
}

/** Small, non-sensitive UI state that survives the view being hidden. */
export function saveUiState(state: Record<string, unknown>): void {
  api?.setState(state);
}

export function loadUiState<T extends Record<string, unknown>>(): Partial<T> {
  return (api?.getState() as Partial<T>) ?? {};
}
