import * as vscode from 'vscode';
import * as path from 'node:path';
import { toRelative } from './PathSecurity.js';
import type { WorkspaceManager } from './WorkspaceManager.js';

export interface GraphImport {
  path: string;
  symbols: string[];
}

export interface ImpactResult {
  path: string;
  dependencies: GraphImport[];
  dependents: GraphImport[];
  approximate: true;
}

const SOURCE_GLOB = '**/*.{ts,tsx,js,jsx,mjs,cjs,py,go,cs}';

/**
 * Lightweight import graph. It intentionally reports best-effort file
 * relationships rather than pretending to resolve types like a language server.
 */
export class WorkspaceGraph {
  private readonly imports = new Map<string, GraphImport[]>();
  private readonly files = new Set<string>();
  private builtForWorkspace = '';
  private built = false;

  constructor(private readonly workspace: WorkspaceManager) {}

  invalidate(): void {
    this.imports.clear();
    this.files.clear();
    this.builtForWorkspace = '';
    this.built = false;
  }

  /**
   * Incrementally refresh one source file after a save/create/delete event.
   * This remains intentionally file-level and best-effort; it does not resolve
   * aliases, package exports, generated files, or type-aware symbol bindings.
   */
  async update(uri: vscode.Uri, deleted = false): Promise<void> {
    if (this.builtForWorkspace !== this.workspace.workspaceId) {
      return;
    }
    const relativePath = toRelative(this.workspace.rootPaths(), uri.fsPath);
    this.files.delete(relativePath);
    this.imports.delete(relativePath);
    if (!deleted) {
      this.files.add(relativePath);
      await this.indexFile(uri);
    }
  }

  async impact(relativePath: string): Promise<ImpactResult> {
    await this.ensureBuilt();
    const resolved = this.workspace.resolve(relativePath);
    const target = resolved.relativePath;
    const dependencies = this.imports.get(target) ?? [];
    const dependents: GraphImport[] = [];

    for (const [source, entries] of this.imports) {
      const match = entries.find((entry) => entry.path === target);
      if (match) {
        dependents.push({ path: source, symbols: match.symbols });
      }
    }

    return { path: target, dependencies, dependents, approximate: true };
  }

  private async ensureBuilt(): Promise<void> {
    const workspaceId = this.workspace.workspaceId;
    if (this.builtForWorkspace === workspaceId && this.built) return;
    this.imports.clear();
    this.files.clear();
    const files = await vscode.workspace.findFiles(
      SOURCE_GLOB,
      this.workspace.ignoreRules.excludeGlob()
    );
    for (const file of files) {
      this.files.add(toRelative(this.workspace.rootPaths(), file.fsPath));
    }
    await Promise.all(files.map((uri) => this.indexFile(uri)));
    this.builtForWorkspace = workspaceId;
    this.built = true;
  }

  private async indexFile(uri: vscode.Uri): Promise<void> {
    try {
      const content = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
      const source = toRelative(this.workspace.rootPaths(), uri.fsPath);
      const entries = this.parseImports(source, content);
      if (entries.length > 0) this.imports.set(source, entries);
    } catch {
      // A file may disappear during a workspace scan; omit it from this snapshot.
    }
  }

  private parseImports(source: string, content: string): GraphImport[] {
    const results: GraphImport[] = [];
    const add = (specifier: string, symbols: string[] = []): void => {
      const target = this.resolveSpecifier(source, specifier);
      if (target) results.push({ path: target, symbols });
    };

    for (const match of content.matchAll(/import\s+(?:(.*?)\s+from\s+)?['"]([^'"]+)['"]/g)) {
      add(match[2], this.symbolsFromClause(match[1]));
    }
    for (const match of content.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) add(match[1]);
    for (const match of content.matchAll(/(?:from|import)\s+([.\w/\\-]+)/g)) {
      if (match[1].startsWith('.')) add(match[1]);
    }
    for (const match of content.matchAll(/from\s+['"]?([.\w/\\-]+)['"]?\s+import\s+(.+)/g)) {
      const symbols = match[2]
        .split(',')
        .map((symbol) => symbol.trim().replace(/\s+as\s+.*$/i, ''))
        .filter(Boolean);
      add(match[1], symbols);
    }
    for (const match of content.matchAll(/using\s+([.\w]+);/g)) add(match[1].replace(/\./g, '/'));

    return Array.from(new Map(results.map((entry) => [entry.path, entry])).values());
  }

  private symbolsFromClause(clause: string | undefined): string[] {
    if (!clause) return [];
    return clause
      .replace(/[{}]/g, '')
      .split(',')
      .map((part) => part.trim().split(/\s+as\s+/i)[0])
      .filter((part) => part && part !== '*');
  }

  private resolveSpecifier(source: string, specifier: string): string | undefined {
    if (!specifier.startsWith('.')) return undefined;
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(source), specifier));
    const candidates = [
      base,
      ...['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.cs'].map((ext) => `${base}${ext}`),
      ...['index.ts', 'index.tsx', 'index.js', '__init__.py'].map((name) => path.posix.join(base, name))
    ];
    return candidates.find((candidate) => this.files.has(candidate));
  }
}
