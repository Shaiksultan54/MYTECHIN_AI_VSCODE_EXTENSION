import * as vscode from 'vscode';
import { EXTENSION_ID } from '../../shared/constants/index.js';
import type { AIProvider } from '../providers/AIProvider.js';
import { isSensitivePath } from '../workspace/PathSecurity.js';
import { Logger } from '../logging/Logger.js';
import {
  InlineCompletionEngine,
  type CompletionContext,
  type InlineCompletionSettings
} from './InlineCompletionEngine.js';

interface InlineConfig extends InlineCompletionSettings {
  enabled: boolean;
  debounceMs: number;
  disabledLanguages: string[];
}

function readConfig(): InlineConfig {
  const c = vscode.workspace.getConfiguration(`${EXTENSION_ID}.inlineCompletion`);
  return {
    enabled: c.get<boolean>('enabled', false),
    model: c.get<string>('model', ''),
    fillInMiddle: c.get<boolean>('fillInMiddle', true),
    debounceMs: Math.max(0, c.get<number>('debounceMs', 300)),
    maxPrefixChars: Math.max(200, c.get<number>('maxPrefixChars', 6000)),
    maxSuffixChars: Math.max(0, c.get<number>('maxSuffixChars', 2000)),
    maxTokens: Math.max(16, c.get<number>('maxTokens', 128)),
    maxLines: Math.max(1, c.get<number>('maxLines', 12)),
    disabledLanguages: c.get<string[]>('disabledLanguages', ['plaintext', 'scminput'])
  };
}

/** Waits `ms`, or resolves early (returning false) if the editor cancels the request. */
function debounce(ms: number, token: vscode.CancellationToken): Promise<boolean> {
  return new Promise((resolve) => {
    if (token.isCancellationRequested) {
      resolve(false);
      return;
    }
    const subscription = token.onCancellationRequested(() => {
      clearTimeout(timer);
      subscription.dispose();
      resolve(false);
    });
    const timer = setTimeout(() => {
      subscription.dispose();
      resolve(true);
    }, ms);
  });
}

/**
 * Copilot-style ghost text. Deliberately thin: everything that can be tested
 * without an editor lives in InlineCompletionEngine. The gating here is about
 * *whether* to ask â€” off by default, never for credential files, never while
 * the suggest widget is open or text is selected â€” because every request
 * sends code to the configured provider.
 */
class MytechinInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
  constructor(private readonly engine: InlineCompletionEngine) {}

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    const config = readConfig();
    if (!config.enabled) {
      return undefined;
    }
    if (document.uri.scheme !== 'file' && document.uri.scheme !== 'untitled') {
      return undefined;
    }
    if (config.disabledLanguages.includes(document.languageId) || isSensitivePath(document.uri.fsPath)) {
      return undefined;
    }
    if (context.selectedCompletionInfo) {
      return undefined;
    }
    const editor = vscode.window.activeTextEditor;
    if (editor?.document === document && !editor.selection.isEmpty) {
      return undefined;
    }

    // Bounded window around the cursor: a huge file must not mean a huge read.
    const startLine = Math.max(0, position.line - 400);
    const endLine = Math.min(document.lineCount - 1, position.line + 150);
    const ctx: CompletionContext = {
      prefix: document.getText(new vscode.Range(new vscode.Position(startLine, 0), position)),
      suffix: document.getText(new vscode.Range(position, document.lineAt(endLine).range.end)),
      languageId: document.languageId,
      relativePath: vscode.workspace.asRelativePath(document.uri, false)
    };
    if (ctx.prefix.trim().length === 0 && ctx.suffix.trim().length === 0) {
      return undefined;
    }

    if (!(await debounce(config.debounceMs, token))) {
      return undefined;
    }

    const controller = new AbortController();
    const subscription = token.onCancellationRequested(() => controller.abort());
    try {
      const text = await this.engine.complete(ctx, controller.signal);
      if (!text || token.isCancellationRequested) {
        return undefined;
      }
      return [new vscode.InlineCompletionItem(text, new vscode.Range(position, position))];
    } finally {
      subscription.dispose();
    }
  }
}

export interface InlineCompletionDeps {
  provider: () => Promise<AIProvider>;
  defaultModel: () => string;
}

/** Registers the provider, a status bar toggle, and the toggle command. */
export function registerInlineCompletion(deps: InlineCompletionDeps): vscode.Disposable[] {
  const logger = Logger.get();
  const engine = new InlineCompletionEngine({
    provider: deps.provider,
    defaultModel: deps.defaultModel,
    settings: readConfig,
    log: (message) => logger.debug(message)
  });

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  statusBar.command = `${EXTENSION_ID}.toggleInlineCompletion`;

  const refresh = (): void => {
    const enabled = readConfig().enabled;
    statusBar.text = enabled ? '$(sparkle) Tab' : '$(circle-slash) Tab';
    statusBar.tooltip = enabled
      ? 'Mytechin inline completions are on (sends code near the cursor to your provider). Click to turn off.'
      : 'Mytechin inline completions are off. Click to turn on.';
    if (!enabled) {
      engine.cancel();
    }
  };
  refresh();
  statusBar.show();

  const toggle = vscode.commands.registerCommand(`${EXTENSION_ID}.toggleInlineCompletion`, async () => {
    const config = vscode.workspace.getConfiguration(`${EXTENSION_ID}.inlineCompletion`);
    const next = !config.get<boolean>('enabled', false);
    await config.update('enabled', next, vscode.ConfigurationTarget.Global);
    if (next) {
      void vscode.window.showInformationMessage(
        'Mytechin inline completions on. Code around your cursor is sent to your configured provider as you type â€” pick a local model to keep it on this machine.'
      );
    }
  });

  const onConfig = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration(`${EXTENSION_ID}.inlineCompletion`)) {
      refresh();
    }
  });

  const registration = vscode.languages.registerInlineCompletionItemProvider(
    [{ scheme: 'file' }, { scheme: 'untitled' }],
    new MytechinInlineCompletionProvider(engine)
  );

  return [statusBar, toggle, onConfig, registration, { dispose: () => engine.cancel() }];
}
