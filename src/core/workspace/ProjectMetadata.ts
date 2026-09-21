import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { toRelative } from './PathSecurity.js';
import type { WorkspaceManager } from './WorkspaceManager.js';
import { Logger } from '../logging/Logger.js';

export interface ProjectMetadata {
  projectId: string;
  workspaceRoot: string;
  projectName: string;
  detectedLanguages: string[];
  frameworks: string[];
  packageManagers: string[];
  buildSystems: string[];
  repositories?: string[];
  branches?: string[];
  gitStatus?: string;
  projectType: string;
  sourceRoots: string[];
  testRoots: string[];
  generatedRoots: string[];
  excludedRoots: string[];
  configFiles: string[];
  entryPoints: string[];
  services: string[];
  apps: string[];
  packages: string[];
  lastIndexedAt: number;
  indexVersion: string;
}

export class ProjectMetadataManager {
  private static readonly INDEX_VERSION = '1.0.0';
  private cached: ProjectMetadata | undefined;

  constructor(private readonly workspace: WorkspaceManager) {}

  current(): ProjectMetadata | undefined {
    return this.cached;
  }

  async detect(token?: vscode.CancellationToken): Promise<ProjectMetadata> {
    const roots = this.workspace.rootPaths();
    const primaryRoot = roots[0] ?? '';
    const projectName = this.workspace.name;
    const projectId = this.workspace.workspaceId;

    const detectedLanguages = new Set<string>();
    const frameworks = new Set<string>();
    const packageManagers = new Set<string>();
    const buildSystems = new Set<string>();
    const sourceRoots = new Set<string>();
    const testRoots = new Set<string>();
    const generatedRoots = new Set<string>();
    const excludedRoots = new Set<string>();
    const configFiles: string[] = [];
    const entryPoints = new Set<string>();
    const services = new Set<string>();
    const apps = new Set<string>();
    const packages = new Set<string>();

    const exclude = this.workspace.ignoreRules.excludeGlob();

    // 1. Detect configuration and manifest files
    const configGlobs = [
      '**/package.json',
      '**/tsconfig*.json',
      '**/angular.json',
      '**/nx.json',
      '**/*.csproj',
      '**/*.sln',
      '**/pom.xml',
      '**/build.gradle*',
      '**/go.mod',
      '**/Cargo.toml',
      '**/requirements.txt',
      '**/pyproject.toml',
      '**/Dockerfile*',
      '**/docker-compose*.yml',
      '**/*.tf'
    ];

    for (const pattern of configGlobs) {
      if (token?.isCancellationRequested) break;
      const found = await vscode.workspace.findFiles(pattern, exclude, 50);
      for (const uri of found) {
        const rel = toRelative(roots, uri.fsPath);
        configFiles.push(rel);
        const fileName = path.basename(uri.fsPath).toLowerCase();
        const dir = path.dirname(rel) === '.' ? '' : path.dirname(rel);

        // Package.json analysis
        if (fileName === 'package.json') {
          packageManagers.add('npm');
          try {
            const bytes = await vscode.workspace.fs.readFile(uri);
            const pkg = JSON.parse(Buffer.from(bytes).toString('utf8')) as Record<string, any>;
            if (pkg.name) packages.add(pkg.name);
            const allDeps = {
              ...(pkg.dependencies || {}),
              ...(pkg.devDependencies || {})
            };

            detectedLanguages.add('JavaScript');
            if (allDeps['typescript'] || configFiles.some((c) => c.includes('tsconfig'))) {
              detectedLanguages.add('TypeScript');
            }
            if (allDeps['@angular/core']) frameworks.add('Angular');
            if (allDeps['react']) frameworks.add('React');
            if (allDeps['vue']) frameworks.add('Vue');
            if (allDeps['next']) frameworks.add('Next.js');
            if (allDeps['express'] || allDeps['@nestjs/core']) {
              frameworks.add(allDeps['@nestjs/core'] ? 'NestJS' : 'Express');
              services.add(dir || 'backend');
            }
            if (pkg.scripts?.build) buildSystems.add('npm run build');
            if (pkg.main) entryPoints.add(path.posix.join(dir, pkg.main));
          } catch {
            // ignore invalid package.json
          }
        }

        // C# and .NET
        if (fileName.endsWith('.csproj') || fileName.endsWith('.sln')) {
          detectedLanguages.add('C#');
          frameworks.add('.NET');
          buildSystems.add('dotnet build');
          if (dir.toLowerCase().includes('test') || fileName.toLowerCase().includes('test')) {
            testRoots.add(dir);
          } else {
            sourceRoots.add(dir);
            services.add(path.basename(fileName, path.extname(fileName)));
          }
        }

        // Java
        if (fileName === 'pom.xml' || fileName.startsWith('build.gradle')) {
          detectedLanguages.add('Java');
          buildSystems.add(fileName === 'pom.xml' ? 'Maven' : 'Gradle');
        }

        // Python
        if (fileName === 'requirements.txt' || fileName === 'pyproject.toml') {
          detectedLanguages.add('Python');
          packageManagers.add(fileName === 'pyproject.toml' ? 'poetry/pip' : 'pip');
        }

        // Go
        if (fileName === 'go.mod') {
          detectedLanguages.add('Go');
          packageManagers.add('go modules');
          buildSystems.add('go build');
        }

        // Rust
        if (fileName === 'cargo.toml') {
          detectedLanguages.add('Rust');
          packageManagers.add('cargo');
          buildSystems.add('cargo build');
        }

        // Containers & Infrastructure
        if (fileName.startsWith('dockerfile')) {
          frameworks.add('Docker');
        }
        if (fileName.endsWith('.tf')) {
          frameworks.add('Terraform');
        }
      }
    }

    // Identify standard directories
    const commonSourceDirs = ['src', 'app', 'lib', 'frontend', 'backend', 'client', 'server', 'api'];
    const commonTestDirs = ['test', 'tests', '__tests__', 'spec'];
    const commonGenDirs = ['dist', 'build', 'out', 'bin', 'obj', 'target', '.next'];

    for (const s of commonSourceDirs) {
      if (roots.some((r) => this.dirExists(r, s))) sourceRoots.add(s);
    }
    for (const t of commonTestDirs) {
      if (roots.some((r) => this.dirExists(r, t))) testRoots.add(t);
    }
    for (const g of commonGenDirs) {
      if (roots.some((r) => this.dirExists(r, g))) generatedRoots.add(g);
    }

    // Determine primary project type
    let projectType = 'general';
    if (frameworks.has('Angular') && frameworks.has('.NET')) {
      projectType = 'fullstack-angular-dotnet';
    } else if (frameworks.has('React') || frameworks.has('Angular') || frameworks.has('Vue')) {
      projectType = 'frontend-web';
    } else if (frameworks.has('.NET')) {
      projectType = 'dotnet-solution';
    } else if (detectedLanguages.has('Python')) {
      projectType = 'python-project';
    } else if (detectedLanguages.has('Go')) {
      projectType = 'go-project';
    } else if (detectedLanguages.has('Java')) {
      projectType = 'java-project';
    } else if (detectedLanguages.has('TypeScript') || detectedLanguages.has('JavaScript')) {
      projectType = 'node-project';
    }

    const metadata: ProjectMetadata = {
      projectId,
      workspaceRoot: primaryRoot,
      projectName,
      detectedLanguages: Array.from(detectedLanguages),
      frameworks: Array.from(frameworks),
      packageManagers: Array.from(packageManagers),
      buildSystems: Array.from(buildSystems),
      projectType,
      sourceRoots: Array.from(sourceRoots),
      testRoots: Array.from(testRoots),
      generatedRoots: Array.from(generatedRoots),
      excludedRoots: Array.from(excludedRoots),
      configFiles,
      entryPoints: Array.from(entryPoints),
      services: Array.from(services),
      apps: Array.from(apps),
      packages: Array.from(packages),
      lastIndexedAt: Date.now(),
      indexVersion: ProjectMetadataManager.INDEX_VERSION
    };

    this.cached = metadata;
    Logger.get().info(`Project metadata detected: ${projectType} (${metadata.detectedLanguages.join(', ')})`);
    return metadata;
  }

  private dirExists(root: string, dir: string): boolean {
    try {
      return fs.existsSync(path.join(root, dir));
    } catch {
      return false;
    }
  }
}
