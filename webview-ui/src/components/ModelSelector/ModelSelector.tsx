import { useEffect, useMemo, useState, type JSX, type KeyboardEvent as ReactKeyboardEvent } from 'react';
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
  const [highlight, setHighlight] = useState(0);

  useEffect(() => {
    const openPicker = (): void => setOpen(true);
    window.addEventListener('mytechin:open-model-picker', openPicker);
    return () => window.removeEventListener('mytechin:open-model-picker', openPicker);
  }, []);

  const active = providers.find((p) => p.id === provider);
  const status = stateIcon(active?.state ?? 'not-configured');

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = needle.length === 0 ? models : models.filter((m) => m.id.toLowerCase().includes(needle) || m.name.toLowerCase().includes(needle));
    return list.slice(0, 50);
  }, [models, query]);

  useEffect(() => setHighlight(0), [query, provider]);

  const selectModel = (modelId: string): void => {
    post({ type: 'selectModel', modelId });
    setOpen(false);
  };

  const onSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight((value) => Math.min(value + 1, Math.max(0, filtered.length - 1)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((value) => Math.max(0, value - 1));
    } else if (event.key === 'Enter' && filtered[highlight]) {
      event.preventDefault();
      selectModel(filtered[highlight].id);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
  };

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
        <span className="model-button-status">
          <Icon name={status.name} className={status.className} spin={active?.state === 'checking'} />
        </span>
        <span className="model-button-copy">
          <span className="model-button-label">Model</span>
          <span className="model-name">{model || 'Select model'}</span>
        </span>
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
                  className={item.id === provider ? 'menu-item-active provider-item-active' : 'provider-item'}
                  onClick={() => post({ type: 'selectProvider', providerId: item.id })}
                  title={item.message}
                >
                  <Icon name={state.name} className={state.className} />
                  <span>{item.name}</span>
                  {item.isCloud ? <span className="provider-pill">Cloud</span> : <span className="provider-pill local">Local</span>}
                  {item.requiresSecret ? <span className={`provider-credential${item.hasSecret ? ' configured' : ''}`}>{item.hasSecret ? 'Configured' : 'Needs key'}</span> : null}
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
              onKeyDown={onSearchKeyDown}
              autoFocus
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
              <>
                {filtered.filter((m) => m.isFree).length > 0 && (
                  <>
                    <div className="model-group-header">FREE VIA PUTER</div>
                    {filtered.filter((m) => m.isFree).map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={`${item.id === model ? 'menu-item-active ' : ''}${filtered[highlight]?.id === item.id ? 'model-item-highlight' : ''}`}
                        onClick={() => selectModel(item.id)}
                      >
                        <span className="model-list-name">{item.name}</span>
                        {item.supportsTools || item.capabilities?.toolCalling ? <span className="model-capability" title="Tool calling supported"><Icon name="tools" /></span> : null}
                        {item.supportsVision || item.capabilities?.vision ? <span className="model-capability" title="Vision supported"><Icon name="eye" /></span> : null}
                        {item.contextWindow ? <span className="model-context">{Math.round(item.contextWindow / 1000)}K</span> : null}
                      </button>
                    ))}
                  </>
                )}
                {filtered.filter((m) => !m.isFree).length > 0 && (
                  <>
                    {filtered.filter((m) => m.isFree).length > 0 && <div className="model-group-header">OTHER</div>}
                    {filtered.filter((m) => !m.isFree).map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={`${item.id === model ? 'menu-item-active ' : ''}${filtered[highlight]?.id === item.id ? 'model-item-highlight' : ''}`}
                        onClick={() => selectModel(item.id)}
                      >
                        <span className="model-list-name">{item.name}</span>
                        {item.supportsTools || item.capabilities?.toolCalling ? <span className="model-capability" title="Tool calling supported"><Icon name="tools" /></span> : null}
                        {item.supportsVision || item.capabilities?.vision ? <span className="model-capability" title="Vision supported"><Icon name="eye" /></span> : null}
                        {item.contextWindow ? <span className="model-context">{Math.round(item.contextWindow / 1000)}K</span> : null}
                      </button>
                    ))}
                  </>
                )}
              </>
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
