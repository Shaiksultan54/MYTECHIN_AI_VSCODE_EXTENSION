import * as vscode from 'vscode';
import { createTwoFilesPatch } from 'diff';
import type { ResolvedPath } from '../workspace/WorkspaceManager.js';

const SCHEME = 'mytechin-diff';

/**
 * Opens VS Code's native diff editor for proposed and historical content.
 * Content is served from memory through a virtual document provider, so nothing
 * temporary is written to the user's disk.
 */
export class DiffManager implements vscode.Disposable {
  private readonly contents = new Map<string, string>();
  private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri>();
  private readonly registration: vscode.Disposable;
  private counter = 0;

  constructor() {
    this.registration = vscode.workspace.registerTextDocumentContentProvider(SCHEME, {
      onDidChange: this.changeEmitter.event,
      provideTextDocumentContent: (uri) => this.contents.get(uri.toString()) ?? ''
    });
  }

  private virtualUri(label: string, content: string): vscode.Uri {
    const uri = vscode.Uri.parse(`${SCHEME}:/${this.counter++}/${label}`);
    this.contents.set(uri.toString(), content);
    return uri;
  }

  async openFile(uri: vscode.Uri, line?: number): Promise<void> {
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document, { preview: true });
    if (line !== undefined) {
      const position = new vscode.Position(Math.max(0, line - 1), 0);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
    }
  }

  /** Diff of a file on disk against content the agent wants to write. */
  async showProposedDiff(resolved: ResolvedPath, proposed: string): Promise<void> {
    const right = this.virtualUri(`${resolved.relativePath} (proposed)`, proposed);
    const exists = await vscode.workspace.fs.stat(resolved.uri).then(
      () => true,
      () => false
    );
    const left = exists ? resolved.uri : this.virtualUri(`${resolved.relativePath} (new)`, '');
    await vscode.commands.executeCommand(
      'vscode.diff',
      left,
      right,
      `${resolved.relativePath}: proposed change`,
      { preview: true }
    );
  }

  /** Diff of a checkpoint snapshot against what is on disk now. */
  async showCheckpointDiff(
    relativePath: string,
    snapshot: string,
    current: vscode.Uri | undefined
  ): Promise<void> {
    const left = this.virtualUri(`${relativePath} (checkpoint)`, snapshot);
    const right = current ?? this.virtualUri(`${relativePath} (deleted)`, '');
    await vscode.commands.executeCommand(
      'vscode.diff',
      left,
      right,
      `${relativePath}: checkpoint vs now`,
      { preview: true }
    );
  }

  /**
   * Opens a unified patch that the agent produced but has not applied yet.
   * Used by the approval card's "View diff" action, where all we have is the
   * patch text itself.
   */
  async showPatch(title: string, patch: string): Promise<void> {
    const uri = this.virtualUri(`${title}.diff`, patch);
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.languages.setTextDocumentLanguage(document, 'diff').then(
      () => undefined,
      () => undefined
    );
    await vscode.window.showTextDocument(document, { preview: true });
  }

  static unifiedDiff(relativePath: string, before: string, after: string): string {
    return createTwoFilesPatch(relativePath, relativePath, before, after, 'before', 'after', {
      context: 3
    });
  }

  dispose(): void {
    this.registration.dispose();
    this.changeEmitter.dispose();
    this.contents.clear();
  }
}
