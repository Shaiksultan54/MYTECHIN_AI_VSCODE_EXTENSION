import { describe, expect, it } from 'vitest';
import { Uri } from './vscode-stub.js';
import {
  findDefinitionTool,
  findReferencesTool,
  workspaceSymbolsTool,
  documentSymbolsTool
} from '../core/tools/handlers/lspTools.js';

const workspace = {
  resolve: (path: string) => ({ relativePath: path, uri: Uri.file(`D:/workspace/${path}`) }),
  exists: async () => true,
  rootPaths: () => ['D:/workspace']
};

const context = { workspace } as never;

describe('language-server tools', () => {
  it('exposes the requested tools as safe aliases', () => {
    expect(findDefinitionTool.name).toBe('find_definition');
    expect(findReferencesTool.name).toBe('find_references');
    expect(workspaceSymbolsTool.name).toBe('workspace_symbols');
    expect(documentSymbolsTool.name).toBe('document_symbols');
    expect(findDefinitionTool.risk).toBe('safe');
  });

  it('reports unavailable providers without throwing', async () => {
    const result = await findDefinitionTool.execute(
      { path: 'src/example.ts', line: 1, character: 1 },
      context
    );
    expect(result.success).toBe(true);
    expect(result.summary).toContain('No language server available');
  });
});
