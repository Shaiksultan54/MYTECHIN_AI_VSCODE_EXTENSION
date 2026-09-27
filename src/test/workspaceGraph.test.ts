import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { WorkspaceGraph } from '../core/workspace/WorkspaceGraph.js';

const files = new Map<string, string>([
  ['D:/workspace/src/lib.ts', 'export function greet() { return "hi"; }'],
  ['D:/workspace/src/app.ts', 'import { greet } from "./lib"; greet();']
]);

const workspace = {
  workspaceId: 'workspace',
  rootPaths: () => ['D:/workspace'],
  ignoreRules: { excludeGlob: () => undefined },
  resolve: (value: string) => ({
    relativePath: value.replace(/\\/g, '/'),
    uri: vscode.Uri.file(`D:/workspace/${value}`)
  })
} as never;

beforeEach(() => {
  files.clear();
  files.set('D:/workspace/src/lib.ts', 'export function greet() { return "hi"; }');
  files.set('D:/workspace/src/app.ts', 'import { greet } from "./lib"; greet();');
  vi.spyOn(vscode.workspace, 'findFiles').mockResolvedValue(
    Array.from(files.keys()).map((file) => vscode.Uri.file(file))
  );
  vi.spyOn(vscode.workspace.fs, 'readFile').mockImplementation(async (uri) => {
    const content = files.get(uri.fsPath);
    if (content === undefined) {
      throw new Error('missing file');
    }
    return Buffer.from(content);
  });
});

describe('WorkspaceGraph', () => {
  it('reports dependencies, dependents, and imported symbols', async () => {
    const graph = new WorkspaceGraph(workspace);
    const impact = await graph.impact('src/lib.ts');

    expect(impact.dependencies).toEqual([]);
    expect(impact.dependents).toEqual([{ path: 'src/app.ts', symbols: ['greet'] }]);
    expect(impact.approximate).toBe(true);
  });

  it('updates only the changed file after a save', async () => {
    const graph = new WorkspaceGraph(workspace);
    await graph.impact('src/lib.ts');
    files.set('D:/workspace/src/app.ts', 'import { other } from "./lib"; other();');

    await graph.update(vscode.Uri.file('D:/workspace/src/app.ts'));
    const impact = await graph.impact('src/lib.ts');

    expect(impact.dependents[0]?.symbols).toEqual(['other']);
  });
});
