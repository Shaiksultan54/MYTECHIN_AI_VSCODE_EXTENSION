import * as vscode from 'vscode';
import * as path from 'node:path';
import type { ResolvedPath, WorkspaceManager } from './WorkspaceManager.js';

export interface WriteResult {
  relativePath: string;
  created: boolean;
  bytesWritten: number;
  linesAfter: number;
}

/** All mutations funnel through here so checkpoints and validation stay honest. */
export class FileWriter {
  constructor(private readonly workspace: WorkspaceManager) {}

  async readCurrent(resolved: ResolvedPath): Promise<string | undefined> {
    try {
      const open = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === resolved.uri.fsPath);
      if (open) {
        return open.getText();
      }
      const bytes = await vscode.workspace.fs.readFile(resolved.uri);
      return Buffer.from(bytes).toString('utf8');
    } catch {
      return undefined;
    }
  }

  async write(resolved: ResolvedPath, content: string): Promise<WriteResult> {
    const existed = await this.workspace.exists(resolved);
    if (!existed) {
      const dir = vscode.Uri.file(path.dirname(resolved.fsPath));
      await vscode.workspace.fs.createDirectory(dir);
    }

    const buffer = Buffer.from(content, 'utf8');

    // Keep an already-open editor in sync without reloading glitches.
    const open = vscode.workspace.textDocuments.find(
      (d) => d.uri.fsPath === resolved.uri.fsPath
    );
    if (open) {
      const edit = new vscode.WorkspaceEdit();
      const fullRange = new vscode.Range(
        open.positionAt(0),
        open.positionAt(open.getText().length)
      );
      edit.replace(resolved.uri, fullRange, content);
      await vscode.workspace.applyEdit(edit);
      await open.save().then(undefined, () => undefined);
    } else {
      await vscode.workspace.fs.writeFile(resolved.uri, buffer);
    }

    return {
      relativePath: resolved.relativePath,
      created: !existed,
      bytesWritten: buffer.byteLength,
      linesAfter: content.length === 0 ? 0 : content.split(/\r?\n/).length
    };
  }

  async delete(resolved: ResolvedPath): Promise<void> {
    await vscode.workspace.fs.delete(resolved.uri, { recursive: false, useTrash: true });
  }
}
