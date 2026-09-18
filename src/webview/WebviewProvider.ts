import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { VIEW_ID } from '../shared/constants/index.js';
import type { ExtensionEvent } from '../shared/events/index.js';
import type { WebviewMessage } from '../shared/messages/index.js';
import type { ExtensionController } from '../core/controller/ExtensionController.js';
import { Logger } from '../core/logging/Logger.js';

/**
 * Hosts the React UI. The webview gets no filesystem access, no credentials and
 * no remote origins: a nonce-gated bundle, local resource roots, and a typed
 * message channel are the entire surface.
 */
export class WebviewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = VIEW_ID;

  private view: vscode.WebviewView | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly controller: ExtensionController
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;

    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'webview-ui', 'dist'),
        vscode.Uri.joinPath(this.extensionUri, 'media'),
        vscode.Uri.joinPath(this.extensionUri, 'media', 'codicons')
      ]
    };

    view.webview.html = this.html(view.webview);

    this.controller.connect((event: ExtensionEvent) => {
      void view.webview.postMessage(event);
    });

    view.webview.onDidReceiveMessage((message: WebviewMessage) => {
      void this.controller.handleMessage(message);
    });

    view.onDidDispose(() => {
      this.controller.disconnect();
      this.view = undefined;
    });

    Logger.get().debug('Webview resolved');
  }

  get visible(): boolean {
    return this.view?.visible ?? false;
  }

  async reveal(): Promise<void> {
    if (this.view) {
      this.view.show(true);
      return;
    }
    await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
  }

  private html(webview: vscode.Webview): string {
    const nonce = randomBytes(16).toString('base64');
    const dist = vscode.Uri.joinPath(this.extensionUri, 'webview-ui', 'dist');
    const script = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'index.js'));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'index.css'));
    const codicons = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'codicons', 'codicon.css')
    );

    // `style-src` allows inline styles because VS Code injects its own theme
    // stylesheet into every webview. Scripts stay nonce-gated with no
    // 'unsafe-inline' and no remote origins at all.
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} data:`,
      `font-src ${webview.cspSource}`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `connect-src 'none'`
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link href="${codicons}" rel="stylesheet" />
    <link href="${style}" rel="stylesheet" />
    <title>Mytechin AI</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" nonce="${nonce}" src="${script}"></script>
  </body>
</html>`;
  }
}
