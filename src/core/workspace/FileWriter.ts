import * as vscode from 'vscode';
import * as path from 'node:path';
import { open as openFile } from 'node:fs/promises';
import type { ResolvedPath, WorkspaceManager } from './WorkspaceManager.js';

export interface WriteResult {
  relativePath: string;
  created: boolean;
  bytesWritten: number;
  linesAfter: number;
}

export type AtomicWritePhase = 'create-directory' | 'write-temp' | 'flush-temp' | 'rename' | 'cleanup';

export class AtomicWriteError extends Error {
  constructor(
    readonly targetPath: string,
    readonly phase: AtomicWritePhase,
    cause: unknown
  ) {
    super(
      `Atomic write failed during ${phase} for ${targetPath}: ${
        cause instanceof Error ? cause.message : String(cause)
      }`
    );
    this.name = 'AtomicWriteError';
    this.cause = cause;
  }
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
      try {
        await vscode.workspace.fs.createDirectory(dir);
      } catch (error) {
        throw new AtomicWriteError(resolved.relativePath, 'create-directory', error);
      }
    }

    const buffer = Buffer.from(content, 'utf8');
    const tempUri = vscode.Uri.file(
      path.join(
        path.dirname(resolved.fsPath),
        `.${path.basename(resolved.fsPath)}.mytechin-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}.tmp`
      )
    );

    try {
      await vscode.workspace.fs.writeFile(tempUri, buffer);
    } catch (error) {
      await this.cleanupTemp(tempUri, resolved.fsPath, 'write-temp', error);
    }

    try {
      await this.flushTemp(tempUri);
    } catch (error) {
      await this.cleanupTemp(tempUri, resolved.fsPath, 'flush-temp', error);
    }

    try {
      await vscode.workspace.fs.rename(tempUri, resolved.uri, { overwrite: true });
    } catch (error) {
      await this.cleanupTemp(tempUri, resolved.fsPath, 'rename', error);
    }

    // Update an open editor only after the durable disk replacement succeeds.
    const open = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === resolved.uri.fsPath);
    if (open) {
      const edit = new vscode.WorkspaceEdit();
      const fullRange = new vscode.Range(open.positionAt(0), open.positionAt(open.getText().length));
      edit.replace(resolved.uri, fullRange, content);
      if (!(await vscode.workspace.applyEdit(edit))) {
        throw new AtomicWriteError(
          resolved.relativePath,
          'rename',
          'The open editor could not be updated after the file was replaced.'
        );
      }
    }

    return {
      relativePath: resolved.relativePath,
      created: !existed,
      bytesWritten: buffer.byteLength,
      linesAfter: content.length === 0 ? 0 : content.split(/\r?\n/).length
    };
  }

  private async flushTemp(tempUri: vscode.Uri): Promise<void> {
    if (tempUri.scheme !== 'file') return;
    let handle: Awaited<ReturnType<typeof openFile>> | undefined;
    try {
      handle = await openFile(tempUri.fsPath, 'r');
      await handle.sync();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EINVAL' && code !== 'ENOSYS' && code !== 'ENOTSUP' && code !== 'EPERM') {
        throw error;
      }
    } finally {
      await handle?.close();
    }
  }

  private async cleanupTemp(
    tempUri: vscode.Uri,
    targetPath: string,
    phase: AtomicWritePhase,
    cause: unknown
  ): Promise<never> {
    try {
      await vscode.workspace.fs.delete(tempUri, { useTrash: false });
    } catch (cleanupError) {
      throw new AtomicWriteError(targetPath, 'cleanup', cleanupError);
    }
    throw new AtomicWriteError(targetPath, phase, cause);
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
