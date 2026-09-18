import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import type { CheckpointView } from '../../shared/types.js';
import type { ResolvedPath, WorkspaceManager } from '../workspace/WorkspaceManager.js';
import type { DiffManager } from './DiffManager.js';
import { Logger } from '../logging/Logger.js';

interface FileSnapshot {
  relativePath: string;
  fsPath: string;
  /** undefined means the file did not exist before the change. */
  before?: string;
}

interface Checkpoint {
  id: string;
  index: number;
  conversationId: string;
  label: string;
  createdAt: number;
  files: FileSnapshot[];
}

/**
 * Local checkpoints. Before the agent touches a file, its previous contents are
 * captured in extension storage, so a change can be inspected and undone
 * without Git. Git is used when present only to label the checkpoint; it is
 * never required, and the workspace is never reset automatically.
 */
export class CheckpointManager {
  private readonly checkpoints: Checkpoint[] = [];
  private current: Checkpoint | undefined;
  private counter = 0;

  constructor(
    private readonly storage: vscode.Memento,
    private readonly workspace: WorkspaceManager,
    private readonly diffs: DiffManager,
    private readonly enabled: () => boolean,
    private readonly onChanged: () => void
  ) {
    const restored = this.storage.get<Checkpoint[]>('mytechin.checkpoints', []);
    this.checkpoints.push(...restored.slice(-30));
    this.counter = this.checkpoints.at(-1)?.index ?? 0;
  }

  /** Opens a checkpoint that collects every file touched by one agent turn. */
  beginTurn(conversationId: string, label: string): void {
    if (!this.enabled()) {
      return;
    }
    this.current = {
      id: randomUUID(),
      index: ++this.counter,
      conversationId,
      label,
      createdAt: Date.now(),
      files: []
    };
  }

  /** Closes the turn, discarding it when nothing actually changed. */
  async endTurn(): Promise<void> {
    if (!this.current) {
      return;
    }
    if (this.current.files.length > 0) {
      this.checkpoints.push(this.current);
      while (this.checkpoints.length > 30) {
        this.checkpoints.shift();
      }
      await this.persist();
      this.onChanged();
      Logger.get().info(`Checkpoint #${this.current.index} recorded (${this.current.files.length} files)`);
    }
    this.current = undefined;
  }

  async captureBeforeChange(
    conversationId: string,
    resolved: ResolvedPath,
    before: string | undefined,
    label: string
  ): Promise<void> {
    if (!this.enabled()) {
      return;
    }
    if (!this.current) {
      this.beginTurn(conversationId, label);
    }
    const checkpoint = this.current;
    if (!checkpoint) {
      return;
    }
    if (checkpoint.files.some((f) => f.fsPath === resolved.fsPath)) {
      return; // Keep the earliest state of the turn.
    }
    checkpoint.files.push({
      relativePath: resolved.relativePath,
      fsPath: resolved.fsPath,
      before
    });
  }

  views(): CheckpointView[] {
    return this.checkpoints
      .slice()
      .reverse()
      .map((checkpoint) => ({
        id: checkpoint.id,
        index: checkpoint.index,
        label: checkpoint.label,
        createdAt: checkpoint.createdAt,
        added: checkpoint.files.filter((f) => f.before === undefined).map((f) => f.relativePath),
        modified: checkpoint.files.filter((f) => f.before !== undefined).map((f) => f.relativePath),
        deleted: []
      }));
  }

  /** Opens a diff of each file in the checkpoint against its current state. */
  async compare(checkpointId: string): Promise<void> {
    const checkpoint = this.checkpoints.find((c) => c.id === checkpointId);
    if (!checkpoint) {
      throw new Error('That checkpoint is no longer available.');
    }
    for (const file of checkpoint.files.slice(0, 5)) {
      const uri = vscode.Uri.file(file.fsPath);
      const exists = await vscode.workspace.fs.stat(uri).then(
        () => true,
        () => false
      );
      await this.diffs.showCheckpointDiff(
        file.relativePath,
        file.before ?? '',
        exists ? uri : undefined
      );
    }
  }

  /**
   * Restores every file in a checkpoint. Always confirms first — rollback is
   * never automatic.
   */
  async restore(checkpointId: string): Promise<{ restored: string[]; removed: string[] }> {
    const checkpoint = this.checkpoints.find((c) => c.id === checkpointId);
    if (!checkpoint) {
      throw new Error('That checkpoint is no longer available.');
    }

    const answer = await vscode.window.showWarningMessage(
      `Restore ${checkpoint.files.length} file${checkpoint.files.length === 1 ? '' : 's'} to checkpoint #${checkpoint.index}?`,
      { modal: true, detail: checkpoint.files.map((f) => f.relativePath).join('\n') },
      'Restore'
    );
    if (answer !== 'Restore') {
      return { restored: [], removed: [] };
    }

    const restored: string[] = [];
    const removed: string[] = [];
    for (const file of checkpoint.files) {
      const uri = vscode.Uri.file(file.fsPath);
      if (file.before === undefined) {
        await vscode.workspace.fs.delete(uri, { useTrash: true }).then(
          () => removed.push(file.relativePath),
          () => undefined
        );
      } else {
        await vscode.workspace.fs.writeFile(uri, Buffer.from(file.before, 'utf8'));
        restored.push(file.relativePath);
      }
    }
    Logger.get().info(`Checkpoint #${checkpoint.index} restored`, { restored, removed });
    return { restored, removed };
  }

  forConversation(conversationId: string): CheckpointView[] {
    return this.views().filter((view) =>
      this.checkpoints.some((c) => c.id === view.id && c.conversationId === conversationId)
    );
  }

  /** Best-effort branch label, so a checkpoint reads sensibly in a Git repo. */
  async gitLabel(): Promise<string | undefined> {
    try {
      const extension = vscode.extensions.getExtension('vscode.git');
      const api = extension?.isActive
        ? extension.exports?.getAPI?.(1)
        : (await extension?.activate())?.getAPI?.(1);
      const repo = api?.repositories?.find((r: any) =>
        this.workspace.rootPaths().some((root) => r.rootUri?.fsPath?.startsWith(root))
      );
      return repo?.state?.HEAD?.name;
    } catch {
      return undefined;
    }
  }

  private async persist(): Promise<void> {
    // Cap stored snapshot size so the global state file stays small.
    const trimmed = this.checkpoints.map((checkpoint) => ({
      ...checkpoint,
      files: checkpoint.files.map((file) => ({
        ...file,
        before: file.before !== undefined && file.before.length > 400_000 ? undefined : file.before
      }))
    }));
    await this.storage.update('mytechin.checkpoints', trimmed);
  }
}
