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

export function SettingsView({ settings, providers }: SettingsViewProps): JSX.Element {
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
