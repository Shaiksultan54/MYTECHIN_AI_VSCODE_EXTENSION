import * as vscode from 'vscode';
import * as path from 'node:path';
import type { ResolvedPath, WorkspaceManager } from './WorkspaceManager.js';

export interface WriteResult {
  relativePath: string;
  created: boolean;
  bytesWritten: number;
  linesAfter: number;
}

/** All mutations funnel through here so checkpoints, atomic writes, and validation stay honest. */
export class FileWriter {
  private readonly rollbackHistory = new Map<string, string | null>();

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
    const previousContent = existed ? await this.readCurrent(resolved) : null;

    // Record previous state for immediate rollback if needed
    if (!this.rollbackHistory.has(resolved.fsPath)) {
      this.rollbackHistory.set(resolved.fsPath, previousContent ?? null);
    }

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
      // Atomic write via temp file + rename
      const tempUri = vscode.Uri.file(
        `${resolved.fsPath}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`
      );
      try {
        await vscode.workspace.fs.writeFile(tempUri, buffer);
        await vscode.workspace.fs.rename(tempUri, resolved.uri, { overwrite: true });
      } catch (err) {
        try {
          await vscode.workspace.fs.delete(tempUri, { useTrash: false });
        } catch {
          // ignore cleanup error
        }
        throw err;
      }
    }

    return {
      relativePath: resolved.relativePath,
      created: !existed,
      bytesWritten: buffer.byteLength,
      linesAfter: content.length === 0 ? 0 : content.split(/\r?\n/).length
    };
  }

  canRollback(resolved: ResolvedPath): boolean {
    return this.rollbackHistory.has(resolved.fsPath);
  }

  async rollback(resolved: ResolvedPath): Promise<boolean> {
    if (!this.rollbackHistory.has(resolved.fsPath)) {
      return false;
    }
    const previous = this.rollbackHistory.get(resolved.fsPath);
    this.rollbackHistory.delete(resolved.fsPath);

    if (previous === null) {
      try {
        await this.delete(resolved);
        return true;
      } catch {
        return false;
      }
    } else {
      try {
        await this.write(resolved, previous ?? '');
        return true;
      } catch {
        return false;
      }
    }
  }

  clearRollbackHistory(): void {
    this.rollbackHistory.clear();
  }

  async delete(resolved: ResolvedPath): Promise<void> {
    const existed = await this.workspace.exists(resolved);
    if (existed && !this.rollbackHistory.has(resolved.fsPath)) {
      const prev = await this.readCurrent(resolved);
      this.rollbackHistory.set(resolved.fsPath, prev ?? null);
    }
    await vscode.workspace.fs.delete(resolved.uri, { recursive: false, useTrash: true });
  }
}
