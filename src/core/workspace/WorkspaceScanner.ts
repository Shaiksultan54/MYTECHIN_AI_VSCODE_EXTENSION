import * as vscode from 'vscode';
import * as path from 'node:path';
import type { WorkspaceSummary } from '../../shared/types.js';
import { MARKER_GLOBS, PROJECT_MARKERS } from '../../shared/constants/index.js';
import type { WorkspaceManager } from './WorkspaceManager.js';
import { languageForPath, toRelative } from './PathSecurity.js';
import { Logger } from '../logging/Logger.js';

/**
 * Builds a lightweight map of the workspace: which languages and frameworks are
 * present, where source and test roots live, and how many files there are.
 * Reads project markers only — never source files.
 */
export class WorkspaceScanner {
  private cached: WorkspaceSummary | undefined;
  private scanning: Promise<WorkspaceSummary> | undefined;

  constructor(private readonly workspace: WorkspaceManager) {}

  invalidate(): void {
    this.cached = undefined;
    this.scanning = undefined;
  }

  current(): WorkspaceSummary {
    return this.cached ?? WorkspaceScanner.empty(this.workspace.name, this.workspace.folders);
  }

  async scan(token?: vscode.CancellationToken): Promise<WorkspaceSummary> {
    if (this.cached) {
      return this.cached;
    }
    if (!this.scanning) {
      this.scanning = this.doScan(token).finally(() => {
        this.scanning = undefined;
      });
    }
    return this.scanning;
  }

  private async doScan(token?: vscode.CancellationToken): Promise<WorkspaceSummary> {
    const started = Date.now();
    const summary = WorkspaceScanner.empty(this.workspace.name, this.workspace.folders);
    if (!this.workspace.hasWorkspace) {
      this.cached = summary;
      return summary;
    }

    const exclude = this.workspace.ignoreRules.excludeGlob();
    const roots = this.workspace.rootPaths();

    const markerGlob = `**/{${PROJECT_MARKERS.join(',')}}`;
    const markers = await vscode.workspace.findFiles(markerGlob, exclude, 200);
    for (const glob of MARKER_GLOBS) {
      markers.push(...(await vscode.workspace.findFiles(glob, exclude, 60)));
    }

    const languages = new Set<string>();
    const frameworks = new Set<string>();
    const packageManagers = new Set<string>();
    const sourceRoots = new Set<string>();
    const testRoots = new Set<string>();

    for (const uri of markers) {
      if (token?.isCancellationRequested) {
        break;
      }
      const name = path.basename(uri.fsPath);
      const relative = toRelative(roots, uri.fsPath);
      const dir = path.dirname(relative) === '.' ? '' : path.dirname(relative);

      if (name === 'package.json') {
        packageManagers.add('npm');
        await this.readPackageJson(uri, languages, frameworks, packageManagers);
        if (dir) {
          sourceRoots.add(dir);
        }
      } else if (name === 'tsconfig.json') {
        languages.add('TypeScript');
      } else if (name === 'angular.json') {
        frameworks.add('Angular');
        languages.add('TypeScript');
      } else if (name === 'nx.json') {
        frameworks.add('Nx');
      } else if (name.endsWith('.csproj') || name.endsWith('.sln')) {
        languages.add('C#');
        frameworks.add('.NET');
        if (dir) {
          (name.toLowerCase().includes('test') || /tests?$/i.test(dir) ? testRoots : sourceRoots).add(dir);
        }
      } else if (name === 'pom.xml' || name.startsWith('build.gradle')) {
        languages.add('Java');
        frameworks.add(name === 'pom.xml' ? 'Maven' : 'Gradle');
      } else if (name === 'requirements.txt' || name === 'pyproject.toml' || name === 'setup.py' || name === 'Pipfile') {
        languages.add('Python');
        packageManagers.add(name === 'pyproject.toml' ? 'pip/poetry' : 'pip');
      } else if (name === 'go.mod') {
        languages.add('Go');
        packageManagers.add('go modules');
      } else if (name === 'Cargo.toml') {
        languages.add('Rust');
        packageManagers.add('cargo');
      } else if (name === 'composer.json') {
        languages.add('PHP');
        packageManagers.add('composer');
      } else if (name === 'Gemfile') {
        languages.add('Ruby');
        packageManagers.add('bundler');
      } else if (name === 'Dockerfile' || name === 'docker-compose.yml') {
        frameworks.add('Docker');
      }
    }

    // One bounded pass over file names: cheap language census plus source/test roots.
    const files = await vscode.workspace.findFiles('**/*', exclude, 8000);
    const extensionCount = new Map<string, number>();
    for (const uri of files) {
      const relative = toRelative(roots, uri.fsPath);
      const top = relative.split('/')[0];
      const lang = languageForPath(uri.fsPath);
      if (lang !== 'plaintext') {
        extensionCount.set(lang, (extensionCount.get(lang) ?? 0) + 1);
      }
      if (/^(tests?|spec|__tests__|e2e)$/i.test(top)) {
        testRoots.add(top);
      } else if (/^(src|app|lib|source|packages|apps|server|client|api)$/i.test(top)) {
        sourceRoots.add(top);
      }
    }

    for (const [lang, count] of Array.from(extensionCount).sort((a, b) => b[1] - a[1]).slice(0, 8)) {
      if (count >= 2) {
        languages.add(WorkspaceScanner.displayLanguage(lang));
      }
    }

    const result: WorkspaceSummary = {
      ...summary,
      languages: Array.from(languages).slice(0, 10),
      frameworks: Array.from(frameworks).slice(0, 10),
      packageManagers: Array.from(packageManagers).slice(0, 6),
      files: files.length,
      sourceRoots: Array.from(sourceRoots).slice(0, 12),
      testRoots: Array.from(testRoots).slice(0, 8),
      indexed: true
    };

    Logger.get().info(
      `Workspace scanned in ${Date.now() - started}ms: ${result.files} files, ${result.languages.join(', ') || 'unknown languages'}`
    );
    this.cached = result;
    return result;
  }

  private async readPackageJson(
    uri: vscode.Uri,
    languages: Set<string>,
    frameworks: Set<string>,
    packageManagers: Set<string>
  ): Promise<void> {
    try {
      const raw = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
      const pkg = JSON.parse(raw) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        packageManager?: string;
      };
      const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
      const known: [string, string][] = [
        ['react', 'React'],
        ['next', 'Next.js'],
        ['@angular/core', 'Angular'],
        ['vue', 'Vue'],
        ['svelte', 'Svelte'],
        ['express', 'Express'],
        ['fastify', 'Fastify'],
        ['@nestjs/core', 'NestJS'],
        ['electron', 'Electron'],
        ['vite', 'Vite'],
        ['webpack', 'Webpack'],
        ['jest', 'Jest'],
        ['vitest', 'Vitest'],
        ['mocha', 'Mocha'],
        ['prisma', 'Prisma'],
        ['typeorm', 'TypeORM']
      ];
      for (const [dep, label] of known) {
        if (deps[dep]) {
          frameworks.add(label);
        }
      }
      if (deps.typescript) {
        languages.add('TypeScript');
      } else {
        languages.add('JavaScript');
      }
      if (pkg.packageManager) {
        packageManagers.add(pkg.packageManager.split('@')[0]);
      }
    } catch {
      // Malformed package.json is not fatal.
    }
  }

  private static displayLanguage(id: string): string {
    const map: Record<string, string> = {
      typescript: 'TypeScript',
      typescriptreact: 'TypeScript',
      javascript: 'JavaScript',
      javascriptreact: 'JavaScript',
      csharp: 'C#',
      python: 'Python',
      java: 'Java',
      go: 'Go',
      rust: 'Rust',
      php: 'PHP',
      ruby: 'Ruby',
      sql: 'SQL',
      cpp: 'C++',
      c: 'C',
      html: 'HTML',
      css: 'CSS',
      scss: 'SCSS',
      markdown: 'Markdown',
      json: 'JSON',
      yaml: 'YAML',
      shellscript: 'Shell'
    };
    return map[id] ?? id;
  }

  private static empty(name: string, folders: readonly vscode.WorkspaceFolder[]): WorkspaceSummary {
    return {
      name,
      folders: folders.map((f) => ({ name: f.name, uri: f.uri.toString() })),
      languages: [],
      frameworks: [],
      packageManagers: [],
      files: 0,
      sourceRoots: [],
      testRoots: [],
      indexed: false
    };
  }
}
