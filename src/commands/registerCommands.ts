import * as vscode from 'vscode';
import type { ExtensionController } from '../core/controller/ExtensionController.js';
import type { WebviewProvider } from '../webview/WebviewProvider.js';
import { Logger } from '../core/logging/Logger.js';

interface SelectionContext {
  relativePath: string;
  language: string;
  startLine: number;
  endLine: number;
  text: string;
}

function selectionOf(editor: vscode.TextEditor | undefined): SelectionContext | undefined {
  if (!editor || editor.selection.isEmpty) {
    return undefined;
  }
  return {
    relativePath: vscode.workspace.asRelativePath(editor.document.uri, false),
    language: editor.document.languageId,
    startLine: editor.selection.start.line + 1,
    endLine: editor.selection.end.line + 1,
    text: editor.document.getText(editor.selection)
  };
}

/**
 * Every command follows the same shape: attach the right context, focus the
 * sidebar, then either send a prompt or hand the composer back to the user.
 * The commands hold no logic of their own.
 */
export function registerCommands(
  controller: ExtensionController,
  webview: WebviewProvider
): vscode.Disposable[] {
  const reveal = async (): Promise<void> => {
    await webview.reveal();
  };

  /** Attaches the current selection, then runs a canned instruction. */
  const withSelection = async (instruction: (s: SelectionContext) => string): Promise<void> => {
    const selection = selectionOf(vscode.window.activeTextEditor);
    if (!selection) {
      void vscode.window.showInformationMessage('Select some code first.');
      return;
    }
    await reveal();
    await controller.attachSpecial('selection');
    await controller.submitPrompt(instruction(selection));
  };

  const register = (command: string, handler: (...args: never[]) => unknown): vscode.Disposable =>
    vscode.commands.registerCommand(command, async (...args: never[]) => {
      try {
        await handler(...args);
      } catch (error) {
        Logger.get().error(`Command ${command} failed`, error);
        void vscode.window.showErrorMessage(
          `Mytechin AI: ${(error as Error)?.message ?? 'command failed'}`
        );
      }
    });

  return [
    register('mytechin.open', reveal),

    register('mytechin.newChat', async () => {
      await reveal();
      await controller.newConversation();
      await controller.emit({ type: 'showPanel', panel: 'chat' });
    }),

    register('mytechin.ask', async () => {
      const question = await vscode.window.showInputBox({
        title: 'Ask Mytechin AI',
        prompt: 'What would you like to know about this project?',
        ignoreFocusOut: true
      });
      if (!question?.trim()) {
        return;
      }
      await reveal();
      await controller.submitPrompt(question);
    }),

    register('mytechin.explainSelection', () =>
      withSelection(
        (s) =>
          `Explain the selected code in ${s.relativePath} (lines ${s.startLine}–${s.endLine}). Cover what it does, why it exists and anything surprising about it.`
      )
    ),

    register('mytechin.fixSelection', () =>
      withSelection(
        (s) =>
          `Fix the selected code in ${s.relativePath} (lines ${s.startLine}–${s.endLine}). Check the Problems panel and the surrounding code first, then propose a patch.`
      )
    ),

    register('mytechin.refactorSelection', () =>
      withSelection(
        (s) =>
          `Refactor the selected code in ${s.relativePath} (lines ${s.startLine}–${s.endLine}) while preserving behaviour. Explain each change, then propose a patch.`
      )
    ),

    register('mytechin.generateTests', () =>
      withSelection(
        (s) =>
          `Write tests for the selected code in ${s.relativePath} (lines ${s.startLine}–${s.endLine}). Match the test framework and file layout already used in this project.`
      )
    ),

    register('mytechin.reviewFile', async (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target) {
        void vscode.window.showInformationMessage('Open or select a file first.');
        return;
      }
      await reveal();
      await controller.addUris([target]);
      await controller.submitPrompt(
        `Review ${vscode.workspace.asRelativePath(target, false)} for correctness, edge cases, security and clarity. List concrete findings rather than general advice.`
      );
    }),

    register('mytechin.explainFile', async (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target) {
        void vscode.window.showInformationMessage('Open or select a file first.');
        return;
      }
      await reveal();
      await controller.addUris([target]);
      await controller.submitPrompt(
        `Explain ${vscode.workspace.asRelativePath(target, false)}: its responsibility, its main flows, and how it fits into the rest of the project.`
      );
    }),

    register('mytechin.addSelectionToChat', async () => {
      await reveal();
      await controller.attachSpecial('selection');
      await controller.prefillComposer('');
    }),

    register('mytechin.addFileToChat', async (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
      const targets = uris?.length
        ? uris
        : uri
          ? [uri]
          : vscode.window.activeTextEditor
            ? [vscode.window.activeTextEditor.document.uri]
            : [];
      if (targets.length === 0) {
        void vscode.window.showInformationMessage('Open or select a file first.');
        return;
      }
      await reveal();
      await controller.addUris(targets);
    }),

    register('mytechin.addFolderToChat', async (uri?: vscode.Uri, uris?: vscode.Uri[]) => {
      const targets = uris?.length ? uris : uri ? [uri] : [];
      if (targets.length === 0) {
        const picked = await vscode.window.showOpenDialog({
          canSelectFiles: false,
          canSelectFolders: true,
          canSelectMany: true,
          openLabel: 'Attach folder'
        });
        if (!picked?.length) {
          return;
        }
        await reveal();
        await controller.addUris(picked);
        return;
      }
      await reveal();
      await controller.addUris(targets);
    }),

    register('mytechin.configureProvider', async () => {
      await reveal();
      await controller.emit({ type: 'showPanel', panel: 'settings' });
    }),

    register('mytechin.stopAgent', () => {
      controller.agent.stop();
    }),

    register('mytechin.showContext', async () => {
      await reveal();
      await controller.emit({ type: 'showPanel', panel: 'context' });
      await controller.handleMessage({ type: 'requestContext' });
    }),

    register('mytechin.showHistory', async () => {
      await reveal();
      await controller.emit({ type: 'showPanel', panel: 'history' });
      await controller.handleMessage({ type: 'listConversations' });
    }),

    register('mytechin.showLogs', () => {
      Logger.get().show();
    }),

    register('mytechin.showMemory', async () => {
      await reveal();
      await controller.emit({ type: 'showPanel', panel: 'memory' });
    }),

    register('mytechin.addMemory', async () => {
      const selection = selectionOf(vscode.window.activeTextEditor);
      const question = await vscode.window.showInputBox({
        title: 'Add Project Memory',
        prompt: 'What rule, decision, or architectural note should I remember?',
        ignoreFocusOut: true,
        value: selection?.text ?? ''
      });
      if (question?.trim()) {
        const cat = await vscode.window.showQuickPick(['rules', 'architecture', 'decisions', 'knowledge'], {
          title: 'Select Memory Category'
        });
        if (cat) {
          controller.memoryService.addEntry(cat as any, question.trim());
          await controller.memoryService.save();
          void vscode.window.showInformationMessage('Project memory added.');
          await reveal();
          await controller.emit({ type: 'showPanel', panel: 'memory' });
        }
      }
    }),

    register('mytechin.clearMemory', async () => {
      const confirm = await vscode.window.showWarningMessage('Are you sure you want to clear all project memory?', 'Yes', 'No');
      if (confirm === 'Yes') {
        const entries = controller.memoryService.getEntries();
        for (const entry of [...entries]) {
          controller.memoryService.removeEntry(entry.id);
        }
        await controller.memoryService.save();
        void vscode.window.showInformationMessage('Project memory cleared.');
        await reveal();
        await controller.emit({ type: 'showPanel', panel: 'memory' });
      }
    })
  ];
}
