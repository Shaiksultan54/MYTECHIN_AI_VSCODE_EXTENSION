import type { ChatMessage, ContextAttachment } from '../../shared/types.js';

export interface Conversation {
  id: string;
  title: string;
  workspaceId: string;
  provider: string;
  model: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  attachments: ContextAttachment[];
  /** Raw turns as sent to the model, so a resumed chat keeps its tool history. */
  modelTurns: ModelTurn[];
}

export interface ModelTurn {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  name?: string;
}

export function newConversation(workspaceId: string, provider: string, model: string): Conversation {
  const now = Date.now();
  return {
    id: `conv_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    title: 'New chat',
    workspaceId,
    provider,
    model,
    createdAt: now,
    updatedAt: now,
    messages: [],
    attachments: [],
    modelTurns: []
  };
}
