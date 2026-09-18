import * as vscode from 'vscode';
import * as path from 'node:path';
import ignore, { type Ignore } from 'ignore';
import { DEFAULT_EXCLUDES } from '../../shared/constants/index.js';
import { isSensitivePath, normalize, toRelative } from './PathSecurity.js';

/**
 * Combines .gitignore, .ignore, VS Code exclude settings, the built-in list and
 * user patterns into one predicate. Rules are loaded lazily per workspace root
 * and refreshed when the ignore files change.
 */
export class IgnoreRules implements vscode.Disposable {
  private readonly perRoot = new Map<string, Ignore>();
  private extraPatterns: string[] = [];
  private readonly watchers: vscode.FileSystemWatcher[] = [];

  constructor(private readonly roots: () => string[]) {
    const watcher = vscode.workspace.createFileSystemWatcher('**/{.gitignore,.ignore}');
    watcher.onDidChange(() => this.perRoot.clear());
    watcher.onDidCreate(() => this.perRoot.clear());
    watcher.onDidDelete(() => this.perRoot.clear());
    this.watchers.push(watcher);
  }

  setExtraPatterns(patterns: string[]): void {
    this.extraPatterns = patterns;
    this.perRoot.clear();
  }

  /** Glob string for `workspace.findFiles`, so exclusion happens in the engine. */
  excludeGlob(): string {
    const configured = IgnoreRules.configuredExcludes();
    const all = [...DEFAULT_EXCLUDES, ...configured, ...this.extraPatterns];
    return `{${Array.from(new Set(all)).join(',')}}`;
  }

  private static configuredExcludes(): string[] {
    const out: string[] = [];
    for (const section of ['files.exclude', 'search.exclude', 'files.watcherExclude']) {
      const value = vscode.workspace.getConfiguration().get<Record<string, boolean>>(section) ?? {};
      for (const [pattern, enabled] of Object.entries(value)) {
        if (enabled) {
          out.push(pattern);
        }
      }
    }
    return out;
  }

  async isIgnored(absolutePath: string): Promise<boolean> {
    if (isSensitivePath(absolutePath)) {
      return true;
    }
    const roots = this.roots();
    const root = roots.find((r) => normalize(absolutePath).startsWith(normalize(r)));
    if (!root) {
      return false;
    }
    const matcher = await this.matcherFor(root);
    const relative = toRelative([root], absolutePath);
    if (relative.startsWith('..') || relative === '') {
      return false;
    }
    return matcher.ignores(relative);
  }

  private async matcherFor(root: string): Promise<Ignore> {
    const cached = this.perRoot.get(root);
    if (cached) {
      return cached;
    }

    const matcher = ignore();
    // Built-ins are glob-style; ignore() understands gitignore syntax, so strip
    // the leading `**/` that gitignore treats as redundant.
    matcher.add(DEFAULT_EXCLUDES.map((p) => p.replace(/^\*\*\//, '').replace(/\/\*\*$/, '/')));
    matcher.add(this.extraPatterns.map((p) => p.replace(/^\*\*\//, '')));
    matcher.add(IgnoreRules.configuredExcludes().map((p) => p.replace(/^\*\*\//, '')));

    for (const name of ['.gitignore', '.ignore']) {
      try {
        const uri = vscode.Uri.file(path.join(root, name));
        const bytes = await vscode.workspace.fs.readFile(uri);
        matcher.add(Buffer.from(bytes).toString('utf8'));
      } catch {
        // Missing ignore file is the normal case.
      }
    }

    this.perRoot.set(root, matcher);
    return matcher;
  }

  dispose(): void {
    this.watchers.forEach((w) => w.dispose());
    this.perRoot.clear();
  }
}
