import { useCallback, useEffect, useState, type JSX } from 'react';
import { Command } from 'cmdk';
import { useAppState, useBusy, useDispatch, type Panel } from './state/store.js';

import { Icon } from './components/Icon.js';
import { MessageList } from './components/Chat/MessageList.js';
import { EmptyState } from './components/Chat/EmptyState.js';
import { Composer } from './components/Composer/Composer.js';
import { ModelSelector } from './components/ModelSelector/ModelSelector.js';
import { SettingsView } from './components/Settings/SettingsView.js';
import { HistoryView } from './components/History/HistoryView.js';
import { ContextViewer } from './components/FileContext/ContextViewer.js';
import { MemoryView } from './components/Memory/MemoryView.js';
import { post } from './vscode.js';

const NAV_ITEMS: Array<{ panel: Panel; label: string; icon: string }> = [
  { panel: 'chat', label: 'Chat', icon: 'comment-discussion' },
  { panel: 'history', label: 'History', icon: 'history' },
  { panel: 'context', label: 'Context', icon: 'references' },
  { panel: 'memory', label: 'Memory', icon: 'book' },
  { panel: 'settings', label: 'Settings', icon: 'settings-gear' }
];

function Inspector({ state, busy, onPanel }: { state: ReturnType<typeof useAppState>; busy: boolean; onPanel: (panel: Panel) => void }): JSX.Element {
  const activeMessage = [...state.messages].reverse().find((message) => message.role === 'assistant');
  const activeProvider = state.providers.find((provider) => provider.id === state.settings?.provider);
  const [clock, setClock] = useState(Date.now());
  const tools = state.messages.flatMap((message) => message.toolCalls ?? []);
  const taskTools = activeMessage?.toolCalls?.length ?? 0;
  const totalContext = state.context?.totalTokens ?? 0;
  const contextBudget = state.context?.budgetTokens ?? state.settings?.maxContextTokens ?? 0;
  const contextPercent = contextBudget > 0 ? Math.min(100, (totalContext / contextBudget) * 100) : 0;
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);
  const elapsedMs = activeMessage ? Math.max(0, clock - activeMessage.createdAt) : 0;
  const elapsedSeconds = Math.floor(elapsedMs / 1000);
  return (
    <aside className="inspector" aria-label="Agent inspector">
      <div className="inspector-heading"><span>Agent activity</span><span className={`status-dot status-${busy ? 'active' : 'ready'}`} /></div>
      <div className="inspector-status"><Icon name={busy ? 'loading' : 'check'} spin={busy} /><span>{state.phaseLabel || (busy ? 'Working' : 'Ready')}</span></div>
      <section className="inspector-section">
        <div className="inspector-section-title">Provider</div>
        <div className="metric-row"><span>{activeProvider?.name ?? 'Not selected'}</span><span>{activeProvider?.isCloud ? 'Cloud' : 'Local'}</span></div>
        <div className="metric-caption">{activeProvider?.requiresSecret ? (activeProvider.hasSecret ? 'Credential configured' : 'Credential required') : 'No API key required'}</div>
        {activeProvider?.isCloud ? <div className="privacy-note"><Icon name="shield" /> Selected context may leave this machine.</div> : <div className="privacy-note privacy-local"><Icon name="lock" /> Requests stay local for this provider.</div>}
      </section>
      <section className="inspector-section">
        <div className="inspector-section-title">Task time</div>
        <div className="metric-row"><span>Elapsed</span><strong>{elapsedSeconds}s</strong></div>
      </section>
      <section className="inspector-section">
        <div className="inspector-section-title">Context <button type="button" className="link-button" onClick={() => onPanel('context')}>Inspect</button></div>
        <div className="metric-row"><span>{state.context?.items.length ?? 0} items</span><span>{totalContext.toLocaleString()} tokens</span></div>
        <div className="inspector-progress"><span style={{ width: `${contextPercent}%` }} /></div>
        <div className="metric-caption">{contextBudget.toLocaleString()} token budget</div>
      </section>
      <section className="inspector-section">
        <div className="inspector-section-title">Tools <span className="metric-caption">{tools.length}</span></div>
        {tools.length === 0 ? <div className="metric-caption">No tool activity yet.</div> : <div className="inspector-tools">{tools.slice(-6).map((tool) => <div className="inspector-tool" key={tool.callId}><Icon name={tool.status === 'success' ? 'check' : tool.status === 'running' ? 'loading' : 'warning'} spin={tool.status === 'running'} /><span>{tool.title}</span></div>)}</div>}
      </section>
      <section className="inspector-section">
        <div className="inspector-section-title">Usage</div>
        <div className="metric-row"><span>Prompt</span><strong>{state.usage.promptTokens.toLocaleString()}</strong></div>
        <div className="metric-row"><span>Completion</span><strong>{state.usage.completionTokens.toLocaleString()}</strong></div>
      </section>
      <section className="inspector-section">
        <div className="inspector-section-title">Task budget</div>
        <div className="metric-row"><span>Tool calls</span><strong>{taskTools} / {state.settings?.maxToolIterations ?? 0}</strong></div>
        <div className="inspector-progress"><span style={{ width: `${Math.min(100, (taskTools / Math.max(1, state.settings?.maxToolIterations ?? 1)) * 100)}%` }} /></div>
        <div className="metric-caption">Stops safely when the configured limit is reached.</div>
      </section>
    </aside>
  );
}

function CommandPalette({ onClose, onPanel }: { onClose: () => void; onPanel: (panel: Panel) => void }): JSX.Element {
  const actions: Array<{ label: string; icon: string; run: () => void }> = [
    { label: 'New Chat', icon: 'add', run: () => post({ type: 'newConversation' }) },
    { label: 'Focus Composer', icon: 'edit', run: () => document.querySelector<HTMLTextAreaElement>('.composer-input')?.focus() },
    { label: 'Change Model', icon: 'symbol-namespace', run: () => window.dispatchEvent(new Event('mytechin:open-model-picker')) },
    { label: 'Stop Agent', icon: 'debug-stop', run: () => post({ type: 'stopAgent' }) },
    { label: 'Show Context', icon: 'references', run: () => onPanel('context') },
    { label: 'Open History', icon: 'history', run: () => onPanel('history') },
    { label: 'Open Memory', icon: 'book', run: () => onPanel('memory') },
    { label: 'Open Settings', icon: 'settings-gear', run: () => onPanel('settings') },
    { label: 'Configure Provider', icon: 'plug', run: () => onPanel('settings') },
    { label: 'Show Logs', icon: 'output', run: () => post({ type: 'showLogs' }) },
    { label: 'Refresh Models', icon: 'refresh', run: () => post({ type: 'refreshModels' }) }
  ];
  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={onClose}>
      <Command
        className="command-palette"
        label="Command palette"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <div className="palette-input">
          <Icon name="search" />
          <Command.Input autoFocus placeholder="Type a command…" aria-label="Search commands" />
        </div>
        <Command.List className="palette-list">
          <Command.Empty className="palette-empty">No matching commands.</Command.Empty>
          {actions.map((action) => (
            <Command.Item
              key={action.label}
              value={action.label}
              onSelect={() => {
                action.run();
                onClose();
              }}
            >
              <Icon name={action.icon} />
              <span>{action.label}</span>
            </Command.Item>
          ))}
        </Command.List>
        <div className="palette-hint">↑↓ navigate · Enter run · Esc close</div>
      </Command>
    </div>
  );
}

export function App(): JSX.Element {
  const state = useAppState();
  const dispatch = useDispatch();
  const busy = useBusy();
  const [paletteOpen, setPaletteOpen] = useState(false);

  const setPanel = useCallback(
    (panel: Panel) => dispatch({ kind: 'setPanel', panel }),
    [dispatch]
  );

  // The showContext command lands here.

  useEffect(() => {
    if (!state.notice) {
      return;
    }
    const timer = window.setTimeout(() => dispatch({ kind: 'dismissNotice' }), 6000);
    return () => window.clearTimeout(timer);
  }, [state.notice, dispatch]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        window.dispatchEvent(new Event('mytechin:open-model-picker'));
      } else if (modifier && event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        setPaletteOpen(true);
      } else if (modifier && event.key.toLowerCase() === 'l') {
        event.preventDefault();
        document.querySelector<HTMLTextAreaElement>('.composer-input')?.focus();
      } else if (modifier && event.key.toLowerCase() === 'h') {
        event.preventDefault();
        setPanel('history');
      } else if (modifier && event.key === ',') {
        event.preventDefault();
        setPanel('settings');
      } else if (event.key === 'Escape') {
        setPaletteOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  if (!state.ready || !state.settings) {
    return (
      <div className="app app-loading">
        <Icon name="loading" spin /> Starting…
      </div>
    );
  }

  const activeProvider = state.providers.find((provider) => provider.id === state.settings?.provider);
  const isChat = state.panel === 'chat';
  const workspaceName = state.workspace?.name || 'No workspace';

  return (
    <div className="app">
      <header className="app-header">
        {!isChat ? (
          <button type="button" className="icon-button" title="Back to chat" aria-label="Back to chat" onClick={() => setPanel('chat')}>
            <Icon name="arrow-left" />
          </button>
        ) : null}
        <div className="brand-lockup">
          <span className="brand-mark"><Icon name="sparkle" /></span>
          <span className="app-title">MYTECHIN AI</span>
          <span className="workspace-name-header">{workspaceName}</span>
        </div>
        <div className="header-status" aria-label="Agent status"><span className="header-model">{state.settings.model || 'No model selected'}</span><span className={`status-badge status-badge-${busy ? 'active' : 'ready'}`}><span className="status-dot" />{busy ? state.phaseLabel || 'Working' : 'Ready'}</span></div>
        <nav className="app-nav" aria-label="Workspace views">
          {NAV_ITEMS.map(({ panel, label, icon }) => (
            <button
              key={panel}
              type="button"
              className={`nav-button${state.panel === panel ? ' nav-button-active' : ''}`}
              aria-label={label}
              aria-current={state.panel === panel ? 'page' : undefined}
              title={label}
              onClick={() => setPanel(panel)}
            >
              <Icon name={icon} />
            </button>
          ))}
        </nav>
      </header>

      {state.notice ? (
        <div className={`notice notice-${state.notice.level}`} role="status">
          <Icon name={state.notice.level === 'error' ? 'error' : state.notice.level === 'warn' ? 'warning' : 'info'} />
          <span>{state.notice.message}</span>
          <button type="button" className="icon-button" aria-label="Dismiss" onClick={() => dispatch({ kind: 'dismissNotice' })}>
            <Icon name="close" />
          </button>
        </div>
      ) : null}

      {state.error ? (
        <div className="notice notice-error" role="alert">
          <Icon name="error" />
          <span>
            <strong>{state.error.message}</strong>
            {state.error.hint ? <span className="notice-hint">{state.error.hint}</span> : null}
            {state.error.retryable ? <span className="notice-hint">Retrying is safe.</span> : null}
          </span>
          <button type="button" className="icon-button" aria-label="Dismiss" onClick={() => dispatch({ kind: 'dismissError' })}>
            <Icon name="close" />
          </button>
        </div>
      ) : null}

      <div className="workspace-shell">
      <aside className="navigation-rail" aria-label="Mytechin AI navigation">
        {NAV_ITEMS.map(({ panel, label, icon }) => <button key={panel} type="button" className={`rail-button${state.panel === panel ? ' rail-button-active' : ''}`} onClick={() => setPanel(panel)} aria-current={state.panel === panel ? 'page' : undefined} title={label}><Icon name={icon} /><span>{label}</span></button>)}
      </aside>
      <main className="app-body">
        {state.panel === 'settings' ? (
          <SettingsView settings={state.settings} providers={state.providers} mcpServers={state.mcpServers} />
        ) : state.panel === 'history' ? (
          <HistoryView
            conversations={state.conversations}
            checkpoints={state.checkpoints}
            currentId={state.conversationId}
          />
        ) : state.panel === 'context' ? (
          <ContextViewer summary={state.context} usage={state.usage} />
        ) : state.panel === 'memory' ? (
          <MemoryView entries={state.memory} />
        ) : state.messages.length === 0 ? (
          <EmptyState
            workspace={state.workspace}
            provider={activeProvider}
            onConfigure={() => setPanel('settings')}
          />
        ) : (
          <MessageList
            messages={state.messages}
            approvals={state.approvals}
            plan={state.plan}
            phaseLabel={state.phaseLabel}
            busy={busy}
          />
        )}
      </main>
      {isChat ? <Inspector state={state} busy={busy} onPanel={setPanel} /> : null}
      </div>

      <Composer
        attachments={state.attachments}
        busy={busy}
        mentions={state.mentions}
        prefill={state.prefill}
        onPrefillConsumed={() => dispatch({ kind: 'consumePrefill' })}
        modelSlot={
          <ModelSelector
            providers={state.providers}
            models={state.models}
            provider={state.settings.provider}
            model={state.settings.model}
          />
        }
      />
      {paletteOpen ? <CommandPalette onClose={() => setPaletteOpen(false)} onPanel={setPanel} /> : null}
    </div>
  );
}
