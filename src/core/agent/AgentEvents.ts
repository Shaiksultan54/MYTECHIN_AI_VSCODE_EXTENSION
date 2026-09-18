import type { ExtensionEvent } from '../../shared/events/index.js';

/** The agent talks to the outside world only through this sink. */
export interface AgentEventSink {
  emit(event: ExtensionEvent): void;
}

export type { ExtensionEvent };
