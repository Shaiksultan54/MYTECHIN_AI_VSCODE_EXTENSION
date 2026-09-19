import { useEffect, useState, type JSX } from 'react';
import type {
  ApprovalMode,
  ProviderStatusView,
  SettingsView as Settings
} from '../../../../src/shared/types.js';
import { post } from '../../vscode.js';
import { Icon } from '../Icon.js';

export interface SettingsViewProps {
  settings: Settings;
  providers: ProviderStatusView[];
  mcpServers: import('../../../../src/shared/types.js').McpServerStatusView[];
}

const APPROVAL_MODES: { value: ApprovalMode; label: string; detail: string }[] = [
  { value: 'alwaysAsk', label: 'Always ask', detail: 'Approve every tool, including reads.' },
  {
    value: 'askForRisky',
    label: 'Ask for risky actions',
    detail: 'Reads run automatically; edits and commands need approval.'
  },
  {
    value: 'autoApproveSafe',
    label: 'Auto-approve safe actions',
    detail: 'Reads and edits run automatically; commands and deletions still ask.'
  },
  { value: 'autonomous', label: 'Fully autonomous', detail: 'Never asks. Use with care.' }
];

/** Number fields commit on blur so a half-typed value never reaches settings. */
function NumberField(props: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
  onCommit: (value: number) => void;
}): JSX.Element {
  const [draft, setDraft] = useState(String(props.value));
  useEffect(() => setDraft(String(props.value)), [props.value]);

  return (
    <label className="field">
      <span className="field-label">{props.label}</span>
      <input
        type="number"
        value={draft}
        min={props.min}
        max={props.max}
        step={props.step}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const parsed = Number(draft);
          if (Number.isFinite(parsed)) {
            props.onCommit(parsed);
          } else {
            setDraft(String(props.value));
          }
        }}
      />
      {props.hint ? <span className="field-hint">{props.hint}</span> : null}
    </label>
  );
}

function TextField(props: {
  label: string;
  value: string;
  placeholder?: string;
  hint?: string;
  onCommit: (value: string) => void;
}): JSX.Element {
  const [draft, setDraft] = useState(props.value);
  useEffect(() => setDraft(props.value), [props.value]);

  return (
    <label className="field">
      <span className="field-label">{props.label}</span>
      <input
        type="text"
        value={draft}
        placeholder={props.placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => props.onCommit(draft.trim())}
      />
      {props.hint ? <span className="field-hint">{props.hint}</span> : null}
    </label>
  );
}

export function SettingsView({ settings, providers, mcpServers }: SettingsViewProps): JSX.Element {
  const active = providers.find((provider) => provider.id === settings.provider);

  return (
    <div className="panel">
      <section className="settings-section">
        <h4>Provider</h4>
        <div className="provider-grid">
          {providers.map((provider) => (
            <button
              key={provider.id}
              type="button"
              className={`provider-card${provider.id === settings.provider ? ' provider-active' : ''}`}
              onClick={() => post({ type: 'selectProvider', providerId: provider.id })}
            >
              <span className="provider-name">{provider.name}</span>
              <span className={`provider-state state-${provider.state}`}>
                <Icon
                  name={
                    provider.state === 'connected'
                      ? 'circle-filled'
                      : provider.state === 'error'
                        ? 'warning'
                        : 'circle-outline'
                  }
                />
                {provider.state === 'connected'
                  ? 'Connected'
                  : provider.state === 'error'
                    ? 'Error'
                    : 'Not configured'}
              </span>
              {provider.isCloud ? <span className="provider-cloud">Cloud</span> : <span className="provider-cloud provider-local">Local</span>}
            </button>
          ))}
        </div>

        {active?.message ? <p className="field-hint">{active.message}</p> : null}

        <div className="button-row">
          <button type="button" className="button-secondary" onClick={() => post({ type: 'testConnection' })}>
            <Icon name="plug" /> Test connection
          </button>
          <button type="button" className="button-secondary" onClick={() => post({ type: 'refreshModels' })}>
            <Icon name="refresh" /> Refresh models
          </button>
        </div>

        {active?.requiresSecret ? (
          <div className="button-row">
            <button type="button" className="button-secondary" onClick={() => post({ type: 'setSecret', providerId: active.id })}>
              <Icon name="key" /> {active.hasSecret ? 'Replace credential' : 'Add credential'}
            </button>
            {active.hasSecret ? (
              <button type="button" className="button-secondary" onClick={() => post({ type: 'clearSecret', providerId: active.id })}>
                Remove
              </button>
            ) : null}
          </div>
        ) : null}

        <p className="field-hint">
          Credentials live in VS Code SecretStorage. They are never written to settings.json and never
          reach this view.
        </p>
      </section>

      {settings.provider === 'ollama' ? (
        <section className="settings-section">
          <h4>Ollama</h4>
          <TextField
            label="Endpoint"
            value={settings.ollamaEndpoint}
            placeholder="http://127.0.0.1:11434"
            hint="Requests stay on this machine."
            onCommit={(value) => post({ type: 'saveSettings', patch: { ollamaEndpoint: value } })}
          />
        </section>
      ) : null}

      {settings.provider === 'openai-compatible' ? (
        <section className="settings-section">
          <h4>OpenAI-compatible / Custom API</h4>
          <TextField
            label="Base URL"
            value={settings.openaiCompatibleBaseUrl}
            placeholder="https://api.kie.ai/v1"
            onCommit={(value) => post({ type: 'saveSettings', patch: { openaiCompatibleBaseUrl: value } })}
          />
          <TextField
            label="Organization"
            value={settings.openaiCompatibleOrganization}
            placeholder="optional"
            onCommit={(value) =>
              post({ type: 'saveSettings', patch: { openaiCompatibleOrganization: value } })
            }
          />
        </section>
      ) : null}

      {settings.provider === 'puter' ? (
        <section className="settings-section">
          <h4>Puter</h4>
          <p className="field-hint" style={{ marginTop: 0, lineHeight: 1.6 }}>
            <strong>🆓 Free to use!</strong> Puter auto-creates a free session automatically — no API key needed.
            Just select a model below and start chatting. For a persistent account, sign up at{' '}
            <a href="https://puter.com" style={{ color: 'var(--vscode-textLink-foreground)' }}>puter.com</a>{' '}
            and add your token with the "Add credential" button above.
          </p>
          <TextField
            label="Base URL"
            value={settings.puterBaseUrl}
            placeholder="https://api.puter.com"
            hint="Leave as default unless you're self-hosting Puter."
            onCommit={(value) => post({ type: 'saveSettings', patch: { puterBaseUrl: value } })}
          />
        </section>
      ) : null}

      {settings.provider === 'gemini' ? (
        <section className="settings-section">
          <h4>Google Gemini (Google AI Studio)</h4>
          <p className="field-hint" style={{ marginTop: 0, lineHeight: 1.6 }}>
            <strong>🆓 Generous Free Tier!</strong> Get a free API key for Gemini Flash and Pro models at{' '}
            <a href="https://aistudio.google.com/app/apikey" style={{ color: 'var(--vscode-textLink-foreground)' }}>Google AI Studio</a>.
            Add your token using the "Add credential" button above.
          </p>
        </section>
      ) : null}

      {settings.provider === 'groq' ? (
        <section className="settings-section">
          <h4>Groq</h4>
          <p className="field-hint" style={{ marginTop: 0, lineHeight: 1.6 }}>
            <strong>⚡ Ultra-fast Inference!</strong> Groq offers high-speed inference for open-weights models like Llama 3 and Mixtral. Get your free API key at{' '}
            <a href="https://console.groq.com/" style={{ color: 'var(--vscode-textLink-foreground)' }}>Groq Console</a>.
          </p>
        </section>
      ) : null}

      {settings.provider === 'openrouter' ? (
        <section className="settings-section">
          <h4>OpenRouter</h4>
          <p className="field-hint" style={{ marginTop: 0, lineHeight: 1.6 }}>
            <strong>🔄 Multi-Model Router!</strong> Access dozens of free variants and premium models instantly. Automatically filters for tool calling and vision. Get your key at{' '}
            <a href="https://openrouter.ai/" style={{ color: 'var(--vscode-textLink-foreground)' }}>OpenRouter</a>.
          </p>
        </section>
      ) : null}

      {settings.provider === 'github' ? (
        <section className="settings-section">
          <h4>GitHub Models</h4>
          <p className="field-hint" style={{ marginTop: 0, lineHeight: 1.6 }}>
            <strong>🛠️ Developer Friendly!</strong> Use your GitHub account to access popular models in the GitHub ecosystem for free. Find out more at{' '}
            <a href="https://github.com/marketplace/models" style={{ color: 'var(--vscode-textLink-foreground)' }}>GitHub Models</a>.
          </p>
        </section>
      ) : null}

      <section className="settings-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h4 style={{ margin: 0 }}>MCP Servers</h4>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              // Normally this would open a dialog or command palette, let's keep it simple for now
              post({ type: 'addMcpServer', config: { id: `mcp-${Date.now()}`, command: 'npx', args: ['-y', '@modelcontextprotocol/server-everything'] } });
            }}
          >
            Add
          </button>
        </div>
        <p className="field-hint" style={{ marginTop: 0, lineHeight: 1.6 }}>
          Model Context Protocol servers provide additional tools and context.
        </p>
        
        {mcpServers.length === 0 ? (
          <div className="field-hint">No MCP servers configured.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {mcpServers.map((server) => (
              <div key={server.id} style={{ border: '1px solid var(--vscode-widget-border)', padding: 12, borderRadius: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div>
                    <strong style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {server.config.id}
                      <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: server.state === 'connected' ? 'var(--vscode-testing-iconPassed)' : server.state === 'error' ? 'var(--vscode-testing-iconFailed)' : 'var(--vscode-badge-background)', color: server.state === 'connected' ? '#fff' : 'inherit' }}>
                        {server.state}
                      </span>
                    </strong>
                    <div className="field-hint" style={{ marginTop: 4 }}>
                      <code style={{ fontSize: 11 }}>{server.config.command} {server.config.args?.join(' ')}</code>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button type="button" className="icon-button" title={server.config.disabled ? "Enable" : "Disable"} onClick={() => post({ type: 'toggleMcpServer', id: server.id, disabled: !server.config.disabled })}>
                      <Icon name={server.config.disabled ? 'play' : 'stop'} />
                    </button>
                    {!server.config.disabled && (
                      <button type="button" className="icon-button" title="Restart" onClick={() => post({ type: 'restartMcpServer', id: server.id })}>
                        <Icon name="refresh" />
                      </button>
                    )}
                    <button type="button" className="icon-button" title="Remove" onClick={() => post({ type: 'removeMcpServer', id: server.id })}>
                      <Icon name="trash" />
                    </button>
                  </div>
                </div>
                {server.error ? (
                  <div className="field-hint" style={{ color: 'var(--vscode-testing-iconFailed)' }}>
                    {server.error}
                  </div>
                ) : null}
                {server.tools.length > 0 ? (
                  <div className="field-hint" style={{ marginTop: 8 }}>
                    <strong>{server.tools.length} tools</strong>: {server.tools.map(t => t.name).join(', ')}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="settings-section">
        <h4>Approval</h4>
        {APPROVAL_MODES.map((mode) => (
          <label key={mode.value} className="radio">
            <input
              type="radio"
              name="approvalMode"
              checked={settings.approvalMode === mode.value}
              onChange={() => post({ type: 'saveSettings', patch: { approvalMode: mode.value } })}
            />
            <span>
              <span className="radio-label">{mode.label}</span>
              <span className="field-hint">{mode.detail}</span>
            </span>
          </label>
        ))}
      </section>

      <section className="settings-section">
        <h4>Agent</h4>
        <NumberField
          label="Max tool calls per task"
          value={settings.maxToolIterations}
          min={1}
          max={200}
          onCommit={(value) => post({ type: 'saveSettings', patch: { maxToolIterations: value } })}
        />
        <NumberField
          label="Context budget (tokens)"
          value={settings.maxContextTokens}
          min={2000}
          step={1000}
          hint="Approximate. Files are trimmed to fit before the request is sent."
          onCommit={(value) => post({ type: 'saveSettings', patch: { maxContextTokens: value } })}
        />
        <NumberField
          label="Max reply tokens"
          value={settings.maxTokens}
          min={256}
          step={256}
          onCommit={(value) => post({ type: 'saveSettings', patch: { maxTokens: value } })}
        />
        <NumberField
          label="Temperature"
          value={settings.temperature}
          min={0}
          max={2}
          step={0.1}
          onCommit={(value) => post({ type: 'saveSettings', patch: { temperature: value } })}
        />

        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.streaming}
            onChange={(event) => post({ type: 'saveSettings', patch: { streaming: event.target.checked } })}
          />
          Stream replies
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.enableCheckpoints}
            onChange={(event) =>
              post({ type: 'saveSettings', patch: { enableCheckpoints: event.target.checked } })
            }
          />
          Snapshot files before the agent edits them
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.autoApproveSafeTools}
            onChange={(event) =>
              post({ type: 'saveSettings', patch: { autoApproveSafeTools: event.target.checked } })
            }
          />
          Let read-only tools run without asking
        </label>
      </section>

      <section className="settings-section">
        <h4>Semantic Search</h4>
        <div className="button-row">
          <button type="button" className="link-button" onClick={() => post({ type: 'rebuildSemanticIndex' })}>
            Rebuild Index
          </button>
        </div>
        <div className="field-hint" style={{ marginTop: '8px' }}>
          Uses Ollama locally to embed your codebase for semantic search. Rebuilding happens in the background.
        </div>
      </section>

      <section className="settings-section">
        <div className="button-row">
          <button type="button" className="link-button" onClick={() => post({ type: 'openExtensionSettings' })}>
            All settings
          </button>
          <button type="button" className="link-button" onClick={() => post({ type: 'showLogs' })}>
            Output log
          </button>
        </div>
      </section>
    </div>
  );
}
