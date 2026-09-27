import type { JSX } from 'react';
import type { ProviderStatusView, WorkspaceSummary } from '../../../../src/shared/types.js';
import { post } from '../../vscode.js';
import { Icon } from '../Icon.js';

export interface EmptyStateProps {
  workspace: WorkspaceSummary | undefined;
  provider: ProviderStatusView | undefined;
  onConfigure: () => void;
}

const STARTERS = [
  'Find where authentication is implemented and explain how login works.',
  'What does this project do? Summarise the architecture.',
  'Review @currentFile for bugs and edge cases.',
  'Fix the errors in @problems.'
];

export function EmptyState({ workspace, provider, onConfigure }: EmptyStateProps): JSX.Element {
  const configured = provider?.state === 'connected';

  return (
    <div className="empty-state">
      <div className="empty-hero">
        <span className="empty-hero-mark"><Icon name="sparkle" /></span>
        <div>
          <h2>Build with confidence</h2>
          <p className="empty-lead">A project-aware coding assistant that understands your workspace.</p>
        </div>
      </div>

      {workspace && workspace.folders.length > 0 ? (
        <div className="workspace-card">
          <span className="workspace-name">
            <Icon name="folder-opened" /> {workspace.name}
          </span>
          {workspace.languages.length > 0 || workspace.frameworks.length > 0 ? (
            <span className="workspace-meta">
              {[...workspace.frameworks, ...workspace.languages].slice(0, 5).join(' · ')}
            </span>
          ) : null}
          {workspace.files > 0 ? (
            <span className="workspace-meta">
              {workspace.files.toLocaleString()} files
              {workspace.sourceRoots.length > 0 ? ` · ${workspace.sourceRoots.slice(0, 3).join(', ')}` : ''}
            </span>
          ) : null}
        </div>
      ) : (
        <p className="empty-hint">No folder is open. Open a project to give the agent context.</p>
      )}

      {configured ? (
        <>
          <p className="empty-hint">Start with a question, attach context, or choose a workflow below.</p>
          <div className="starters">
            {STARTERS.map((starter) => (
              <button key={starter} type="button" className="starter" onClick={() => post({ type: 'sendPrompt', text: starter })}>
                <Icon name="arrow-right" />
                {starter}
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="empty-configure">
          <p className="empty-hint">
            {provider ? `${provider.name} is not ready.` : 'No AI provider configured.'}
            {provider?.message ? ` ${provider.message}` : ''}
          </p>
          <button type="button" className="button-primary" onClick={onConfigure}>
            Configure provider
          </button>
        </div>
      )}

      <p className="provider-line">
        <span className="provider-line-label">Provider</span>
        <span>{provider?.name ?? '—'}</span>
        <span className={`provider-state state-${provider?.state ?? 'not-configured'}`}>
          <Icon name={configured ? 'circle-filled' : 'circle-outline'} />
          {configured ? 'Connected' : provider?.state === 'error' ? 'Error' : 'Not configured'}
        </span>
      </p>
    </div>
  );
}
