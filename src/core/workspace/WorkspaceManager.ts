import * as vscode from 'vscode';
import * as path from 'node:path';
import type { WorkspaceContext } from '../../shared/types.js';
import { IgnoreRules } from './IgnoreRules.js';
import {
  PathSecurityError,
  isSensitivePath,
  languageForPath,
  normalize,
  resolveWithinRoots,
  toRelative
} from './PathSecurity.js';

export interface ResolvedPath extends WorkspaceContext {
  fsPath: string;
  uri: vscode.Uri;
  language: string;
  sensitive: boolean;
}

/**
 * The only component allowed to turn a string into a filesystem location.
 * Everything else — tools, context collection, attachments — goes through here
 * so path validation and ignore rules cannot be bypassed.
 */
export class WorkspaceManager implements vscode.Disposable {
  readonly ignoreRules: IgnoreRules;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeFolders = this.changeEmitter.event;

  constructor() {
    this.ignoreRules = new IgnoreRules(() => this.rootPaths());
    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.changeEmitter.fire())
    );
  }

  get folders(): readonly vscode.WorkspaceFolder[] {
    return vscode.workspace.workspaceFolders ?? [];
  }

  get hasWorkspace(): boolean {
    return this.folders.length > 0;
  }

  /** Stable id for scoping conversations and checkpoints to a project. */
  get workspaceId(): string {
    if (vscode.workspace.workspaceFile) {
      return normalize(vscode.workspace.workspaceFile.fsPath);
    }
    const roots = this.rootPaths();
    return roots.length > 0 ? roots.join('|') : 'no-workspace';
  }

  get name(): string {
    return vscode.workspace.name ?? 'No workspace';
  }

  rootPaths(): string[] {
    return this.folders.map((f) => normalize(f.uri.fsPath));
  }

  /**
   * Resolves a model- or user-supplied path. Throws PathSecurityError when the
   * result would land outside every workspace root.
   */
  resolve(candidate: string, preferredRoot?: string): ResolvedPath {
    const roots = preferredRoot ? [normalize(preferredRoot), ...this.rootPaths()] : this.rootPaths();
    const fsPath = resolveWithinRoots(roots, candidate);
    return this.describe(vscode.Uri.file(fsPath));
  }

  /** Validates a URI that arrived from a drop, the explorer or the editor. */
  resolveUri(uri: vscode.Uri): ResolvedPath {
    if (uri.scheme !== 'file') {
      throw new PathSecurityError(`Only files on disk are supported (received ${uri.scheme}:).`);
    }
    const fsPath = resolveWithinRoots(this.rootPaths(), uri.fsPath);
    return this.describe(vscode.Uri.file(fsPath));
  }

  private describe(uri: vscode.Uri): ResolvedPath {
    const roots = this.rootPaths();
    const owning =
      this.folders.find((f) => normalize(uri.fsPath).startsWith(normalize(f.uri.fsPath))) ??
      this.folders[0];
    return {
      uri,
      fsPath: normalize(uri.fsPath),
      absoluteUri: uri.toString(),
      relativePath: toRelative(roots, uri.fsPath),
      workspaceFolderUri: owning ? owning.uri.toString() : '',
      language: languageForPath(uri.fsPath),
      sensitive: isSensitivePath(uri.fsPath)
    };
  }

  async stat(resolved: ResolvedPath): Promise<vscode.FileStat> {
    return vscode.workspace.fs.stat(resolved.uri);
  }

  async exists(resolved: ResolvedPath): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(resolved.uri);
      return true;
    } catch {
      return false;
    }
  }

  async isDirectory(resolved: ResolvedPath): Promise<boolean> {
    try {
      const stat = await vscode.workspace.fs.stat(resolved.uri);
      return (stat.type & vscode.FileType.Directory) !== 0;
    } catch {
      return false;
    }
  }

  async isIgnored(resolved: ResolvedPath): Promise<boolean> {
    return this.ignoreRules.isIgnored(resolved.fsPath);
  }

  /** Lists a directory, dropping ignored entries. */
  async listDirectory(
    resolved: ResolvedPath,
    options: { includeIgnored?: boolean } = {}
  ): Promise<{ name: string; type: 'file' | 'directory'; relativePath: string }[]> {
    const entries = await vscode.workspace.fs.readDirectory(resolved.uri);
    const out: { name: string; type: 'file' | 'directory'; relativePath: string }[] = [];
    for (const [name, type] of entries) {
      const child = path.join(resolved.fsPath, name);
      if (!options.includeIgnored && (await this.ignoreRules.isIgnored(child))) {
        continue;
      }
      out.push({
        name,
        type: (type & vscode.FileType.Directory) !== 0 ? 'directory' : 'file',
        relativePath: toRelative(this.rootPaths(), child)
      });
    }
    return out.sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1
    );
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.ignoreRules.dispose();
    this.changeEmitter.dispose();
  }
}
