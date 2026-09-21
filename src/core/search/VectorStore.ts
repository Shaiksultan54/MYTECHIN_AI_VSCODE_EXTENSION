import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { Logger } from '../logging/Logger.js';

export interface VectorDocument {
  id: string;      // chunk id
  uriPath: string; // relative path
  text: string;
  startLine: number;
  endLine: number;
  hash: string;    // hash of the chunk text to avoid re-embedding
}

export interface VectorSearchResult extends VectorDocument {
  similarity: number;
}

export class VectorStore {
  private documents = new Map<string, VectorDocument>();
  private vectors = new Map<string, number[]>();
  private indexPath: string;

  constructor(
    workspaceUri: vscode.Uri,
    private readonly logger: Logger
  ) {
    this.indexPath = vscode.Uri.joinPath(workspaceUri, '.mytechin', 'index', 'vectors.json').fsPath;
  }

  async load(): Promise<void> {
    try {
      const data = await fs.readFile(this.indexPath, 'utf8');
      const parsed = JSON.parse(data) as {
        documents: VectorDocument[];
        vectors: Record<string, number[]>;
      };
      
      this.documents.clear();
      this.vectors.clear();
      
      for (const doc of parsed.documents) {
        this.documents.set(doc.id, doc);
      }
      for (const [id, vec] of Object.entries(parsed.vectors)) {
        this.vectors.set(id, vec);
      }
      this.logger.info(`VectorStore: Loaded ${this.documents.size} indexed chunks.`);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn('VectorStore: Failed to load index', e);
      }
    }
  }

  async save(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.indexPath), { recursive: true });
      const data = {
        documents: Array.from(this.documents.values()),
        vectors: Object.fromEntries(this.vectors.entries())
      };
      await fs.writeFile(this.indexPath, JSON.stringify(data), 'utf8');
    } catch (e) {
      this.logger.error('VectorStore: Failed to save index', e);
    }
  }

  add(doc: VectorDocument, vector: number[]): void {
    this.documents.set(doc.id, doc);
    this.vectors.set(doc.id, vector);
  }

  removeByUriPath(uriPath: string): void {
    const toDelete: string[] = [];
    for (const [id, doc] of this.documents.entries()) {
      if (doc.uriPath === uriPath) {
        toDelete.push(id);
      }
    }
    for (const id of toDelete) {
      this.documents.delete(id);
      this.vectors.delete(id);
    }
  }

  getDocHash(id: string): string | undefined {
    return this.documents.get(id)?.hash;
  }

  search(queryVector: number[], topK = 10): VectorSearchResult[] {
    const results: VectorSearchResult[] = [];
    
    for (const [id, vec] of this.vectors.entries()) {
      const similarity = this.cosineSimilarity(queryVector, vec);
      const doc = this.documents.get(id);
      if (doc) {
        results.push({ ...doc, similarity });
      }
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, topK);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
