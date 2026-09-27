import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { AtomicWriteError, FileWriter } from '../core/workspace/FileWriter.js';

const tempRoots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('FileWriter atomic writes', () => {
  async function setupFile(): Promise<{
    root: string;
    target: string;
    originalFs: typeof vscode.workspace.fs;
    workspace: ConstructorParameters<typeof FileWriter>[0];
    resolved: Parameters<FileWriter['write']>[0];
  }> {
    const root = await mkdtemp(path.join(os.tmpdir(), 'mytechin-file-writer-'));
    tempRoots.push(root);
    const target = path.join(root, 'config.json');
    await writeFile(target, 'before', 'utf8');
    const originalFs = vscode.workspace.fs;
    vi.spyOn(originalFs, 'readFile').mockImplementation(async (uri) => readFile(uri.fsPath));
    vi.spyOn(originalFs, 'stat').mockImplementation(async (uri) => {
      const stat = await import('node:fs/promises').then((fs) => fs.stat(uri.fsPath));
      return { size: stat.size, type: 1, ctime: stat.ctimeMs, mtime: stat.mtimeMs };
    });
    vi.spyOn(originalFs, 'delete').mockImplementation(async (uri) => {
      await rm(uri.fsPath, { force: true });
    });
    const workspace = {
      exists: async (resolvedPath: { uri: vscode.Uri }) => {
        try {
          await originalFs.stat(resolvedPath.uri);
          return true;
        } catch {
          return false;
        }
      }
    } as unknown as ConstructorParameters<typeof FileWriter>[0];
    const resolved = {
      fsPath: target,
      uri: vscode.Uri.file(target),
      relativePath: 'config.json'
    } as Parameters<FileWriter['write']>[0];
    return { root, target, originalFs, workspace, resolved };
  }

  it('leaves the destination untouched and removes the temp file when rename fails', async () => {
    const { root, target, originalFs, workspace, resolved } = await setupFile();
    vi.spyOn(originalFs, 'writeFile').mockImplementation(async (uri, bytes) => {
      await writeFile(uri.fsPath, bytes);
    });
    vi.spyOn(originalFs, 'rename').mockRejectedValue(new Error('simulated rename failure'));

    await expect(new FileWriter(workspace).write(resolved, 'after')).rejects.toMatchObject({
      name: 'AtomicWriteError',
      phase: 'rename'
    } satisfies Partial<AtomicWriteError>);
    await expect(readFile(target, 'utf8')).resolves.toBe('before');
    await expect(readdir(root)).resolves.toEqual(['config.json']);
  });

  it('leaves the destination untouched when the temp write fails after partial output', async () => {
    const { root, target, originalFs, workspace, resolved } = await setupFile();
    vi.spyOn(originalFs, 'writeFile').mockImplementation(async (uri) => {
      await writeFile(uri.fsPath, 'partial', 'utf8');
      throw new Error('simulated mid-write failure');
    });

    await expect(new FileWriter(workspace).write(resolved, 'after')).rejects.toMatchObject({
      name: 'AtomicWriteError',
      phase: 'write-temp'
    } satisfies Partial<AtomicWriteError>);
    await expect(readFile(target, 'utf8')).resolves.toBe('before');
    await expect(readdir(root)).resolves.toEqual(['config.json']);
  });
});
