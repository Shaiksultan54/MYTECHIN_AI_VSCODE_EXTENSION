import * as vscode from 'vscode';
import type { Conversation } from './ConversationTypes.js';
import { Logger } from '../logging/Logger.js';

const INDEX_KEY = 'mytechin.conversations.index';
const PREFIX = 'mytechin.conversation.';

interface IndexEntry {
  id: string;
  title: string;
  workspaceId: string;
  provider: string;
  model: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

/**
 * Persists conversations in extension global state. An index is kept separately
 * so the history list loads without deserialising every transcript.
 */
export class ConversationStore {
  constructor(private readonly storage: vscode.Memento) {}

  index(): IndexEntry[] {
    return this.storage.get<IndexEntry[]>(INDEX_KEY, []);
  }

  listForWorkspace(workspaceId: string, query?: string): IndexEntry[] {
    const needle = query?.trim().toLowerCase();
    return this.index()
      .filter((entry) => entry.workspaceId === workspaceId)
      .filter((entry) => !needle || entry.title.toLowerCase().includes(needle))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async load(id: string): Promise<Conversation | undefined> {
    return this.storage.get<Conversation>(`${PREFIX}${id}`);
  }

  async save(conversation: Conversation): Promise<void> {
    const trimmed: Conversation = {
      ...conversation,
      // Cap transcripts so global state does not grow without bound.
      messages: conversation.messages.slice(-200),
      modelTurns: conversation.modelTurns.slice(-120)
    };

    await this.storage.update(`${PREFIX}${trimmed.id}`, trimmed);

    const entries = this.index().filter((entry) => entry.id !== trimmed.id);
    entries.push({
      id: trimmed.id,
      title: trimmed.title,
      workspaceId: trimmed.workspaceId,
      provider: trimmed.provider,
      model: trimmed.model,
      createdAt: trimmed.createdAt,
      updatedAt: trimmed.updatedAt,
      messageCount: trimmed.messages.length
    });

    // Keep the newest 200 conversations across all workspaces.
    const sorted = entries.sort((a, b) => b.updatedAt - a.updatedAt);
    const keep = sorted.slice(0, 200);
    for (const stale of sorted.slice(200)) {
      await this.storage.update(`${PREFIX}${stale.id}`, undefined);
    }
    await this.storage.update(INDEX_KEY, keep);
  }

  async delete(id: string): Promise<void> {
    await this.storage.update(`${PREFIX}${id}`, undefined);
    await this.storage.update(
      INDEX_KEY,
      this.index().filter((entry) => entry.id !== id)
    );
    Logger.get().debug(`Deleted conversation ${id}`);
  }

  async rename(id: string, title: string): Promise<void> {
    const conversation = await this.load(id);
    if (!conversation) {
      return;
    }
    conversation.title = title.slice(0, 120);
    conversation.updatedAt = Date.now();
    await this.save(conversation);
  }
}
