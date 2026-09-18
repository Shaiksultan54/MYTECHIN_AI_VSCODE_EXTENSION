import * as vscode from 'vscode';
import type { WorkspaceScanner } from './WorkspaceScanner.js';

/**
 * Invalidates the workspace map when project markers change. Deliberately
 * narrow: watching every file in a large repository is expensive and buys
 * nothing, because source files do not change the project shape.
 */
export class WorkspaceWatcher implements vscode.Disposable {
  private readonly watcher: vscode.FileSystemWatcher;
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly scanner: WorkspaceScanner, private readonly onChanged: () => void) {
    this.watcher = vscode.workspace.createFileSystemWatcher(
      '**/{package.json,tsconfig.json,angular.json,go.mod,Cargo.toml,pom.xml,composer.json,pyproject.toml,requirements.txt,*.csproj,*.sln}'
    );
    const handle = (): void => this.schedule();
    this.watcher.onDidChange(handle);
    this.watcher.onDidCreate(handle);
    this.watcher.onDidDelete(handle);
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
  }
}
