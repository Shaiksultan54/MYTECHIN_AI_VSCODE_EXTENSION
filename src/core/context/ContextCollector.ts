import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import type { ContextAttachment } from '../../shared/types.js';
import type { WorkspaceManager } from '../workspace/WorkspaceManager.js';
import type { FileReader } from '../workspace/FileReader.js';
import type { FileSearcher } from '../workspace/FileSearcher.js';
import type { WorkspaceScanner } from '../workspace/WorkspaceScanner.js';
import { toRelative } from '../workspace/PathSecurity.js';
import { Logger } from '../logging/Logger.js';
import type { AttachmentManager } from './AttachmentManager.js';
import type { SemanticSearchService } from '../search/SemanticSearchService.js';
import type { WorkspaceGraph } from '../workspace/WorkspaceGraph.js';
import { estimateTokens } from './ContextBudget.js';
import type { ContextPiece, Intent } from './ContextTypes.js';

const MAX_ATTACHMENT_LINES = 800;
const MAX_SEARCH_FILES = 6;
const MAX_SEARCH_LINES = 220;

/**
 * Turns the user's request plus the editor state into candidate context pieces.
 * Collection is tiered so the expensive tiers (repository search, related file
 * reads) only run when the intent actually calls for them.
 */
export class ContextCollector {
  constructor(
    private readonly workspace: WorkspaceManager,
    private readonly reader: FileReader,
    private readonly searcher: FileSearcher,
    private readonly scanner: WorkspaceScanner,
    private readonly attachments: AttachmentManager,
    private readonly semanticSearch?: SemanticSearchService,
    private readonly graph?: WorkspaceGraph
  ) {}

  /** Tier 0: the lightweight workspace map. Always cheap, always included. */
  workspaceMap(): ContextPiece {
    const summary = this.scanner.current();
    const lines = [
      `Name: ${summary.name}`,
      summary.folders.length > 1
        ? `Folders: ${summary.folders.map((f) => f.name).join(', ')}`
        : undefined,
      summary.languages.length ? `Languages: ${summary.languages.join(', ')}` : undefined,
      summary.frameworks.length ? `Frameworks: ${summary.frameworks.join(', ')}` : undefined,
      summary.packageManagers.length ? `Package managers: ${summary.packageManagers.join(', ')}` : undefined,
      summary.sourceRoots.length ? `Source roots: ${summary.sourceRoots.join(', ')}` : undefined,
      summary.testRoots.length ? `Test roots: ${summary.testRoots.join(', ')}` : undefined,
      summary.files ? `Indexed files: ${summary.files}` : undefined
    ].filter(Boolean);

    const body = lines.join('\n');
    return {
      id: randomUUID(),
      source: 'workspace-map',
      kind: 'workspace',
      label: summary.name,
      detail: summary.languages.join(', '),
      body,
      tokens: estimateTokens(body),
      reason: 'Workspace overview'
    };
  }

  /** Tier 1 and 2: explicit attachments and selections. */
  async fromAttachments(items: ContextAttachment[]): Promise<ContextPiece[]> {
    const pieces: ContextPiece[] = [];

    for (const attachment of items) {
      try {
        switch (attachment.type) {
          case 'file': {
            if (!attachment.uri) {
              break;
            }
            const resolved = this.workspace.resolveUri(vscode.Uri.parse(attachment.uri));
            const result = await this.reader.read(resolved, {
              endLine: MAX_ATTACHMENT_LINES,
              reason: 'attached by the user',
              source: 'user-attachment'
            });
            const body = ContextCollector.codeBlock(
              result.relativePath,
              result.language,
              result.content,
              result.truncated ? `lines 1–${result.endLine} of ${result.totalLines}` : undefined
            );
            pieces.push({
              id: attachment.id,
              source: 'attachment',
              kind: 'file',
              label: result.relativePath,
              detail: result.truncated ? `first ${result.endLine} lines` : `${result.totalLines} lines`,
              uri: attachment.uri,
              body,
              tokens: estimateTokens(body),
              reason: 'Attached by you'
            });
            break;
          }

          case 'selection': {
            const snippet = this.attachments.pastedSnippet(attachment.id);
            if (snippet) {
              const body = ContextCollector.codeBlock(
                'pasted code',
                snippet.language ?? 'plaintext',
                snippet.text
              );
              pieces.push({
                id: attachment.id,
                source: 'selection',
                kind: 'selection',
                label: 'Pasted code',
                detail: `${snippet.text.split('\n').length} lines`,
                body,
                tokens: estimateTokens(body),
                reason: 'Pasted into the chat'
              });
              break;
            }
            if (!attachment.uri) {
              break;
            }
            const resolved = this.workspace.resolveUri(vscode.Uri.parse(attachment.uri));
            const result = await this.reader.read(resolved, {
              startLine: attachment.lineStart,
              endLine: attachment.lineEnd,
              reason: 'selected by the user',
              source: 'user-attachment'
            });
            const body = ContextCollector.codeBlock(
              result.relativePath,
              result.language,
              result.content,
              `lines ${result.startLine}–${result.endLine}`
            );
            pieces.push({
              id: attachment.id,
              source: 'selection',
              kind: 'selection',
              label: result.relativePath,
              detail: `lines ${result.startLine}–${result.endLine}`,
              uri: attachment.uri,
              body,
              tokens: estimateTokens(body),
              reason: 'Selected by you'
            });
            break;
          }

          case 'folder': {
            if (!attachment.uri) {
              break;
            }
            const resolved = this.workspace.resolveUri(vscode.Uri.parse(attachment.uri));
            const entries = await this.workspace.listDirectory(resolved);
            const listing = entries
              .map((e) => `${e.type === 'directory' ? '📁' : '  '} ${e.name}`)
              .join('\n');
            const body = `Folder ${resolved.relativePath}:\n${listing}\n\n(Contents not loaded. Use read_file on the files you need.)`;
            pieces.push({
              id: attachment.id,
              source: 'attachment',
              kind: 'folder',
              label: resolved.relativePath,
              detail: `${entries.length} entries`,
              uri: attachment.uri,
              body,
              tokens: estimateTokens(body),
              reason: 'Folder attached by you'
            });
            break;
          }

          case 'problems': {
            const piece = this.problems();
            if (piece) {
              pieces.push({ ...piece, id: attachment.id });
            }
            break;
          }

          case 'terminal':
            // Filled in by ContextManager, which owns the terminal reference.
            break;

          default:
            break;
        }
      } catch (error) {
        Logger.get().warn(`Could not load attachment ${attachment.relativePath}`, error);
        const body = `Attachment ${attachment.relativePath} could not be read: ${(error as Error).message}`;
        pieces.push({
          id: attachment.id,
          source: 'attachment',
          kind: 'file',
          label: attachment.relativePath ?? 'attachment',
          body,
          tokens: estimateTokens(body),
          reason: 'Attachment failed to load'
        });
      }
    }

    return pieces;
  }

  /** Tier 3: the file the user is looking at, as a light header plus the visible region. */
  async currentEditor(): Promise<ContextPiece | undefined> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== 'file') {
      return undefined;
    }

    try {
      const resolved = this.workspace.resolveUri(editor.document.uri);
      const visible = editor.visibleRanges[0];
      const start = visible ? Math.max(1, visible.start.line - 20) : 1;
      const end = visible ? Math.min(editor.document.lineCount, visible.end.line + 20) : 200;

      const result = await this.reader.read(resolved, {
        startLine: start,
        endLine: end,
        reason: 'file open in the editor',
        source: 'editor'
      });

      const header = `Open in the editor: ${result.relativePath} (${result.language}, ${result.totalLines} lines, cursor on line ${editor.selection.active.line + 1})`;
      const body = `${header}\n${ContextCollector.codeBlock(
        result.relativePath,
        result.language,
        result.content,
        `visible lines ${result.startLine}–${result.endLine}`
      )}`;

      return {
        id: randomUUID(),
        source: 'current-editor',
        kind: 'file',
        label: result.relativePath,
        detail: `visible lines ${result.startLine}–${result.endLine}`,
        uri: resolved.uri.toString(),
        body,
        tokens: estimateTokens(body),
        reason: 'Open in your editor'
      };
    } catch {
      return undefined;
    }
  }

    /** Adds language-server navigation context when the request names the symbol at the cursor. */
    async symbolContext(prompt: string): Promise<ContextPiece[]> {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.uri.scheme !== 'file' || !/\b(symbol|function|method|class|calls?|references?|definition)\b/i.test(prompt)) {
        return [];
      }

      const position = editor.selection.active;
      const range = editor.document.getWordRangeAtPosition(position);
      const symbol = range ? editor.document.getText(range) : '';
      if (!symbol || !new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(prompt)) {
        return [];
      }
      try {
        const [definitions, references] = await Promise.all([
          vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>('vscode.executeDefinitionProvider', editor.document.uri, position),
          vscode.commands.executeCommand<vscode.Location[]>('vscode.executeReferenceProvider', editor.document.uri, position, { includeDeclaration: false })
        ]);
        const roots = this.workspace.rootPaths();
        const formatLocation = (location: vscode.Location | vscode.LocationLink): string =>
          'targetUri' in location
            ? `${toRelative(roots, location.targetUri.fsPath)}:${location.targetRange.start.line + 1}`
            : `${toRelative(roots, location.uri.fsPath)}:${location.range.start.line + 1}`;
        const body = [
          `Language-server results for symbol "${symbol}" at ${toRelative(roots, editor.document.uri.fsPath)}:${position.line + 1}:`,
          definitions?.length ? `Definition: ${definitions.map(formatLocation).join(', ')}` : 'Definition: none found',
          references?.length ? `References (${references.length}): ${references.slice(0, 40).map(formatLocation).join(', ')}` : 'References: none found'
        ].join('\n');
        return [{
          id: randomUUID(),
          source: 'symbol',
          kind: 'workspace',
          label: `Language server: ${symbol}`,
          detail: `${definitions?.length ?? 0} definition(s), ${references?.length ?? 0} reference(s)`,
          uri: editor.document.uri.toString(),
          body,
          tokens: estimateTokens(body),
          reason: 'Specific symbol requested'
        }];
      } catch (error) {
        Logger.get().debug(`Language-server context unavailable for ${symbol}`, error);
        return [];
      }
    }

  async impactContext(relativePath: string): Promise<ContextPiece | undefined> {
    if (!this.graph) {
      return undefined;
    }
    try {
      const impact = await this.graph.impact(relativePath);
      const format = (entry: { path: string; symbols: string[] }): string =>
        `${entry.path}${entry.symbols.length ? ` [${entry.symbols.join(', ')}]` : ''}`;
      const body = [
        `Pre-edit dependency impact for ${impact.path} (best-effort static approximation):`,
        `Files this file imports (${impact.dependencies.length}): ${impact.dependencies.map(format).join(', ') || 'none'}`,
        `Files importing this file (${impact.dependents.length}): ${impact.dependents.map(format).join(', ') || 'none'}`
      ].join('\n');
      return {
        id: randomUUID(),
        source: 'symbol',
        kind: 'workspace',
        label: `Impact: ${impact.path}`,
        detail: `${impact.dependents.length} dependents, ${impact.dependencies.length} dependencies`,
        body,
        tokens: estimateTokens(body),
        reason: 'Pre-edit exported API impact'
      };
    } catch (error) {
      Logger.get().debug(`Could not build impact context for ${relativePath}`, error);
      return undefined;
    }
  }

  /** Tier 4: VS Code diagnostics. */
  problems(limit = 40): ContextPiece | undefined {
    const roots = this.workspace.rootPaths();
    const rows: string[] = [];
    let errors = 0;
    let warnings = 0;

    for (const [uri, diagnostics] of vscode.languages.getDiagnostics()) {
      for (const diagnostic of diagnostics) {
        if (diagnostic.severity === vscode.DiagnosticSeverity.Error) {
          errors++;
        } else if (diagnostic.severity === vscode.DiagnosticSeverity.Warning) {
          warnings++;
        } else {
          continue;
        }
        if (rows.length >= limit) {
          continue;
        }
        const code = typeof diagnostic.code === 'object' ? diagnostic.code.value : diagnostic.code;
        rows.push(
          `${vscode.DiagnosticSeverity[diagnostic.severity].toLowerCase()} ${code ?? ''} in ${toRelative(roots, uri.fsPath)}:${diagnostic.range.start.line + 1}:${diagnostic.range.start.character + 1} — ${diagnostic.message}`
        );
      }
    }

    if (rows.length === 0) {
      return undefined;
    }
    const body = `Problems panel (${errors} errors, ${warnings} warnings):\n${rows.join('\n')}`;
    return {
      id: randomUUID(),
      source: 'problems',
      kind: 'problems',
      label: `${errors} errors, ${warnings} warnings`,
      body,
      tokens: estimateTokens(body),
      reason: 'From the Problems panel'
    };
  }

  /**
   * Tier 5: repository search. Returns a match list plus the head of the most
   * relevant files, so the model can decide what to read in full rather than
   * having the whole repository pushed at it.
   */
  async fromSearch(intent: Intent, exclude: Set<string>): Promise<ContextPiece[]> {
    if (intent.searchTerms.length === 0) {
      return [];
    }

    const pieces: ContextPiece[] = [];
    const fileScores = new Map<string, number>();
    const previewRows: string[] = [];

    for (const term of intent.searchTerms.slice(0, 4)) {
      const result = await this.searcher.searchText({ query: term, maxResults: 30 });
      for (const match of result.matches) {
        fileScores.set(match.relativePath, (fileScores.get(match.relativePath) ?? 0) + 1);
        if (previewRows.length < 40) {
          previewRows.push(`${match.relativePath}:${match.line}  ${match.preview}`);
        }
      }
      const names = await this.searcher.findFiles(term, 10);
      for (const name of names) {
        fileScores.set(name, (fileScores.get(name) ?? 0) + 0.5);
      }
    }

    if (previewRows.length > 0) {
      const body = `Repository search for ${intent.searchTerms.map((t) => `"${t}"`).join(', ')}:\n${previewRows.join('\n')}`;
      pieces.push({
        id: randomUUID(),
        source: 'search',
        kind: 'workspace',
        label: `Search: ${intent.searchTerms.join(', ')}`,
        detail: `${previewRows.length} matches`,
        body,
        tokens: estimateTokens(body),
        reason: 'Matched your request'
      });
    }

    if (this.semanticSearch) {
      for (const term of intent.searchTerms.slice(0, 2)) {
        try {
          const semanticResults = await this.semanticSearch.search(term, 10);
          for (const res of semanticResults) {
            fileScores.set(res.uriPath, (fileScores.get(res.uriPath) ?? 0) + res.score * 10);
          }
        } catch (e) {
          // Ignore semantic search errors
        }
      }
    }

    const ranked = Array.from(fileScores)
      .filter(([path]) => !exclude.has(path))
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_SEARCH_FILES);

    for (const [relativePath, score] of ranked) {
      try {
        const resolved = this.workspace.resolve(relativePath);
        const result = await this.reader.read(resolved, {
          endLine: MAX_SEARCH_LINES,
          reason: 'matched the repository search',
          source: 'search'
        });
        const body = ContextCollector.codeBlock(
          result.relativePath,
          result.language,
          result.content,
          result.truncated ? `first ${result.endLine} of ${result.totalLines} lines` : undefined
        );
        pieces.push({
          id: randomUUID(),
          source: 'search',
          kind: 'file',
          label: result.relativePath,
          detail: result.truncated ? `first ${result.endLine} lines` : `${result.totalLines} lines`,
          uri: resolved.uri.toString(),
          body,
          tokens: estimateTokens(body),
          reason: `Matched ${intent.searchTerms[0] ?? 'your request'}`,
          score: Math.min(score / 4, 1)
        });
      } catch {
        // Unreadable candidate, skip it.
      }
    }

    return pieces;
  }

  private static codeBlock(path: string, language: string, content: string, note?: string): string {
    return `File: ${path}${note ? ` (${note})` : ''}\n\`\`\`${language}\n${content}\n\`\`\``;
  }
}
