import * as vscode from 'vscode';
import type { ResolvedPath, WorkspaceManager } from './WorkspaceManager.js';
import { isLikelyBinary } from './PathSecurity.js';

export interface FileReadRecord {
  path: string;
  startLine?: number;
  endLine?: number;
  reason: string;
  source: 'user-attachment' | 'agent' | 'mention' | 'search' | 'editor';
}

export interface FileReadResult {
  record: FileReadRecord;
  relativePath: string;
  language: string;
  content: string;
  totalLines: number;
  startLine: number;
  endLine: number;
  truncated: boolean;
  sizeBytes: number;
}

export interface FileMetadata {
  relativePath: string;
  sizeBytes: number;
  totalLines: number;
  language: string;
  isBinary: boolean;
  modified: number;
}

export class FileTooLargeError extends Error {
  constructor(public readonly metadata: FileMetadata) {
    super(
      `${metadata.relativePath} is ${Math.round(metadata.sizeBytes / 1024)} KB. Read a line range instead of the whole file.`
    );
    this.name = 'FileTooLargeError';
  }
}

/**
 * Controlled reads. Every read carries a reason and a source, large files are
 * read by range rather than whole, and binaries are refused outright.
 */
export class FileReader {
  constructor(
    private readonly workspace: WorkspaceManager,
    private readonly maxBytes: () => number
  ) {}

  async metadata(resolved: ResolvedPath): Promise<FileMetadata> {
    const stat = await this.workspace.stat(resolved);
    const binary = isLikelyBinary(resolved.fsPath);
    let totalLines = 0;
    if (!binary && stat.size <= this.maxBytes()) {
      const bytes = await vscode.workspace.fs.readFile(resolved.uri);
      totalLines = FileReader.countLines(Buffer.from(bytes).toString('utf8'));
    }
    return {
      relativePath: resolved.relativePath,
      sizeBytes: stat.size,
      totalLines,
      language: resolved.language,
      isBinary: binary,
      modified: stat.mtime
    };
  }

  /**
   * Reads a file or a line range of it. Unsaved editor content wins over disk
   * so the agent sees what the user sees.
   */
  async read(
    resolved: ResolvedPath,
    record: Omit<FileReadRecord, 'path'>
  ): Promise<FileReadResult> {
    if (isLikelyBinary(resolved.fsPath)) {
      throw new Error(`${resolved.relativePath} looks like a binary file and was not read.`);
    }

    const stat = await this.workspace.stat(resolved);
    const limit = this.maxBytes();
    const wantsRange = record.startLine !== undefined || record.endLine !== undefined;

    if (stat.size > limit && !wantsRange) {
      throw new FileTooLargeError(await this.metadata(resolved));
    }

    const text = await this.readText(resolved, stat.size > limit);
    const lines = text.split(/\r?\n/);
    const totalLines = lines.length;

    const start = Math.max(1, record.startLine ?? 1);
    let end = Math.min(totalLines, record.endLine ?? totalLines);
    if (end < start) {
      end = start;
    }

    let slice = lines.slice(start - 1, end).join('\n');
    let truncated = start > 1 || end < totalLines;

    if (Buffer.byteLength(slice, 'utf8') > limit) {
      slice = slice.slice(0, limit);
      truncated = true;
      end = start + FileReader.countLines(slice) - 1;
    }

    return {
      record: { ...record, path: resolved.relativePath },
      relativePath: resolved.relativePath,
      language: resolved.language,
      content: slice,
      totalLines,
      startLine: start,
      endLine: end,
      truncated,
      sizeBytes: stat.size
    };
  }

  private async readText(resolved: ResolvedPath, partial: boolean): Promise<string> {
    const open = vscode.workspace.textDocuments.find(
      (doc) => doc.uri.fsPath === resolved.uri.fsPath && !doc.isClosed
    );
    if (open) {
      return open.getText();
    }
    const bytes = await vscode.workspace.fs.readFile(resolved.uri);
    const buffer = Buffer.from(bytes);
    const sliced = partial ? buffer.subarray(0, this.maxBytes() * 4) : buffer;
    return sliced.toString('utf8');
  }

  private static countLines(text: string): number {
    if (text.length === 0) {
      return 0;
    }
    return text.split(/\r?\n/).length;
  }
}
