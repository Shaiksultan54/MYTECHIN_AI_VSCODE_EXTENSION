/**
 * A tiny stand-in for the `vscode` module.
 *
 * Only the surface the unit-tested modules actually touch is implemented. Tests
 * that need real editor behaviour belong in an integration run inside VS Code;
 * these tests cover the pure logic — path safety, budgets, parsing, policy.
 */

export class EventEmitter<T> {
  private readonly listeners: ((value: T) => void)[] = [];

  readonly event = (listener: (value: T) => void): Disposable => {
    this.listeners.push(listener);
    return new Disposable(() => {
      const index = this.listeners.indexOf(listener);
      if (index !== -1) {
        this.listeners.splice(index, 1);
      }
    });
  };

  fire(value: T): void {
    for (const listener of [...this.listeners]) {
      listener(value);
    }
  }

  dispose(): void {
    this.listeners.length = 0;
  }
}

export class Disposable {
  constructor(private readonly callback: () => void = () => undefined) {}

  dispose(): void {
    this.callback();
  }

  static from(...items: { dispose(): unknown }[]): Disposable {
    return new Disposable(() => items.forEach((item) => item.dispose()));
  }
}

export class CancellationTokenSource {
  private cancelled = false;
  private readonly emitter = new EventEmitter<void>();

  readonly token = {
    get isCancellationRequested(): boolean {
      return false;
    },
    onCancellationRequested: this.emitter.event
  };

  cancel(): void {
    if (!this.cancelled) {
      this.cancelled = true;
      this.emitter.fire();
    }
  }

  dispose(): void {
    this.emitter.dispose();
  }
}

export class CancellationError extends Error {
  constructor() {
    super('Canceled');
    this.name = 'CancellationError';
  }
}

export class Position {
  constructor(
    readonly line: number,
    readonly character: number
  ) {}
}

export class Range {
  constructor(
    readonly start: Position,
    readonly end: Position
  ) {}
}

export class Selection extends Range {}

export class WorkspaceEdit {
  replace(): void {}
}

export const Uri = {
  file: (fsPath: string) => ({ scheme: 'file', fsPath, path: fsPath, toString: () => `file://${fsPath}` }),
  parse: (value: string) => ({ scheme: 'file', fsPath: value, path: value, toString: () => value }),
  joinPath: (base: { fsPath: string }, ...parts: string[]) => Uri.file([base.fsPath, ...parts].join('/'))
};

export const workspace = {
  workspaceFolders: undefined as unknown[] | undefined,
  getConfiguration: () => ({
    get: <T>(_key: string, fallback?: T): T | undefined => fallback,
    update: async () => undefined
  }),
  onDidChangeConfiguration: () => new Disposable(),
  onDidChangeWorkspaceFolders: () => new Disposable(),
  asRelativePath: (value: unknown) => String(value),
  findFiles: async () => [],
  fs: {
    readFile: async () => new Uint8Array(),
    writeFile: async () => undefined,
    rename: async () => undefined,
    stat: async () => ({ size: 0, type: 1, ctime: 0, mtime: 0 }),
    delete: async () => undefined,
    createDirectory: async () => undefined,
    readDirectory: async () => []
  },
  registerTextDocumentContentProvider: () => new Disposable(),
  createFileSystemWatcher: () => ({
    onDidChange: () => new Disposable(),
    onDidCreate: () => new Disposable(),
    onDidDelete: () => new Disposable(),
    dispose: () => undefined
  }),
  openTextDocument: async () => ({ getText: () => '' }),
  applyEdit: async () => true,
  textDocuments: [] as unknown[]
};

export const window = {
  activeTextEditor: undefined as unknown,
  visibleTextEditors: [] as unknown[],
  createOutputChannel: () => ({
    appendLine: () => undefined,
    append: () => undefined,
    show: () => undefined,
    dispose: () => undefined,
    clear: () => undefined
  }),
  showInformationMessage: async () => undefined,
  showWarningMessage: async () => undefined,
  showErrorMessage: async () => undefined,
  showInputBox: async () => undefined,
  showQuickPick: async () => undefined,
  showOpenDialog: async () => undefined,
  showTextDocument: async () => ({ selection: undefined, revealRange: () => undefined }),
  registerWebviewViewProvider: () => new Disposable(),
  createTerminal: (_options?: unknown) => ({ sendText: (_text: string) => undefined, show: () => undefined, dispose: () => undefined })
};

export const executeCommandHandler = {
  run: async (..._args: unknown[]) => undefined
};

export const commands = {
  registerCommand: () => new Disposable(),
  executeCommand: async (...args: unknown[]) => executeCommandHandler.run(...args)
};

export const languages = {
  getDiagnostics: () => [] as unknown[],
  setTextDocumentLanguage: async () => undefined
};

export const extensions = {
  getExtension: () => undefined
};

export const env = {
  appRoot: '/vscode',
  clipboard: { writeText: async () => undefined }
};

export const TextEditorRevealType = { InCenter: 2 };
export const DiagnosticSeverity = { Error: 0, Warning: 1, Information: 2, Hint: 3 };
export const FileType = { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 };
export const ViewColumn = { Active: -1, Beside: -2, One: 1 };
export const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 };
