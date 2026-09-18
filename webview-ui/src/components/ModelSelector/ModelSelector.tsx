import { useMemo, useState, type JSX } from 'react';
import type { ModelInfo, ProviderId, ProviderStatusView } from '../../../../src/shared/types.js';
import { post } from '../../vscode.js';
import { Icon } from '../Icon.js';

export interface ModelSelectorProps {
  providers: ProviderStatusView[];
  models: ModelInfo[];
  provider: ProviderId;
  model: string;
}

function stateIcon(state: ProviderStatusView['state']): { name: string; className: string } {
  switch (state) {
    case 'connected':
      return { name: 'circle-filled', className: 'state-ok' };
    case 'error':
      return { name: 'warning', className: 'state-bad' };
    case 'checking':
      return { name: 'loading', className: 'state-muted' };
    default:
      return { name: 'circle-outline', className: 'state-muted' };
  }
}

/** Compact provider/model picker with search, sized for a narrow sidebar. */
export function ModelSelector({ providers, models, provider, model }: ModelSelectorProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const active = providers.find((p) => p.id === provider);
  const status = stateIcon(active?.state ?? 'not-configured');

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = needle.length === 0 ? models : models.filter((m) => m.id.toLowerCase().includes(needle) || m.name.toLowerCase().includes(needle));
    return list.slice(0, 50);
  }, [models, query]);

  return (
    <div className="model-selector">
      <button
        type="button"
        className="model-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        title={active?.message ?? active?.name}
      >
        <Icon name={status.name} className={status.className} spin={active?.state === 'checking'} />
        <span className="model-name">{model || 'Select model'}</span>
        <Icon name="chevron-up" className="model-chevron" />
      </button>

      {open ? (
        <div className="menu model-menu" role="dialog" aria-label="Choose provider and model">
          <div className="model-providers">
            {providers.map((item) => {
              const state = stateIcon(item.state);
              return (
                <button
                  key={item.id}
                  type="button"
                  className={item.id === provider ? 'menu-item-active' : undefined}
                  onClick={() => post({ type: 'selectProvider', providerId: item.id })}
                  title={item.message}
                >
                  <Icon name={state.name} className={state.className} />
                  <span>{item.name}</span>
                  {item.isCloud ? <Icon name="cloud" className="cloud-hint" title="Cloud provider" /> : null}
                </button>
              );
            })}
          </div>

          <div className="model-search">
            <Icon name="search" />
            <input
              type="text"
              value={query}
              placeholder="Search models"
              aria-label="Search models"
              onChange={(event) => setQuery(event.target.value)}
            />
            <button type="button" className="icon-button" title="Refresh models" onClick={() => post({ type: 'refreshModels' })}>
              <Icon name="refresh" />
            </button>
          </div>

          <div className="model-list">
            {filtered.length === 0 ? (
              <p className="empty-hint">
                No models. {active?.requiresSecret && !active.hasSecret ? 'Add a credential in Settings.' : 'Check the provider connection.'}
              </p>
            ) : (
              filtered.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={item.id === model ? 'menu-item-active' : undefined}
                  onClick={() => {
                    post({ type: 'selectModel', modelId: item.id });
                    setOpen(false);
                  }}
                >
                  <span className="model-list-name">{item.name}</span>
                  {item.supportsTools ? <Icon name="tools" title="Supports tool calling" /> : null}
                </button>
              ))
            )}
          </div>

          <div className="model-footer">
            <button type="button" className="link-button" onClick={() => post({ type: 'testConnection' })}>
              Test connection
            </button>
            <button type="button" className="link-button" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
