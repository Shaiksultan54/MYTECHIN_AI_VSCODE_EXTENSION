import * as vscode from 'vscode';
import type { WorkspaceScanner } from './WorkspaceScanner.js';

/**
 * Refreshes project metadata for marker changes and forwards source-file
 * changes for incremental consumers such as WorkspaceGraph.
 */
export class WorkspaceWatcher implements vscode.Disposable {
  private readonly watcher: vscode.FileSystemWatcher;
  private readonly sourceWatcher: vscode.FileSystemWatcher;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly scanner: WorkspaceScanner,
    private readonly onChanged: (uri?: vscode.Uri, deleted?: boolean) => void
  ) {
    this.watcher = vscode.workspace.createFileSystemWatcher(
      '**/{package.json,tsconfig.json,angular.json,go.mod,Cargo.toml,pom.xml,composer.json,pyproject.toml,requirements.txt,*.csproj,*.sln}'
    );
    const handle = (): void => this.schedule();
    this.watcher.onDidChange(handle);
    this.watcher.onDidCreate(handle);
    this.watcher.onDidDelete(handle);

    const sourceWatcher = vscode.workspace.createFileSystemWatcher('**/*.{ts,tsx,js,jsx,mjs,cjs,py,go,cs}');
    sourceWatcher.onDidChange((uri) => this.onChanged(uri, false));
    sourceWatcher.onDidCreate((uri) => this.onChanged(uri, false));
    sourceWatcher.onDidDelete((uri) => this.onChanged(uri, true));
    this.sourceWatcher = sourceWatcher;
  }

  private schedule(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.scanner.invalidate();
      void this.scanner.scan().then(() => this.onChanged());
    }, 2500);
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.watcher.dispose();
    this.sourceWatcher.dispose();
  }
}
