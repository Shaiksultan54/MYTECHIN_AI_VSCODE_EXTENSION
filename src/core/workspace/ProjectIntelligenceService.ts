import * as vscode from 'vscode';
import * as path from 'node:path';
import type { WorkspaceManager } from './WorkspaceManager.js';
import { ProjectMetadataManager, type ProjectMetadata } from './ProjectMetadata.js';
import { languageForPath, toRelative } from './PathSecurity.js';

export interface RepositoryMapItem {
  path: string;
  type: 'file' | 'directory' | 'service' | 'entrypoint';
  language?: string;
  summary?: string;
  keySymbols?: string[];
}

/**
 * First-class repository intelligence service.
 * Discovers repository architecture, maintains metadata, tracks entry points,
 * builds dynamic repository maps, and updates incrementally on file changes.
 */
export class ProjectIntelligenceService implements vscode.Disposable {
  private readonly metadataManager: ProjectMetadataManager;
  private readonly disposables: vscode.Disposable[] = [];
  private repoMap: RepositoryMapItem[] = [];
  private lastScannedAt = 0;

  constructor(private readonly workspace: WorkspaceManager) {
    this.metadataManager = new ProjectMetadataManager(workspace);
    this.setupWatchers();
  }

  private setupWatchers(): void {
    const watcher = vscode.workspace.createFileSystemWatcher('**/{package.json,tsconfig*.json,angular.json,*.csproj,*.sln,go.mod,Cargo.toml,requirements.txt}');
    this.disposables.push(watcher);

    watcher.onDidChange(() => this.invalidate());
    watcher.onDidCreate(() => this.invalidate());
    watcher.onDidDelete(() => this.invalidate());
  }

  invalidate(): void {
    this.repoMap = [];
    this.lastScannedAt = 0;
  }

  async getMetadata(token?: vscode.CancellationToken): Promise<ProjectMetadata> {
    const current = this.metadataManager.current();
    if (current && Date.now() - this.lastScannedAt < 60_000) {
      return current;
    }
    const meta = await this.metadataManager.detect(token);
    this.lastScannedAt = Date.now();
    return meta;
  }

  async getRepositoryMap(token?: vscode.CancellationToken): Promise<RepositoryMapItem[]> {
    if (this.repoMap.length > 0) {
      return this.repoMap;
    }

    const roots = this.workspace.rootPaths();
    if (roots.length === 0) {
      return [];
    }

    const metadata = await this.getMetadata(token);
    const exclude = this.workspace.ignoreRules.excludeGlob();
    const items: RepositoryMapItem[] = [];

    // 1. Entrypoints and services
    for (const ep of metadata.entryPoints) {
      items.push({
        path: ep,
        type: 'entrypoint',
        language: languageForPath(ep),
        summary: 'Application entry point'
      });
    }

    for (const s of metadata.services) {
      items.push({
        path: s,
        type: 'service',
        summary: 'Identified service/module'
      });
    }

    // 2. Discover key source files (up to 150 top files)
    const sourceFiles = await vscode.workspace.findFiles(
      '**/*.{ts,tsx,js,jsx,cs,py,go,rs,java,html}',
      exclude,
      150
    );

    for (const uri of sourceFiles) {
      if (token?.isCancellationRequested) break;
      const rel = toRelative(roots, uri.fsPath);
      const isTest = rel.toLowerCase().includes('test') || rel.toLowerCase().includes('spec');
      if (isTest) continue;

      items.push({
        path: rel,
        type: 'file',
        language: languageForPath(rel)
      });
    }

    this.repoMap = items;
    return items;
  }

  /**
   * Compact repository map designed to fit into LLM context window without blowing tokens.
   */
  async renderRepositoryMapForContext(token?: vscode.CancellationToken): Promise<string> {
    const meta = await this.getMetadata(token);
    const map = await this.getRepositoryMap(token);

    const lines: string[] = [
      `# Repository Map: ${meta.projectName}`,
      `- Type: ${meta.projectType}`,
      `- Languages: ${meta.detectedLanguages.join(', ') || 'unknown'}`,
      `- Frameworks: ${meta.frameworks.join(', ') || 'none'}`,
      `- Package Managers: ${meta.packageManagers.join(', ') || 'none'}`,
      `- Build Systems: ${meta.buildSystems.join(', ') || 'none'}`,
      `- Source Roots: ${meta.sourceRoots.join(', ') || '.'}`,
      `- Test Roots: ${meta.testRoots.join(', ') || 'none'}`,
      `- Services: ${meta.services.join(', ') || 'none'}`,
      `- Key Entry Points: ${meta.entryPoints.join(', ') || 'none'}`,
      '',
      '## Structure Overview:'
    ];

    const dirs = new Set<string>();
    for (const item of map) {
      const dir = path.dirname(item.path);
      if (dir && dir !== '.') dirs.add(dir);
    }

    for (const d of Array.from(dirs).slice(0, 30)) {
      lines.push(`📁 ${d}`);
    }

    return lines.join('\n');
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
  }
}
