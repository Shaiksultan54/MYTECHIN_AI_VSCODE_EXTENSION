import { useState, type JSX } from 'react';
import { Icon } from '../Icon.js';
import type { MemoryEntry } from '../../../../src/shared/types.js';
import { post } from '../../vscode.js';

export interface MemoryViewProps {
  entries: MemoryEntry[];
}

export function MemoryView({ entries }: MemoryViewProps): JSX.Element {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');

  const [addingCategory, setAddingCategory] = useState<MemoryEntry['category'] | null>(null);
  const [addContent, setAddContent] = useState('');

  const rules = entries.filter((e) => e.category === 'rules');
  const architecture = entries.filter((e) => e.category === 'architecture');
  const decisions = entries.filter((e) => e.category === 'decisions');
  const knowledge = entries.filter((e) => e.category === 'knowledge');

  const handleStartEdit = (entry: MemoryEntry) => {
    setEditingId(entry.id);
    setEditContent(entry.content);
    setAddingCategory(null);
  };

  const handleSaveEdit = (id: string) => {
    if (editContent.trim()) {
      post({ type: 'updateMemory', id, content: editContent });
    }
    setEditingId(null);
  };

  const handleDelete = (id: string) => {
    post({ type: 'removeMemory', id });
  };

  const handleStartAdd = (category: MemoryEntry['category']) => {
    setAddingCategory(category);
    setAddContent('');
    setEditingId(null);
  };

  const handleSaveAdd = () => {
    if (addingCategory && addContent.trim()) {
      post({ type: 'addMemory', category: addingCategory, content: addContent });
    }
    setAddingCategory(null);
  };

  const renderCategory = (title: string, cat: MemoryEntry['category'], items: MemoryEntry[]) => (
    <section className="settings-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h4>{title}</h4>
        <button
          type="button"
          className="icon-button"
          onClick={() => handleStartAdd(cat)}
          title={`Add ${title}`}
        >
          <Icon name="add" />
        </button>
      </div>

      {addingCategory === cat && (
        <div className="memory-entry editing" style={{ marginTop: 8 }}>
          <textarea
            autoFocus
            value={addContent}
            onChange={(e) => setAddContent(e.target.value)}
            placeholder={`Add a new ${title.toLowerCase()} entry...`}
            style={{ width: '100%', minHeight: 60, fontFamily: 'inherit' }}
          />
          <div className="button-row" style={{ marginTop: 4 }}>
            <button type="button" onClick={handleSaveAdd}>Save</button>
            <button type="button" className="secondary" onClick={() => setAddingCategory(null)}>Cancel</button>
          </div>
        </div>
      )}

      {items.length === 0 && addingCategory !== cat && (
        <div className="field-hint" style={{ marginTop: 8 }}>No entries in this category.</div>
      )}

      {items.map((entry) => (
        <div key={entry.id} className="memory-entry" style={{ marginTop: 8, padding: 8, background: 'var(--vscode-editor-inactiveSelectionBackground)', borderRadius: 4 }}>
          {editingId === entry.id ? (
            <div>
              <textarea
                autoFocus
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                style={{ width: '100%', minHeight: 60, fontFamily: 'inherit' }}
              />
              <div className="button-row" style={{ marginTop: 4 }}>
                <button type="button" onClick={() => handleSaveEdit(entry.id)}>Save</button>
                <button type="button" className="secondary" onClick={() => setEditingId(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', flex: 1, paddingRight: 8 }}>{entry.content}</div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button type="button" className="icon-button" onClick={() => handleStartEdit(entry)} title="Edit">
                    <Icon name="edit" />
                  </button>
                  <button type="button" className="icon-button" onClick={() => handleDelete(entry.id)} title="Delete">
                    <Icon name="trash" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      ))}
    </section>
  );

  return (
    <div className="panel" style={{ paddingBottom: 24 }}>
      <div style={{ marginBottom: 16 }}>
        <p>
          Project Memory allows Mytechin AI to retain context across sessions. It learns rules, 
          architecture decisions, and general project knowledge over time.
        </p>
      </div>

      {renderCategory('Rules', 'rules', rules)}
      {renderCategory('Architecture', 'architecture', architecture)}
      {renderCategory('Decisions', 'decisions', decisions)}
      {renderCategory('Knowledge', 'knowledge', knowledge)}
    </div>
  );
}
