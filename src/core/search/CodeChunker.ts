import * as vscode from 'vscode';
import { Logger } from '../../logging/Logger.js';

export interface CodeChunk {
  id: string; // e.g. "path/to/file.ts#ClassName.methodName"
  uri: vscode.Uri;
  text: string;
  startLine: number;
  endLine: number;
  type: 'class' | 'method' | 'function' | 'interface' | 'fallback';
}

export class CodeChunker {
  constructor(private readonly logger: Logger) {}

  /**
   * Chunks a file into meaningful semantic blocks.
   */
  async chunkFile(uri: vscode.Uri, content: string): Promise<CodeChunk[]> {
    const chunks: CodeChunk[] = [];
    
    try {
      const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
        'vscode.executeDocumentSymbolProvider',
        uri
      );

      if (symbols && symbols.length > 0) {
        this.processSymbols(uri, content.split('\n'), symbols, chunks);
      } else {
        // Fallback to line-based chunking
        this.fallbackChunk(uri, content, chunks);
      }
    } catch (e) {
      this.logger.warn('CodeChunker', `Failed to get symbols for ${uri.fsPath}. Falling back.`, e);
      this.fallbackChunk(uri, content, chunks);
    }

    return chunks;
  }

  private processSymbols(
    uri: vscode.Uri,
    lines: string[],
    symbols: vscode.DocumentSymbol[],
    chunks: CodeChunk[],
    parentName = ''
  ): void {
    for (const symbol of symbols) {
      const isContainer = symbol.kind === vscode.SymbolKind.Class || 
                          symbol.kind === vscode.SymbolKind.Interface || 
                          symbol.kind === vscode.SymbolKind.Module || 
                          symbol.kind === vscode.SymbolKind.Namespace;
      
      const isAction = symbol.kind === vscode.SymbolKind.Function || 
                       symbol.kind === vscode.SymbolKind.Method || 
                       symbol.kind === vscode.SymbolKind.Constructor;

      const fullName = parentName ? `${parentName}.${symbol.name}` : symbol.name;

      if (isAction || isContainer) {
        // Extract the code block
        const start = symbol.range.start.line;
        const end = Math.min(symbol.range.end.line, lines.length - 1);
        const blockLines = lines.slice(start, end + 1);
        
        let type: CodeChunk['type'] = 'fallback';
        if (symbol.kind === vscode.SymbolKind.Class) type = 'class';
        if (symbol.kind === vscode.SymbolKind.Interface) type = 'interface';
        if (symbol.kind === vscode.SymbolKind.Function || symbol.kind === vscode.SymbolKind.Method || symbol.kind === vscode.SymbolKind.Constructor) type = 'function';

        chunks.push({
          id: `${uri.fsPath}#${fullName}`,
          uri,
          text: blockLines.join('\n'),
          startLine: start,
          endLine: end,
          type
        });
      }

      if (symbol.children && symbol.children.length > 0) {
        this.processSymbols(uri, lines, symbol.children, chunks, fullName);
      }
    }
  }

  private fallbackChunk(uri: vscode.Uri, content: string, chunks: CodeChunk[]): void {
    // Simple 50-line overlapping chunker
    const lines = content.split('\n');
    const chunkSize = 50;
    const overlap = 10;
    
    for (let i = 0; i < lines.length; i += (chunkSize - overlap)) {
      const endLine = Math.min(i + chunkSize, lines.length);
      chunks.push({
        id: `${uri.fsPath}#L${i}-${endLine}`,
        uri,
        text: lines.slice(i, endLine).join('\n'),
        startLine: i,
        endLine: endLine - 1,
        type: 'fallback'
      });
      if (endLine >= lines.length) break;
    }
  }
}
