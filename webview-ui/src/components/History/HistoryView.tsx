import { useEffect, useMemo, useState, type JSX } from 'react';
import type { CheckpointView, ConversationSummary } from '../../../../src/shared/types.js';
import { post } from '../../vscode.js';
import { Icon } from '../Icon.js';
import { dayGroup, timeOfDay } from '../../utils/format.js';

export interface HistoryViewProps {
  conversations: ConversationSummary[];
  checkpoints: CheckpointView[];
  currentId: string;
}

export function HistoryView({ conversations, checkpoints, currentId }: HistoryViewProps): JSX.Element {
  const [query, setQuery] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => post({ type: 'listConversations', query }), 180);
    return () => window.clearTimeout(timer);
  }, [query]);

  const grouped = useMemo(() => {
    const groups = new Map<string, ConversationSummary[]>();
    for (const conversation of conversations) {
      const key = dayGroup(conversation.updatedAt);
      const list = groups.get(key) ?? [];
      list.push(conversation);
      groups.set(key, list);
    }
    return [...groups.entries()];
  }, [conversations]);

  return (
    <div className="panel">
      <div className="search-row">
        <Icon name="search" />
        <input
          type="text"
          value={query}
          placeholder="Search chats"
          aria-label="Search chats"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {grouped.length === 0 ? <p className="empty-hint">No conversations yet.</p> : null}

      {grouped.map(([group, items]) => (
        <section key={group} className="history-group">
          <h4>{group}</h4>
          {items.map((conversation) => (
            <div key={conversation.id} className={`history-row${conversation.id === currentId ? ' history-current' : ''}`}>
              <button
                type="button"
                className="history-open"
                onClick={() => post({ type: 'loadConversation', conversationId: conversation.id })}
              >
                <span className="history-title">{conversation.title}</span>
                <span className="history-meta">
                  {timeOfDay(conversation.updatedAt)} · {conversation.messageCount} message
                  {conversation.messageCount === 1 ? '' : 's'} · {conversation.model || conversation.provider}
                </span>
              </button>
              <button
                type="button"
                className="icon-button"
                title="Rename"
                onClick={() => {
                  const title = window.prompt('Rename chat', conversation.title);
                  if (title?.trim()) {
                    post({ type: 'renameConversation', conversationId: conversation.id, title: title.trim() });
                  }
                }}
              >
                <Icon name="edit" />
              </button>
              <button
                type="button"
                className="icon-button"
                title="Delete"
                onClick={() => post({ type: 'deleteConversation', conversationId: conversation.id })}
              >
                <Icon name="trash" />
              </button>
            </div>
          ))}
        </section>
      ))}

      {checkpoints.length > 0 ? (
        <section className="history-group">
          <h4>Checkpoints</h4>
          {checkpoints.map((checkpoint) => (
            <div key={checkpoint.id} className="checkpoint-row">
              <div className="checkpoint-info">
                <span className="checkpoint-title">
                  #{checkpoint.index} {checkpoint.label}
                </span>
                <span className="checkpoint-meta">
                  {checkpoint.modified.length} modified · {checkpoint.added.length} added
                  {checkpoint.deleted.length > 0 ? ` · ${checkpoint.deleted.length} deleted` : ''}
                </span>
              </div>
              <button
                type="button"
                className="link-button"
                onClick={() => post({ type: 'compareCheckpoint', checkpointId: checkpoint.id })}
              >
                Compare
              </button>
              <button
                type="button"
                className="link-button"
                onClick={() => post({ type: 'restoreCheckpoint', checkpointId: checkpoint.id })}
              >
                Restore
              </button>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}
