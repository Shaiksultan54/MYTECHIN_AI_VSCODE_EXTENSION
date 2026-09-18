import * as vscode from 'vscode';
import { EXTENSION_NAME } from './shared/constants/index.js';
import { Logger } from './core/logging/Logger.js';
import { ExtensionController } from './core/controller/ExtensionController.js';
import { WebviewProvider } from './webview/WebviewProvider.js';
import { registerCommands } from './commands/registerCommands.js';

let controller: ExtensionController | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const logger = Logger.get();
  context.subscriptions.push(logger);
  logger.info(`${EXTENSION_NAME} activating`);

  controller = new ExtensionController(context);
  context.subscriptions.push(controller);

  const webview = new WebviewProvider(context.extensionUri, controller);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(WebviewProvider.viewType, webview, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );

  context.subscriptions.push(...registerCommands(controller, webview));

  // Files dropped onto the editor area can be routed into the chat as context.
  context.subscriptions.push(
    vscode.commands.registerCommand('mytechin.internal.attachUris', async (uris: vscode.Uri[]) => {
      await controller?.addUris(uris);
    })
  );

  await controller.initialize();
  logger.info(`${EXTENSION_NAME} ready`);
}

export function deactivate(): void {
  controller?.dispose();
  controller = undefined;
}
