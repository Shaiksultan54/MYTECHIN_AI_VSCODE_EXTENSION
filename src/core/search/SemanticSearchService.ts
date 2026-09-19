import * as vscode from 'vscode';
import * as crypto from 'node:crypto';
import { Logger } from '../../logging/Logger.js';
import { VectorStore } from './VectorStore.js';
import { CodeChunker } from './CodeChunker.js';
import type { EmbeddingProvider } from './EmbeddingProvider.js';
import { HybridRanker, type HybridSearchResult } from './HybridRanker.js';
import type { FileSearcher } from '../workspace/FileSearcher.js';
import type { WorkspaceManager } from '../workspace/WorkspaceManager.js';
import type { FileReader } from '../workspace/FileReader.js';

export class SemanticSearchService implements vscode.Disposable {
  private store: VectorStore;
  private chunker: CodeChunker;
  private ranker = new HybridRanker();
  private isIndexing = false;
  private disposables: vscode.Disposable[] = [];
  private watcher: vscode.FileSystemWatcher | undefined;

  constructor(
    private readonly workspace: WorkspaceManager,
    private readonly reader: FileReader,
    private readonly searcher: FileSearcher,
    private readonly embedder: EmbeddingProvider,
    private readonly logger: Logger
  ) {
    this.store = new VectorStore(vscode.Uri.parse(workspace.workspaceId), logger);
    this.chunker = new CodeChunker(logger);
    
    // Background initialization
    void this.store.load().then(() => {
      this.setupWatcher();
    });
  }

  private setupWatcher() {
    this.watcher = vscode.workspace.createFileSystemWatcher('**/*.*');
    this.disposables.push(this.watcher);

    this.watcher.onDidChange(uri => void this.indexFile(uri));
    this.watcher.onDidCreate(uri => void this.indexFile(uri));
    this.watcher.onDidDelete(uri => void this.removeFile(uri));
  }

  /**
   * Search orchestrator: queries semantic index and keyword search, merges results.
   */
  async search(query: string, limit = 10): Promise<HybridSearchResult[]> {
    if (!query.trim()) return [];

    let semanticResults: import('./VectorStore.js').VectorSearchResult[] = [];
    try {
      const queryVector = (await this.embedder.embed([query]))[0];
      semanticResults = this.store.search(queryVector, limit);
    } catch (e) {
      this.logger.warn('SemanticSearchService', 'Embedding query failed', e);
    }

    const keywordResults = await this.searcher.search(query, { maxResults: limit });
    
    return this.ranker.merge(semanticResults, keywordResults);
  }

  /**
   * Index a single file. Updates existing chunks if file changed.
   */
  async indexFile(uri: vscode.Uri): Promise<void> {
    try {
      const content = await this.reader.readText(uri);
      if (!content) return;

      const uriPath = vscode.workspace.asRelativePath(uri, false);
      const chunks = await this.chunker.chunkFile(uri, content);
      
      const toEmbed: { chunk: import('./CodeChunker.js').CodeChunk; hash: string }[] = [];
      
      for (const chunk of chunks) {
        const hash = crypto.createHash('sha256').update(chunk.text).digest('hex');
        const existingHash = this.store.getDocHash(chunk.id);
        
        if (hash !== existingHash) {
          toEmbed.push({ chunk, hash });
        }
      }

      if (toEmbed.length > 0) {
        const texts = toEmbed.map(t => t.chunk.text);
        const vectors = await this.embedder.embed(texts);
        
        for (let i = 0; i < toEmbed.length; i++) {
          this.store.add({
            id: toEmbed[i].chunk.id,
            uriPath,
            text: toEmbed[i].chunk.text,
            startLine: toEmbed[i].chunk.startLine,
            endLine: toEmbed[i].chunk.endLine,
            hash: toEmbed[i].hash
          }, vectors[i]);
        }
        await this.store.save();
      }
    } catch (e) {
      this.logger.error('SemanticSearchService', `Failed to index ${uri.fsPath}`, e);
    }
  }

  /**
   * Remove a file from the index.
   */
  async removeFile(uri: vscode.Uri): Promise<void> {
    const uriPath = vscode.workspace.asRelativePath(uri, false);
    this.store.removeByUriPath(uriPath);
    await this.store.save();
  }

  /**
   * Full workspace indexing. Runs in background.
   */
  async indexWorkspace(): Promise<void> {
    if (this.isIndexing) return;
    this.isIndexing = true;
    
    try {
      this.logger.info('SemanticSearchService', 'Starting full workspace index...');
      const uris = await vscode.workspace.findFiles('**/*.*', '**/node_modules/**');
      
      // Index in small batches to prevent blocking UI
      for (let i = 0; i < uris.length; i += 5) {
        const batch = uris.slice(i, i + 5);
        await Promise.all(batch.map(uri => this.indexFile(uri)));
        // Yield to event loop
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      this.logger.info('SemanticSearchService', 'Finished workspace index.');
    } finally {
      this.isIndexing = false;
    }
  }

  dispose() {
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
