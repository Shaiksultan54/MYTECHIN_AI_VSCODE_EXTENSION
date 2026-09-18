import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import type { ContextSummaryView } from '../../shared/types.js';
import type { AttachmentManager } from './AttachmentManager.js';
import { ContextBudget, estimateTokens } from './ContextBudget.js';
import type { ContextCollector } from './ContextCollector.js';
import { ContextRanker } from './ContextRanker.js';
import type { BuiltContext, ContextPiece } from './ContextTypes.js';
import type { FileSearcher } from '../workspace/FileSearcher.js';
import type { WorkspaceManager } from '../workspace/WorkspaceManager.js';
import type { FileReader } from '../workspace/FileReader.js';
import type { TerminalManager } from '../terminal/TerminalManager.js';
import { Logger } from '../logging/Logger.js';

export interface MentionResolution {
  /** The prompt with @mentions left intact — the model sees them as written. */
  prompt: string;
  pieces: ContextPiece[];
}

const MENTION_PATTERN =
  /@(file|folder|selection|workspace|problems|terminal|currentFile)(?:\s+([^\s@]+))?/g;

/**
 * Runs the context pipeline: intent → attachments → editor → mentions → search
 * → budget. The result is the complete set of material sent to the model, plus
 * the summary shown behind the Context button.
 */
export class ContextManager {
  private readonly ranker = new ContextRanker();
  private lastSummary: ContextSummaryView | undefined;

  constructor(
    private readonly collector: ContextCollector,
    private readonly attachments: AttachmentManager,
    private readonly searcher: FileSearcher,
    private readonly workspace: WorkspaceManager,
    private readonly reader: FileReader,
    private readonly terminal: TerminalManager,
    private readonly budgetTokens: () => number
  ) {}

  summary(): ContextSummaryView | undefined {
    return this.lastSummary;
  }

  async build(prompt: string, token: vscode.CancellationToken): Promise<BuiltContext> {
    const started = Date.now();
    const attachments = this.attachments.list();
    const intent = this.ranker.analyze(prompt, attachments.length > 0);

    const pieces: ContextPiece[] = [];
    const seenPaths = new Set<string>();

    // Tier 0 — workspace map, always included when a workspace is open.
    if (this.workspace.hasWorkspace && intent.needsWorkspace) {
      pieces.push(this.collector.workspaceMap());
    }

    // Tier 1/2 — explicit attachments and selections.
    const attachmentPieces = await this.collector.fromAttachments(attachments);
    for (const piece of attachmentPieces) {
      pieces.push(piece);
      seenPaths.add(piece.label);
    }

    // Terminal attachment needs the terminal manager, which the collector does not hold.
    if (attachments.some((a) => a.type === 'terminal')) {
      const piece = this.terminalPiece();
      if (piece) {
        pieces.push(piece);
      }
    }

    if (token.isCancellationRequested) {
      return this.finish(pieces, intent, started);
    }

    // Tier 3 — the open editor, unless it is already attached.
    if (intent.needsWorkspace) {
      const editor = await this.collector.currentEditor();
      if (editor && !seenPaths.has(editor.label)) {
        pieces.push(editor);
        seenPaths.add(editor.label);
      }
    }

    // Tier 4 — explicit @mentions.
    const mentionPieces = await this.resolveMentions(prompt, seenPaths);
    for (const piece of mentionPieces) {
      pieces.push(piece);
      seenPaths.add(piece.label);
    }

    // Problems, when the request is about fixing something.
    if (intent.needsProblems && !pieces.some((p) => p.kind === 'problems')) {
      const problems = this.collector.problems();
      if (problems) {
        pieces.push(problems);
      }
    }

    if (token.isCancellationRequested) {
      return this.finish(pieces, intent, started);
    }

    // Tier 5 — repository search, only when it can actually help.
    const shouldSearch =
      intent.needsWorkspace &&
      intent.kind !== 'general-question' &&
      this.workspace.hasWorkspace &&
      attachmentPieces.filter((p) => p.kind === 'file').length < 4;

    if (shouldSearch) {
      try {
        const searchPieces = await this.collector.fromSearch(intent, seenPaths);
        pieces.push(...searchPieces);
      } catch (error) {
        Logger.get().warn('Context search failed', error);
      }
    }

    return this.finish(pieces, intent, started);
  }

  private finish(pieces: ContextPiece[], intent: BuiltContext['intent'], started: number): BuiltContext {
    const budget = new ContextBudget(this.budgetTokens());
    const { kept, dropped, totalTokens } = budget.fit(pieces);

    this.lastSummary = {
      items: kept.map((piece) => ({
        kind: piece.kind,
        label: piece.label,
        detail: piece.detail,
        tokens: piece.tokens,
        reason: piece.reason,
        uri: piece.uri
      })),
      totalTokens,
      budgetTokens: this.budgetTokens(),
      droppedCount: dropped.length
    };

    Logger.get().info(
      `Context built in ${Date.now() - started}ms: ${kept.length} pieces, ~${totalTokens} tokens, intent=${intent.kind}`
    );

    return {
      pieces: kept,
      droppedCount: dropped.length,
      totalTokens,
      budgetTokens: this.budgetTokens(),
      intent
    };
  }

  private terminalPiece(): ContextPiece | undefined {
    const last = this.terminal.lastOutput();
    if (!last) {
      return undefined;
    }
    const body = `Last command: ${last.command}\nExit code: ${last.exitCode}\n\n${last.stdout}${last.stderr ? `\n[stderr]\n${last.stderr}` : ''}`.slice(
      0,
      12000
    );
    return {
      id: randomUUID(),
      source: 'attachment',
      kind: 'terminal',
      label: `Terminal: ${last.command}`,
      detail: `exit ${last.exitCode}`,
      body,
      tokens: estimateTokens(body),
      reason: 'Attached terminal output'
    };
  }

  /** Resolves @file / @folder / @problems and friends into context pieces. */
  private async resolveMentions(prompt: string, seen: Set<string>): Promise<ContextPiece[]> {
    const pieces: ContextPiece[] = [];
    const matches = Array.from(prompt.matchAll(MENTION_PATTERN));

    for (const match of matches) {
      const [, kind, argument] = match;
      try {
        switch (kind) {
          case 'file':
          case 'currentFile': {
            const target =
              kind === 'currentFile'
                ? vscode.window.activeTextEditor?.document.uri.fsPath
                : argument;
            if (!target) {
              break;
            }
            const path = await this.resolveMentionPath(target);
            if (!path || seen.has(path)) {
              break;
            }
            const resolved = this.workspace.resolve(path);
            const result = await this.reader.read(resolved, {
              endLine: 800,
              reason: `mentioned as @${kind}`,
              source: 'mention'
            });
            const body = `File: ${result.relativePath}\n\`\`\`${result.language}\n${result.content}\n\`\`\``;
            pieces.push({
              id: randomUUID(),
              source: 'mention',
              kind: 'file',
              label: result.relativePath,
              detail: `${result.totalLines} lines`,
              uri: resolved.uri.toString(),
              body,
              tokens: estimateTokens(body),
              reason: `You wrote @${kind}`
            });
            break;
          }

          case 'folder': {
            if (!argument) {
              break;
            }
            const resolved = this.workspace.resolve(argument);
            const entries = await this.workspace.listDirectory(resolved);
            const body = `Folder ${resolved.relativePath}:\n${entries
              .map((e) => `${e.type === 'directory' ? '📁' : '  '} ${e.name}`)
              .join('\n')}`;
            pieces.push({
              id: randomUUID(),
              source: 'mention',
              kind: 'folder',
              label: resolved.relativePath,
              detail: `${entries.length} entries`,
              body,
              tokens: estimateTokens(body),
              reason: 'You wrote @folder'
            });
            break;
          }

          case 'selection': {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.selection.isEmpty) {
              break;
            }
            const resolved = this.workspace.resolveUri(editor.document.uri);
            const text = editor.document.getText(editor.selection);
            const body = `Selection in ${resolved.relativePath} (lines ${editor.selection.start.line + 1}–${editor.selection.end.line + 1}):\n\`\`\`${editor.document.languageId}\n${text}\n\`\`\``;
            pieces.push({
              id: randomUUID(),
              source: 'selection',
              kind: 'selection',
              label: resolved.relativePath,
              detail: `lines ${editor.selection.start.line + 1}–${editor.selection.end.line + 1}`,
              body,
              tokens: estimateTokens(body),
              reason: 'You wrote @selection'
            });
            break;
          }

          case 'problems': {
            if (pieces.some((p) => p.kind === 'problems')) {
              break;
            }
            const problems = this.collector.problems(60);
            if (problems) {
              pieces.push({ ...problems, reason: 'You wrote @problems' });
            }
            break;
          }

          case 'terminal': {
            const piece = this.terminalPiece();
            if (piece) {
              pieces.push({ ...piece, reason: 'You wrote @terminal' });
            }
            break;
          }

          case 'workspace': {
            if (!pieces.some((p) => p.kind === 'workspace')) {
              pieces.push({ ...this.collector.workspaceMap(), reason: 'You wrote @workspace' });
            }
            break;
          }

          default:
            break;
        }
      } catch (error) {
        Logger.get().warn(`Could not resolve @${kind} ${argument ?? ''}`, error);
      }
    }

    return pieces;
  }

  /** An @file mention may be a bare name; find the best matching path. */
  private async resolveMentionPath(argument: string): Promise<string | undefined> {
    const cleaned = argument.replace(/^["'[]|["'\]]$/g, '');
    try {
      const resolved = this.workspace.resolve(cleaned);
      if (await this.workspace.exists(resolved)) {
        return resolved.relativePath;
      }
    } catch {
      // Fall through to search.
    }
    const matches = await this.searcher.findFiles(cleaned.split('/').pop() ?? cleaned, 5);
    return matches[0];
  }
}
