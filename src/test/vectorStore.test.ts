import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { VectorStore } from '../core/search/VectorStore.js';

const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
} as never;

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('VectorStore', () => {
  it('persists vectors in bounded shard files and reloads them', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mytechin-vector-store-'));
    tempDirs.push(directory);
    const store = new VectorStore(vscode.Uri.file(directory), logger);

    store.add(
      { id: 'chunk-1', uriPath: 'src/app.ts', text: 'greet()', startLine: 1, endLine: 1, hash: 'hash' },
      [1, 0]
    );
    await store.save();

    const shardDirectory = path.join(directory, '.mytechin', 'index', 'vectors');
    const shards = (await fs.readdir(shardDirectory)).filter((name) => name.endsWith('.json'));
    expect(shards).toHaveLength(1);

    const reloaded = new VectorStore(vscode.Uri.file(directory), logger);
    await reloaded.load();
    expect(reloaded.getDocHash('chunk-1')).toBe('hash');
    expect(reloaded.search([1, 0], 1)[0]?.id).toBe('chunk-1');
  });
});
