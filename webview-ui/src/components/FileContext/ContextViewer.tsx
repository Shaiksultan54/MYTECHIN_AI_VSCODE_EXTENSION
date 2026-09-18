import type { JSX } from 'react';
import type { ContextItemView, ContextSummaryView } from '../../../../src/shared/types.js';
import { post } from '../../vscode.js';
import { Icon } from '../Icon.js';

function groupIcon(kind: ContextItemView['kind']): string {
  switch (kind) {
    case 'selection':
      return 'selection';
    case 'problems':
      return 'warning';
    case 'workspace':
      return 'project';
    case 'terminal':
      return 'terminal';
    case 'folder':
      return 'folder';
    default:
      return 'file-code';
  }
}

const ORDER: ContextItemView['kind'][] = ['file', 'selection', 'folder', 'problems', 'terminal', 'workspace'];
const TITLES: Record<ContextItemView['kind'], string> = {
  file: 'Files',
  selection: 'Selection',
  folder: 'Folders',
  problems: 'Problems',
  terminal: 'Terminal',
  workspace: 'Workspace'
};

/** Answers "what did the model actually see?" — the trust surface of the agent. */
export function ContextViewer({ summary }: { summary: ContextSummaryView | undefined }): JSX.Element {
  if (!summary) {
    return (
      <div className="panel">
        <p className="empty-hint">Send a message first. Context is gathered per request.</p>
      </div>
    );
  }

  const percent = Math.min(100, Math.round((summary.totalTokens / Math.max(1, summary.budgetTokens)) * 100));

  return (
    <div className="panel">
      <p className="panel-lead">Context used for the last request</p>

      <div className="budget">
        <div className="budget-bar">
          <div className="budget-fill" style={{ width: `${percent}%` }} />
        </div>
        <span className="budget-text">
          ~{summary.totalTokens.toLocaleString()} of {summary.budgetTokens.toLocaleString()} tokens
          {summary.droppedCount > 0 ? ` · ${summary.droppedCount} dropped to fit` : ''}
        </span>
      </div>

      {ORDER.map((kind) => {
        const items = summary.items.filter((item) => item.kind === kind);
        if (items.length === 0) {
          return null;
        }
        return (
          <section key={kind} className="context-group">
            <h4>{TITLES[kind]}</h4>
            {items.map((item, index) => (
              <button
                key={`${item.label}-${index}`}
                type="button"
                className="context-item"
                disabled={!item.uri}
                onClick={() => item.uri && post({ type: 'openFile', uri: item.uri })}
                title={item.reason}
              >
                <Icon name={groupIcon(item.kind)} />
                <span className="context-label">{item.label}</span>
                {item.detail ? <span className="context-detail">{item.detail}</span> : null}
                <span className="context-tokens">{item.tokens.toLocaleString()}</span>
              </button>
            ))}
          </section>
        );
      })}
    </div>
  );
}
