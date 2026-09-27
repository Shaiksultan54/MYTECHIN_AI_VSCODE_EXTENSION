import { useCallback, useEffect, type JSX } from 'react';
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

const PANEL_TITLE: Record<Panel, string> = {
  chat: 'Mytechin AI',
  settings: 'Settings',
  history: 'History',
  context: 'Context',
  memory: 'Memory'
};

export function App(): JSX.Element {
  const state = useAppState();
  const dispatch = useDispatch();
  const busy = useBusy();

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

  if (!state.ready || !state.settings) {
    return (
      <div className="app app-loading">
        <Icon name="loading" spin /> Starting…
      </div>
    );
  }

  const activeProvider = state.providers.find((provider) => provider.id === state.settings?.provider);
  const isChat = state.panel === 'chat';

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
          <span className="app-title">{PANEL_TITLE[state.panel]}</span>
        </div>
        <nav className="app-nav" aria-label="Workspace views">
          {(['chat', 'context', 'history', 'memory', 'settings'] as Panel[]).map((panel) => (
            <button
              key={panel}
              type="button"
              className={`nav-button${state.panel === panel ? ' nav-button-active' : ''}`}
              aria-label={PANEL_TITLE[panel]}
              aria-current={state.panel === panel ? 'page' : undefined}
              title={PANEL_TITLE[panel]}
              onClick={() => setPanel(panel)}
            >
              <Icon name={panel === 'chat' ? 'comment-discussion' : panel === 'context' ? 'references' : panel === 'history' ? 'history' : panel === 'memory' ? 'book' : 'settings-gear'} />
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
          <ContextViewer summary={state.context} />
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
    </div>
  );
}
