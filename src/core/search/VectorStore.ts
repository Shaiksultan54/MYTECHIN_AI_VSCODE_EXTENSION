import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as crypto from 'node:crypto';
import { Logger } from '../logging/Logger.js';

export interface VectorDocument {
  id: string;
  uriPath: string;
  text: string;
  startLine: number;
  endLine: number;
  hash: string;
}

export interface VectorSearchResult extends VectorDocument {
  similarity: number;
}

interface ShardData {
  documents: VectorDocument[];
  vectors: Record<string, number[]>;
}

const MAX_CHUNKS_PER_SHARD = 500;

/**
 * Disk-backed vector index split into bounded JSON shards. Shards are keyed
 * from the source file path so a file update only rewrites its own shard.
 * This is still a lightweight approximate store, not a database or ANN index.
 */
export class VectorStore {
  private documents = new Map<string, VectorDocument>();
  private vectors = new Map<string, number[]>();
  private readonly shardDir: string;
  private readonly dirtyShards = new Set<string>();

  constructor(workspaceUri: vscode.Uri, private readonly logger: Logger) {
    this.shardDir = vscode.Uri.joinPath(workspaceUri, '.mytechin', 'index', 'vectors').fsPath;
  }

  async load(): Promise<void> {
    try {
      const entries = await fs.readdir(this.shardDir, { withFileTypes: true });
      const shards = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json'));
      await Promise.all(shards.map(async (entry) => this.loadShard(path.join(this.shardDir, entry.name))));
      this.logger.info(`VectorStore: Loaded ${this.documents.size} indexed chunks from ${shards.length} shards.`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        await this.migrateLegacy();
      } else {
        this.logger.warn('VectorStore: Failed to load shards', error);
      }
    }
  }

  async save(): Promise<void> {
    try {
      await fs.mkdir(this.shardDir, { recursive: true });
      const grouped = new Map<string, ShardData>();
      for (const [id, doc] of this.documents) {
        const shard = this.shardName(doc.uriPath);
        const data = grouped.get(shard) ?? { documents: [], vectors: {} };
        data.documents.push(doc);
        const vector = this.vectors.get(id);
        if (vector) data.vectors[id] = vector;
        grouped.set(shard, data);
      }
      const written = new Set<string>();
      for (const [shard, data] of grouped) {
        for (let offset = 0; offset < data.documents.length; offset += MAX_CHUNKS_PER_SHARD) {
          const documents = data.documents.slice(offset, offset + MAX_CHUNKS_PER_SHARD);
          const vectors: Record<string, number[]> = {};
          for (const doc of documents) {
            const vector = data.vectors[doc.id];
            if (vector) vectors[doc.id] = vector;
          }
          const name = `${shard.replace('.json', '')}-${offset / MAX_CHUNKS_PER_SHARD}.json`;
          written.add(name);
          await fs.writeFile(path.join(this.shardDir, name), JSON.stringify({ documents, vectors }), 'utf8');
        }
      }
      const existing = await fs.readdir(this.shardDir);
      await Promise.all(
        existing
          .filter((name) => name.endsWith('.json') && !written.has(name))
          .map((name) => fs.unlink(path.join(this.shardDir, name)).catch(() => undefined))
      );
      this.dirtyShards.clear();
    } catch (error) {
      this.logger.error('VectorStore: Failed to save shards', error);
    }
  }

  add(doc: VectorDocument, vector: number[]): void {
    this.documents.set(doc.id, doc);
    this.vectors.set(doc.id, vector);
    this.dirtyShards.add(this.shardName(doc.uriPath));
  }

  removeByUriPath(uriPath: string): void {
    for (const [id, doc] of this.documents) {
      if (doc.uriPath === uriPath) {
        this.documents.delete(id);
        this.vectors.delete(id);
        this.dirtyShards.add(this.shardName(uriPath));
      }
    }
  }

  getDocHash(id: string): string | undefined {
    return this.documents.get(id)?.hash;
  }

  search(queryVector: number[], topK = 10): VectorSearchResult[] {
    const results: VectorSearchResult[] = [];
    for (const [id, vector] of this.vectors) {
      const doc = this.documents.get(id);
      if (doc) results.push({ ...doc, similarity: this.cosineSimilarity(queryVector, vector) });
    }
    return results.sort((a, b) => b.similarity - a.similarity).slice(0, topK);
  }

  private async loadShard(filePath: string): Promise<void> {
    try {
      const parsed = JSON.parse(await fs.readFile(filePath, 'utf8')) as ShardData;
      for (const doc of parsed.documents ?? []) this.documents.set(doc.id, doc);
      for (const [id, vector] of Object.entries(parsed.vectors ?? {})) this.vectors.set(id, vector);
    } catch (error) {
      this.logger.warn(`VectorStore: Failed to load shard ${path.basename(filePath)}`, error);
    }
  }

  private async migrateLegacy(): Promise<void> {
    const legacyPath = path.join(path.dirname(this.shardDir), 'vectors.json');
    try {
      const parsed = JSON.parse(await fs.readFile(legacyPath, 'utf8')) as ShardData;
      for (const doc of parsed.documents ?? []) this.documents.set(doc.id, doc);
      for (const [id, vector] of Object.entries(parsed.vectors ?? {})) this.vectors.set(id, vector);
      await this.save();
      await fs.unlink(legacyPath).catch(() => undefined);
      this.logger.info('VectorStore: Migrated legacy monolithic index to shards.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn('VectorStore: Failed to migrate legacy index', error);
      }
    }
  }

  private shardName(uriPath: string): string {
    const base = crypto.createHash('sha256').update(uriPath).digest('hex').slice(0, 12);
    return `${base}.json`;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    const length = Math.min(a.length, b.length);
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return normA === 0 || normB === 0 ? 0 : dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
