import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { MAX_ATTACHMENT_BYTES } from '../../shared/constants/index.js';
import type { ContextAttachment } from '../../shared/types.js';
import type { WorkspaceManager } from '../workspace/WorkspaceManager.js';
import type { FileReader } from '../workspace/FileReader.js';
import { PathSecurityError, isLikelyBinary, isImage } from '../workspace/PathSecurity.js';
import { Logger } from '../logging/Logger.js';

export interface PastedSnippet {
  id: string;
  text: string;
  language?: string;
}

/**
 * Owns the attachments queued for the next message. Dropped files are validated
 * and described here, but their contents are not loaded until the context is
 * built — the spec is explicit that a dropped file must not be injected blindly.
 */
export class AttachmentManager {
  private attachments: ContextAttachment[] = [];
  private readonly pasted = new Map<string, PastedSnippet>();

  constructor(
    private readonly workspace: WorkspaceManager,
    private readonly reader: FileReader,
    private readonly onChanged: () => void
  ) {}

  list(): ContextAttachment[] {
    return this.attachments.slice();
  }

  pastedSnippet(id: string): PastedSnippet | undefined {
    return this.pasted.get(id);
  }

  clear(): void {
    this.attachments = [];
    this.pasted.clear();
    this.onChanged();
  }

  remove(id: string): void {
    this.attachments = this.attachments.filter((a) => a.id !== id);
    this.pasted.delete(id);
    this.onChanged();
  }

  /** Adds files or folders arriving from a drop, the explorer or a picker. */
  async addUris(uris: vscode.Uri[]): Promise<{ added: number; errors: string[] }> {
    const errors: string[] = [];
    let added = 0;

    for (const uri of uris) {
      try {
        const resolved = this.workspace.resolveUri(uri);

        if (this.attachments.some((a) => a.uri === resolved.uri.toString() && !a.lineStart)) {
          continue;
        }

        const isDirectory = await this.workspace.isDirectory(resolved);
        if (isDirectory) {
          const entries = await this.workspace.listDirectory(resolved);
          this.push({
            id: randomUUID(),
            type: 'folder',
            uri: resolved.uri.toString(),
            relativePath: resolved.relativePath,
            status: 'loaded',
            sizeBytes: entries.length,
            sensitive: false
          });
          added++;
          continue;
        }

        if (isImage(resolved.fsPath)) {
          const metadata = await this.reader.metadata(resolved).catch(() => undefined);
          this.push({
            id: randomUUID(),
            type: 'image',
            uri: resolved.uri.toString(),
            relativePath: resolved.relativePath,
            sizeBytes: metadata?.sizeBytes ?? 0,
            status: 'loaded',
            sensitive: resolved.sensitive
          });
          added++;
          continue;
        }

        if (isLikelyBinary(resolved.fsPath)) {
          errors.push(`${resolved.relativePath} is a binary file and cannot be attached.`);
          continue;
        }

        const metadata = await this.reader.metadata(resolved).catch(() => undefined);
        const sizeBytes = metadata?.sizeBytes ?? 0;

        this.push({
          id: randomUUID(),
          type: 'file',
          uri: resolved.uri.toString(),
          relativePath: resolved.relativePath,
          language: resolved.language,
          sizeBytes,
          // Large files are attached but read by range at context-build time.
          status: sizeBytes > MAX_ATTACHMENT_BYTES ? 'pending' : 'loaded',
          sensitive: resolved.sensitive
        });
        added++;
      } catch (error) {
        const message =
          error instanceof PathSecurityError
            ? error.message
            : `${uri.fsPath}: ${(error as Error).message}`;
        errors.push(message);
        Logger.get().warn('Attachment refused', message);
      }
    }

    if (added > 0) {
      this.onChanged();
    }
    return { added, errors };
  }

  /** Attaches the active editor's file. */
  async addCurrentFile(): Promise<string | undefined> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return 'No file is open in the editor.';
    }
    const result = await this.addUris([editor.document.uri]);
    return result.errors[0];
  }

  /** Attaches the selected lines rather than the whole file. */
  async addSelection(): Promise<string | undefined> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) {
      return 'Nothing is selected in the editor.';
    }
    const resolved = this.workspace.resolveUri(editor.document.uri);
    this.push({
      id: randomUUID(),
      type: 'selection',
      uri: resolved.uri.toString(),
      relativePath: resolved.relativePath,
      language: editor.document.languageId,
      lineStart: editor.selection.start.line + 1,
      lineEnd: editor.selection.end.line + 1,
      status: 'loaded',
      sensitive: resolved.sensitive
    });
    this.onChanged();
    return undefined;
  }

  addProblems(): void {
    if (this.attachments.some((a) => a.type === 'problems')) {
      return;
    }
    const count = vscode.languages
      .getDiagnostics()
      .reduce((total, [, diagnostics]) => total + diagnostics.length, 0);
    this.push({
      id: randomUUID(),
      type: 'problems',
      relativePath: 'Problems panel',
      sizeBytes: count,
      status: 'loaded'
    });
    this.onChanged();
  }

  addTerminal(): void {
    if (this.attachments.some((a) => a.type === 'terminal')) {
      return;
    }
    this.push({
      id: randomUUID(),
      type: 'terminal',
      relativePath: 'Last command output',
      status: 'loaded'
    });
    this.onChanged();
  }

  /** Pasted code becomes a selection-style attachment with inline content. */
  addPastedCode(text: string, language?: string): void {
    const id = randomUUID();
    const lines = text.split('\n').length;
    this.pasted.set(id, { id, text, language });
    this.push({
      id,
      type: 'selection',
      relativePath: 'Pasted code',
      language: language ?? 'plaintext',
      lineStart: 1,
      lineEnd: lines,
      sizeBytes: Buffer.byteLength(text, 'utf8'),
      status: 'loaded'
    });
    this.onChanged();
  }

  addDataUrl(name: string, dataUrl: string, _mimeType: string): void {
    const size = Buffer.byteLength(dataUrl, 'utf8');
    this.push({
      id: randomUUID(),
      type: 'image',
      uri: dataUrl,
      relativePath: name,
      sizeBytes: size,
      status: 'loaded'
    });
    this.onChanged();
  }

  /** Every sensitive attachment currently queued, for the cloud warning. */
  sensitiveOnes(): ContextAttachment[] {
    return this.attachments.filter((a) => a.sensitive);
  }

  private push(attachment: ContextAttachment): void {
    if (this.attachments.length >= 30) {
      this.attachments.shift();
    }
    this.attachments.push(attachment);
  }
}
