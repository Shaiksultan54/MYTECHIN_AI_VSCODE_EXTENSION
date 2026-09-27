import * as vscode from 'vscode';
import { TOOL_RISK } from '../../../shared/schemas/tools.js';
import { toRelative } from '../../workspace/PathSecurity.js';
import {
  fail,
  ok,
  optionalBoolean,
  optionalNumber,
  requireString,
  type ToolDefinition
} from '../ToolTypes.js';

const SYMBOL_KIND_NAMES: Record<number, string> = {
  0: 'file',
  1: 'module',
  2: 'namespace',
  3: 'package',
  4: 'class',
  5: 'method',
  6: 'property',
  7: 'field',
  8: 'constructor',
  9: 'enum',
  10: 'interface',
  11: 'function',
  12: 'variable',
  13: 'constant',
  14: 'string',
  15: 'number',
  16: 'boolean',
  17: 'array',
  18: 'object',
  19: 'key',
  20: 'null',
  21: 'enum-member',
  22: 'struct',
  23: 'event',
  24: 'operator',
  25: 'type-parameter'
};

function formatKind(kind: number): string {
  return SYMBOL_KIND_NAMES[kind] ?? 'symbol';
}

interface FormattedSymbol {
  name: string;
  kind: string;
  detail?: string;
  startLine: number;
  endLine: number;
  children?: FormattedSymbol[];
}

function formatDocumentSymbol(sym: vscode.DocumentSymbol): FormattedSymbol {
  return {
    name: sym.name,
    kind: formatKind(sym.kind),
    detail: sym.detail || undefined,
    startLine: sym.range.start.line + 1,
    endLine: sym.range.end.line + 1,
    children: sym.children && sym.children.length > 0 ? sym.children.map(formatDocumentSymbol) : undefined
  };
}

export const getDocumentSymbolsTool: ToolDefinition = {
  name: 'get_document_symbols',
  risk: TOOL_RISK.get_document_symbols,
  description:
    'Extract all code symbols (classes, interfaces, methods, functions, properties) and their line ranges from a file using the Language Server.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative path to the file.' }
    },
    required: ['path']
  },
  title: (input) => `Get symbols in ${String(input.path ?? 'file')}`,
  async execute(input, ctx) {
    const path = requireString(input, 'path', 'get_document_symbols');
    const resolved = ctx.workspace.resolve(path);

    if (!(await ctx.workspace.exists(resolved))) {
      return fail('get_document_symbols', `${resolved.relativePath} does not exist.`);
    }

    try {
      // Ensure document is loaded so language server can analyze it
      await vscode.workspace.openTextDocument(resolved.uri);

      const symbols = await vscode.commands.executeCommand<
        (vscode.DocumentSymbol | vscode.SymbolInformation)[]
      >('vscode.executeDocumentSymbolProvider', resolved.uri);

      if (!symbols || symbols.length === 0) {
        return ok('get_document_symbols', `No language server available for this file type, or no symbols found in ${resolved.relativePath}.`, {
          path: resolved.relativePath,
          symbols: []
        });
      }

      // Check if DocumentSymbol (hierarchical) or SymbolInformation (flat)
      const isHierarchical = 'children' in symbols[0] || 'range' in symbols[0];
      let formatted: FormattedSymbol[];

      if (isHierarchical) {
        formatted = (symbols as vscode.DocumentSymbol[]).map(formatDocumentSymbol);
      } else {
        formatted = (symbols as vscode.SymbolInformation[]).map((s) => ({
          name: s.name,
          kind: formatKind(s.kind),
          detail: s.containerName || undefined,
          startLine: s.location.range.start.line + 1,
          endLine: s.location.range.end.line + 1
        }));
      }

      return ok(
        'get_document_symbols',
        `Found ${formatted.length} top-level symbols in ${resolved.relativePath}`,
        {
          path: resolved.relativePath,
          symbols: formatted
        }
      );
    } catch (error) {
      return fail(
        'get_document_symbols',
        `Language Server failed to get symbols: ${(error as Error)?.message ?? String(error)}`
      );
    }
  }
};

export const getWorkspaceSymbolsTool: ToolDefinition = {
  name: 'get_workspace_symbols',
  risk: TOOL_RISK.get_workspace_symbols,
  description:
    'Search for symbols (classes, methods, functions, interfaces) across the entire workspace by name.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Symbol name or partial name to search for.' }
    },
    required: ['query']
  },
  title: (input) => `Search symbols for "${String(input.query ?? '')}"`,
  async execute(input, ctx) {
    const query = requireString(input, 'query', 'get_workspace_symbols');
    const roots = ctx.workspace.rootPaths();

    try {
      const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
        'vscode.executeWorkspaceSymbolProvider',
        query
      );

      if (!symbols || symbols.length === 0) {
        return ok('get_workspace_symbols', `No language server available for this workspace, or no symbols matching "${query}".`, {
          query,
          symbols: []
        });
      }

      const results = symbols.slice(0, 50).map((s) => ({
        name: s.name,
        kind: formatKind(s.kind),
        container: s.containerName || undefined,
        path: toRelative(roots, s.location.uri.fsPath),
        startLine: s.location.range.start.line + 1,
        endLine: s.location.range.end.line + 1
      }));

      return ok(
        'get_workspace_symbols',
        `Found ${symbols.length} workspace symbols matching "${query}" (showing first ${results.length})`,
        {
          query,
          count: symbols.length,
          symbols: results
        }
      );
    } catch (error) {
      return fail(
        'get_workspace_symbols',
        `Failed to search workspace symbols: ${(error as Error)?.message ?? String(error)}`
      );
    }
  }
};

export const getDefinitionTool: ToolDefinition = {
  name: 'get_definition',
  risk: TOOL_RISK.get_definition,
  description:
    'Go to definition of a symbol at a specific file line and character position via the Language Server.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative file path.' },
      line: { type: 'number', description: '1-based line number.' },
      character: { type: 'number', description: '1-based character position.' }
    },
    required: ['path', 'line', 'character']
  },
  title: (input) =>
    `Go to definition at ${String(input.path)}:${input.line}:${input.character}`,
  async execute(input, ctx) {
    const path = requireString(input, 'path', 'get_definition');
    const line = optionalNumber(input, 'line') ?? 1;
    const character = optionalNumber(input, 'character') ?? 1;

    const resolved = ctx.workspace.resolve(path);
    if (!(await ctx.workspace.exists(resolved))) {
      return fail('get_definition', `${resolved.relativePath} does not exist.`);
    }

    try {
      await vscode.workspace.openTextDocument(resolved.uri);
      const position = new vscode.Position(Math.max(0, line - 1), Math.max(0, character - 1));

      const definitions = await vscode.commands.executeCommand<
        (vscode.Location | vscode.LocationLink)[]
      >('vscode.executeDefinitionProvider', resolved.uri, position);

      if (!definitions || definitions.length === 0) {
        return ok('get_definition', `No language server available for this file type, or no definition found at ${resolved.relativePath}:${line}:${character}.`, {
          definitions: []
        });
      }

      const roots = ctx.workspace.rootPaths();
      const results = definitions.map((def) => {
        if ('targetUri' in def) {
          return {
            path: toRelative(roots, def.targetUri.fsPath),
            startLine: def.targetRange.start.line + 1,
            endLine: def.targetRange.end.line + 1
          };
        }
        return {
          path: toRelative(roots, def.uri.fsPath),
          startLine: def.range.start.line + 1,
          endLine: def.range.end.line + 1
        };
      });

      return ok('get_definition', `Found ${results.length} definition location(s).`, {
        definitions: results
      });
    } catch (error) {
      return fail(
        'get_definition',
        `Failed to locate definition: ${(error as Error)?.message ?? String(error)}`
      );
    }
  }
};

export const getReferencesTool: ToolDefinition = {
  name: 'get_references',
  risk: TOOL_RISK.get_references,
  description:
    'Find all references to the symbol at a specific line and character position across the workspace.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative file path.' },
      line: { type: 'number', description: '1-based line number.' },
      character: { type: 'number', description: '1-based character position.' },
      includeDeclaration: {
        type: 'boolean',
        description: 'Whether to include the symbol declaration in the results (default false).'
      }
    },
    required: ['path', 'line', 'character']
  },
  title: (input) =>
    `Find references for symbol at ${String(input.path)}:${input.line}:${input.character}`,
  async execute(input, ctx) {
    const path = requireString(input, 'path', 'get_references');
    const line = optionalNumber(input, 'line') ?? 1;
    const character = optionalNumber(input, 'character') ?? 1;
    const includeDeclaration = optionalBoolean(input, 'includeDeclaration') ?? false;

    const resolved = ctx.workspace.resolve(path);
    if (!(await ctx.workspace.exists(resolved))) {
      return fail('get_references', `${resolved.relativePath} does not exist.`);
    }

    try {
      await vscode.workspace.openTextDocument(resolved.uri);
      const position = new vscode.Position(Math.max(0, line - 1), Math.max(0, character - 1));

      const references = await vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeReferenceProvider',
        resolved.uri,
        position,
        { includeDeclaration }
      );

      if (!references || references.length === 0) {
        return ok('get_references', `No language server available for this file type, or no references found for symbol at ${resolved.relativePath}:${line}:${character}.`, {
          references: []
        });
      }

      const roots = ctx.workspace.rootPaths();
      const results = references.slice(0, 100).map((ref) => ({
        path: toRelative(roots, ref.uri.fsPath),
        startLine: ref.range.start.line + 1,
        endLine: ref.range.end.line + 1
      }));

      return ok(
        'get_references',
        `Found ${references.length} reference(s) (showing first ${results.length})`,
        {
          count: references.length,
          references: results
        }
      );
    } catch (error) {
      return fail(
        'get_references',
        `Failed to find references: ${(error as Error)?.message ?? String(error)}`
      );
    }
  }
};

export const getHoverTool: ToolDefinition = {
  name: 'get_hover',
  risk: TOOL_RISK.get_hover,
  description:
    'Get hover information (type signatures, docstrings, parameters) for code at a line and character position.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace-relative file path.' },
      line: { type: 'number', description: '1-based line number.' },
      character: { type: 'number', description: '1-based character position.' }
    },
    required: ['path', 'line', 'character']
  },
  title: (input) => `Get hover at ${String(input.path)}:${input.line}:${input.character}`,
  async execute(input, ctx) {
    const path = requireString(input, 'path', 'get_hover');
    const line = optionalNumber(input, 'line') ?? 1;
    const character = optionalNumber(input, 'character') ?? 1;

    const resolved = ctx.workspace.resolve(path);
    if (!(await ctx.workspace.exists(resolved))) {
      return fail('get_hover', `${resolved.relativePath} does not exist.`);
    }

    try {
      await vscode.workspace.openTextDocument(resolved.uri);
      const position = new vscode.Position(Math.max(0, line - 1), Math.max(0, character - 1));

      const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
        'vscode.executeHoverProvider',
        resolved.uri,
        position
      );

      if (!hovers || hovers.length === 0) {
        return ok('get_hover', `No hover information available at ${resolved.relativePath}:${line}:${character}.`, {
          hover: ''
        });
      }

      const contents = hovers
        .flatMap((h) => h.contents)
        .map((c) => (typeof c === 'string' ? c : 'value' in c ? c.value : ''))
        .filter((s) => s.trim().length > 0)
        .join('\n\n');

      return ok('get_hover', `Hover info: ${contents.slice(0, 100)}...`, {
        hover: contents
      });
    } catch (error) {
      return fail(
        'get_hover',
        `Failed to retrieve hover info: ${(error as Error)?.message ?? String(error)}`
      );
    }
  }
};

function alias(tool: ToolDefinition, name: string, description: string): ToolDefinition {
  return {
    ...tool,
    name,
    description,
    execute: async (input, ctx) => ({ ...(await tool.execute(input, ctx)), toolName: name })
  };
}

/** New language-server tool names. The get_* exports remain for compatibility. */
export const findDefinitionTool = alias(
  getDefinitionTool,
  'find_definition',
  'Find the definition of a named symbol at a file position using VS Code language-server providers. Prefer this over search_code for a specific symbol.'
);
export const findReferencesTool = alias(
  getReferencesTool,
  'find_references',
  'Find call sites and references for a named symbol at a file position using VS Code language-server providers. Prefer this over search_code for a specific symbol.'
);
export const workspaceSymbolsTool = alias(
  getWorkspaceSymbolsTool,
  'workspace_symbols',
  'Search workspace symbols by name using VS Code language-server providers.'
);
export const documentSymbolsTool = alias(
  getDocumentSymbolsTool,
  'document_symbols',
  'List symbols in a document using the VS Code language server.'
);
