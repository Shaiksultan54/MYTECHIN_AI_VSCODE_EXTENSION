import type { ChatMessage, ConversationSummary, ToolCallView } from '../../shared/types.js';
import type { ConversationStore } from './ConversationStore.js';
import { newConversation, type Conversation, type ModelTurn } from './ConversationTypes.js';

/**
 * Holds the active conversation and keeps it persisted. Also owns the three
 * memory concepts: the chat transcript (conversation memory), the project facts
 * carried across turns (project memory) and the per-task scratch notes (task
 * memory). They are kept separate on purpose — mixing them makes resumed chats
 * drift.
 */
export class ConversationManager {
  private active: Conversation;
  private taskMemory: string[] = [];

  constructor(
    private readonly store: ConversationStore,
    private readonly workspaceId: () => string,
    private readonly provider: () => string,
    private readonly model: () => string
  ) {
    this.active = newConversation(this.workspaceId(), this.provider(), this.model());
  }

  get current(): Conversation {
    return this.active;
  }

  get id(): string {
    return this.active.id;
  }

  get messages(): ChatMessage[] {
    return this.active.messages;
  }

  get modelTurns(): ModelTurn[] {
    return this.active.modelTurns;
  }

  /** Scratch notes for the current task only. Cleared when a task ends. */
  get task(): string[] {
    return this.taskMemory;
  }

  noteTaskFact(note: string): void {
    this.taskMemory.push(note);
    if (this.taskMemory.length > 20) {
      this.taskMemory.shift();
    }
  }

  clearTaskMemory(): void {
    this.taskMemory = [];
  }

  async startNew(): Promise<Conversation> {
    if (this.active.messages.length > 0) {
      await this.persist();
    }
    this.active = newConversation(this.workspaceId(), this.provider(), this.model());
    this.taskMemory = [];
    return this.active;
  }

  async load(id: string): Promise<Conversation | undefined> {
    const loaded = await this.store.load(id);
    if (!loaded) {
      return undefined;
    }
    if (this.active.messages.length > 0 && this.active.id !== id) {
      await this.persist();
    }
    this.active = loaded;
    this.taskMemory = [];
    return loaded;
  }

  async list(query?: string): Promise<ConversationSummary[]> {
    return this.store.listForWorkspace(this.workspaceId(), query);
  }

  async delete(id: string): Promise<void> {
    await this.store.delete(id);
    if (this.active.id === id) {
      this.active = newConversation(this.workspaceId(), this.provider(), this.model());
    }
  }

  async rename(id: string, title: string): Promise<void> {
    if (this.active.id === id) {
      this.active.title = title.slice(0, 120);
      await this.persist();
      return;
    }
    await this.store.rename(id, title);
  }

  addMessage(message: ChatMessage): void {
    this.active.messages.push(message);
    this.active.updatedAt = Date.now();
    if (message.role === 'user' && this.isUntitled()) {
      this.active.title = ConversationManager.titleFrom(message.text);
    }
  }

  updateMessage(id: string, patch: Partial<ChatMessage>): ChatMessage | undefined {
    const message = this.active.messages.find((m) => m.id === id);
    if (!message) {
      return undefined;
    }
    Object.assign(message, patch);
    this.active.updatedAt = Date.now();
    return message;
  }

  upsertToolCall(messageId: string, call: ToolCallView): void {
    const message = this.active.messages.find((m) => m.id === messageId);
    if (!message) {
      return;
    }
    message.toolCalls = message.toolCalls ?? [];
    const index = message.toolCalls.findIndex((c) => c.callId === call.callId);
    if (index >= 0) {
      message.toolCalls[index] = call;
    } else {
      message.toolCalls.push(call);
    }
  }

  addModelTurn(turn: ModelTurn): void {
    this.active.modelTurns.push(turn);
    // Keep the transcript bounded: drop the oldest turns but always keep the
    // first user turn so the model retains the original task.
    if (this.active.modelTurns.length > 120) {
      const first = this.active.modelTurns[0];
      this.active.modelTurns = [first, ...this.active.modelTurns.slice(-100)];
    }
  }

  setProviderAndModel(provider: string, model: string): void {
    this.active.provider = provider;
    this.active.model = model;
  }

  async persist(): Promise<void> {
    this.active.updatedAt = Date.now();
    await this.store.save(this.active);
  }

  private isUntitled(): boolean {
    return this.active.title === 'New chat' || this.active.title.trim() === '';
  }

  private static titleFrom(text: string): string {
    const cleaned = text
      .replace(/@\w+\s*/g, '')
      .replace(/^\/\w+\s*/, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned.length === 0) {
      return 'New chat';
    }
    return cleaned.length > 60 ? `${cleaned.slice(0, 57)}…` : cleaned;
  }
}
