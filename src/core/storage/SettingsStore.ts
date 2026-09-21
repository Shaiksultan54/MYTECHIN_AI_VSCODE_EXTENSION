import * as vscode from 'vscode';
import { EXTENSION_ID } from '../../shared/constants/index.js';
import type { ApprovalMode, ProviderId, SettingsView } from '../../shared/types.js';
import type { SettingsPatch } from '../../shared/messages/index.js';

/** Reads and writes `mytechin.*` settings. Secrets never pass through here. */
export class SettingsStore {
  private readonly emitter = new vscode.EventEmitter<SettingsView>();
  readonly onDidChange = this.emitter.event;
  private readonly disposable: vscode.Disposable;

  constructor() {
    this.disposable = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(EXTENSION_ID)) {
        this.emitter.fire(this.read());
      }
    });
  }

  private get config(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration(EXTENSION_ID);
  }

  read(): SettingsView {
    const c = this.config;
    return {
      provider: c.get<ProviderId>('provider', 'ollama'),
      model: c.get<string>('model', ''),
      ollamaEndpoint: c.get<string>('ollama.endpoint', 'http://127.0.0.1:11434'),
      openaiCompatibleBaseUrl: c.get<string>('openaiCompatible.baseUrl', ''),
      openaiCompatibleOrganization: c.get<string>('openaiCompatible.organization', ''),
      puterBaseUrl: c.get<string>('puter.baseUrl', 'https://api.puter.com'),
      omniRouteBaseUrl: c.get<string>('omniroute.baseUrl', 'http://127.0.0.1:8000/v1'),
      approvalMode: c.get<ApprovalMode>('approvalMode', 'askForRisky'),
      autoApproveSafeTools: c.get<boolean>('autoApproveSafeTools', true),
      maxToolIterations: c.get<number>('maxToolIterations', 24),
      maxContextTokens: c.get<number>('maxContextTokens', 32000),
      maxFileReadBytes: c.get<number>('maxFileReadBytes', 262144),
      temperature: c.get<number>('temperature', 0.2),
      maxTokens: c.get<number>('maxTokens', 4096),
      streaming: c.get<boolean>('streaming', true),
      enableWorkspaceIndex: c.get<boolean>('enableWorkspaceIndex', true),
      enableCheckpoints: c.get<boolean>('enableCheckpoints', true),
      loggingLevel: c.get<string>('logging.level', 'info'),
      terminalTimeout: c.get<number>('terminalTimeout', 120000),
      warnOnSensitiveUpload: c.get<boolean>('warnOnSensitiveUpload', true)
    };
  }

  excludePatterns(): string[] {
    return this.config.get<string[]>('excludePatterns', []);
  }

  async update(patch: Partial<SettingsPatch>): Promise<void> {
    const keyMap: Record<keyof SettingsPatch, string> = {
      provider: 'provider',
      model: 'model',
      ollamaEndpoint: 'ollama.endpoint',
      openaiCompatibleBaseUrl: 'openaiCompatible.baseUrl',
      openaiCompatibleOrganization: 'openaiCompatible.organization',
      puterBaseUrl: 'puter.baseUrl',
      omniRouteBaseUrl: 'omniroute.baseUrl',
      approvalMode: 'approvalMode',
      autoApproveSafeTools: 'autoApproveSafeTools',
      maxToolIterations: 'maxToolIterations',
      maxContextTokens: 'maxContextTokens',
      temperature: 'temperature',
      maxTokens: 'maxTokens',
      streaming: 'streaming',
      enableCheckpoints: 'enableCheckpoints'
    };
    const target = vscode.workspace.workspaceFolders?.length
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;

    for (const [key, value] of Object.entries(patch)) {
      const settingKey = keyMap[key as keyof SettingsPatch];
      if (settingKey !== undefined && value !== undefined) {
        await this.config.update(settingKey, value, target);
      }
    }
  }

  dispose(): void {
    this.disposable.dispose();
    this.emitter.dispose();
  }
}
