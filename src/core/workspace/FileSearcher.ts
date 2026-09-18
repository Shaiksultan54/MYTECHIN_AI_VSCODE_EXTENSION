import * as vscode from 'vscode';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import type { WorkspaceManager } from './WorkspaceManager.js';
import { Logger } from '../logging/Logger.js';
import { toRelative } from './PathSecurity.js';

export interface SearchMatch {
  relativePath: string;
  line: number;
  column: number;
  preview: string;
}

export interface SearchResult {
  matches: SearchMatch[];
  files: string[];
  truncated: boolean;
  engine: 'ripgrep' | 'vscode';
}

export interface SearchOptions {
  query: string;
  isRegex?: boolean;
  caseSensitive?: boolean;
  includeGlob?: string;
  maxResults?: number;
  token?: vscode.CancellationToken;
}

/**
 * Repository search. Prefers the ripgrep binary shipped with VS Code because it
 * respects .gitignore and is fast on large repositories; falls back to reading
 * candidate files discovered through `workspace.findFiles`.
 */
export class FileSearcher {
  private ripgrepPath: string | null | undefined;

  constructor(private readonly workspace: WorkspaceManager) {}

  async searchText(options: SearchOptions): Promise<SearchResult> {
    const rg = this.findRipgrep();
    if (rg) {
      try {
        return await this.searchWithRipgrep(rg, options);
      } catch (error) {
        Logger.get().warn('ripgrep search failed, falling back to the VS Code API', error);
      }
    }
    return this.searchWithVscode(options);
  }

  /** Filename search for @mentions and the file picker. */
  async findFiles(query: string, maxResults = 40): Promise<string[]> {
    const exclude = this.workspace.ignoreRules.excludeGlob();
    const sanitized = query.replace(/[{}[\]]/g, '').trim();
    const glob = sanitized.length > 0 ? `**/*${sanitized}*` : '**/*';
    const uris = await vscode.workspace.findFiles(glob, exclude, maxResults * 3);

    const roots = this.workspace.rootPaths();
    const results: string[] = [];
    for (const uri of uris) {
      if (await this.workspace.ignoreRules.isIgnored(uri.fsPath)) {
        continue;
      }
      results.push(toRelative(roots, uri.fsPath));
      if (results.length >= maxResults) {
        break;
      }
    }
    // Shallower paths and exact basename hits first.
    const needle = sanitized.toLowerCase();
    return results.sort((a, b) => {
      const aExact = path.basename(a).toLowerCase().startsWith(needle) ? 0 : 1;
      const bExact = path.basename(b).toLowerCase().startsWith(needle) ? 0 : 1;
      if (aExact !== bExact) {
        return aExact - bExact;
      }
      return a.split('/').length - b.split('/').length || a.localeCompare(b);
    });
  }

  async findFolders(query: string, maxResults = 20): Promise<string[]> {
    const files = await this.findFiles(query, 200);
    const folders = new Set<string>();
    const needle = query.toLowerCase();
    for (const file of files) {
      let dir = path.dirname(file);
      while (dir && dir !== '.' && dir !== '/') {
        if (dir.toLowerCase().includes(needle)) {
          folders.add(dir);
        }
        dir = path.dirname(dir);
      }
    }
    return Array.from(folders).slice(0, maxResults);
  }

  /** Symbol search through the language servers already running in VS Code. */
  async searchSymbols(query: string, maxResults = 30): Promise<SearchMatch[]> {
    const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
      'vscode.executeWorkspaceSymbolProvider',
      query
    );
    if (!symbols) {
      return [];
    }
    const roots = this.workspace.rootPaths();
    return symbols.slice(0, maxResults).map((symbol) => ({
      relativePath: toRelative(roots, symbol.location.uri.fsPath),
      line: symbol.location.range.start.line + 1,
      column: symbol.location.range.start.character + 1,
      preview: `${vscode.SymbolKind[symbol.kind]} ${symbol.name}`
    }));
  }

  private findRipgrep(): string | null {
    if (this.ripgrepPath !== undefined) {
      return this.ripgrepPath;
    }
    const appRoot = vscode.env.appRoot;
    const candidates = [
      path.join(appRoot, 'node_modules/@vscode/ripgrep/bin/rg'),
      path.join(appRoot, 'node_modules/vscode-ripgrep/bin/rg'),
      path.join(appRoot, 'node_modules.asar.unpacked/@vscode/ripgrep/bin/rg'),
      path.join(appRoot, 'node_modules.asar.unpacked/vscode-ripgrep/bin/rg')
    ];
    const withExe = process.platform === 'win32' ? candidates.map((c) => `${c}.exe`) : candidates;
    this.ripgrepPath = withExe.find((c) => fs.existsSync(c)) ?? null;
    Logger.get().debug(`ripgrep: ${this.ripgrepPath ?? 'not found, using VS Code search'}`);
    return this.ripgrepPath;
  }

  private searchWithRipgrep(rgPath: string, options: SearchOptions): Promise<SearchResult> {
    const max = options.maxResults ?? 60;
    const roots = this.workspace.rootPaths();
    const args = ['--json', '--max-count', '5', '--max-filesize', '2M', '--threads', '4'];
    if (!options.isRegex) {
      args.push('--fixed-strings');
    }
    args.push(options.caseSensitive ? '--case-sensitive' : '--ignore-case');
    if (options.includeGlob) {
      args.push('--glob', options.includeGlob);
    }
    for (const pattern of ['!node_modules', '!.git', '!dist', '!build', '!bin', '!obj']) {
      args.push('--glob', pattern);
    }
    args.push('--', options.query, ...roots);

    return new Promise((resolve, reject) => {
      const child = spawn(rgPath, args, { windowsHide: true });
      const matches: SearchMatch[] = [];
      const files = new Set<string>();
      let truncated = false;
      let buffer = '';
      let settled = false;

      const finish = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        child.kill();
        resolve({ matches, files: Array.from(files), truncated, engine: 'ripgrep' });
      };

      options.token?.onCancellationRequested(() => {
        truncated = true;
        finish();
      });

      child.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) {
            continue;
          }
          try {
            const event = JSON.parse(line);
            if (event.type !== 'match') {
              continue;
            }
            const filePath = event.data.path.text as string;
            const relative = toRelative(roots, filePath);
            files.add(relative);
            matches.push({
              relativePath: relative,
              line: event.data.line_number ?? 0,
              column: (event.data.submatches?.[0]?.start ?? 0) + 1,
              preview: String(event.data.lines?.text ?? '').replace(/\r?\n$/, '').slice(0, 240)
            });
            if (matches.length >= max) {
              truncated = true;
              finish();
              return;
            }
          } catch {
            // Non-JSON line, skip.
          }
        }
      });

      child.on('error', (error) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      });
      child.on('close', finish);
    });
  }

  private async searchWithVscode(options: SearchOptions): Promise<SearchResult> {
    const max = options.maxResults ?? 60;
    const exclude = this.workspace.ignoreRules.excludeGlob();
    const include = options.includeGlob ?? '**/*';
    const uris = await vscode.workspace.findFiles(include, exclude, 3000);

    const needle = options.caseSensitive ? options.query : options.query.toLowerCase();
    const regex = options.isRegex
      ? new RegExp(options.query, options.caseSensitive ? '' : 'i')
      : undefined;

    const roots = this.workspace.rootPaths();
    const matches: SearchMatch[] = [];
    const files = new Set<string>();
    let truncated = false;

    // Bounded concurrency keeps the extension host responsive on big repos.
    const queue = [...uris];
    const workers = Array.from({ length: 8 }, async () => {
      while (queue.length > 0) {
        if (matches.length >= max || options.token?.isCancellationRequested) {
          truncated = true;
          return;
        }
        const uri = queue.shift();
        if (!uri) {
          return;
        }
        try {
          const stat = await vscode.workspace.fs.stat(uri);
          if (stat.size > 2 * 1024 * 1024) {
            continue;
          }
          const text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
          const haystack = options.caseSensitive ? text : text.toLowerCase();
          if (regex ? !regex.test(text) : !haystack.includes(needle)) {
            continue;
          }
          const relative = toRelative(roots, uri.fsPath);
          files.add(relative);
          const lines = text.split(/\r?\n/);
          let hits = 0;
          for (let i = 0; i < lines.length && hits < 5; i++) {
            const line = options.caseSensitive ? lines[i] : lines[i].toLowerCase();
            const index = regex ? lines[i].search(regex) : line.indexOf(needle);
            if (index >= 0) {
              hits++;
              matches.push({
                relativePath: relative,
                line: i + 1,
                column: index + 1,
                preview: lines[i].trim().slice(0, 240)
              });
            }
          }
        } catch {
          // Unreadable file, skip.
        }
      }
    });

    await Promise.all(workers);
    return { matches: matches.slice(0, max), files: Array.from(files), truncated, engine: 'vscode' };
  }
}
