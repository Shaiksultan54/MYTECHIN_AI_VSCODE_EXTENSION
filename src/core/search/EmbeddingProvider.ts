import { joinUrl, request } from '../providers/http.js';
import type { SettingsStore } from '../storage/SettingsStore.js';
import * as vscode from 'vscode';

export interface EmbeddingProvider {
  /** Returns the dimensions of the embedding vector. */
  getDimensions(): number;
  /** Embeds a batch of texts. */
  embed(texts: string[]): Promise<number[][]>;
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  private checkedModel: string | undefined;

  constructor(private readonly settings: SettingsStore) {}

  getDimensions(): number {
    return 768;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const config = this.settings.read();
    const endpoint = config.ollamaEndpoint || 'http://127.0.0.1:11434';
    const model = config.ollamaEmbeddingModel.trim() || 'nomic-embed-text';
    await this.ensureModel(endpoint, model);
    
    // We process sequentially or in small batches to not overload Ollama
    const results: number[][] = [];
    
    for (const text of texts) {
      const response = await request(joinUrl(endpoint, '/api/embeddings'), {
        method: 'POST',
        body: {
          model,
          prompt: text
        }
      });
      const data = await response.json() as { embedding: number[] };
      if (!data.embedding) {
        throw new Error('No embedding returned from Ollama');
      }
      results.push(data.embedding);
    }
    
    return results;
  }

  private async ensureModel(endpoint: string, model: string): Promise<void> {
    if (this.checkedModel === model) {
      return;
    }
    const response = await request(joinUrl(endpoint, '/api/tags'), { timeoutMs: 8000 });
    const data = (await response.json()) as { models?: { name?: string }[] };
    const installed = (data.models ?? []).some((entry) => entry.name === model || entry.name?.split(':')[0] === model);
    if (!installed) {
      const action = await vscode.window.showInformationMessage(
        `Ollama embedding model "${model}" is not installed.`,
        'Run ollama pull',
        'Copy command'
      );
      if (action === 'Run ollama pull') {
        const terminal = vscode.window.createTerminal({ name: 'Mytechin AI — Ollama embeddings' });
        terminal.show();
        terminal.sendText(`ollama pull ${model}`);
      } else if (action === 'Copy command') {
        await vscode.env.clipboard.writeText(`ollama pull ${model}`);
      }
      throw new Error(`Ollama embedding model "${model}" is not installed. Run "ollama pull ${model}" and retry.`);
    }
    this.checkedModel = model;
  }
}

/** Used for non-Ollama providers until an explicitly configured cloud embedder is supplied. */
export class UnavailableEmbeddingProvider implements EmbeddingProvider {
  getDimensions(): number {
    return 0;
  }

  async embed(_texts: string[]): Promise<number[][]> {
    throw new Error('Semantic embeddings are not configured for the active provider. Select Ollama or configure a cloud embedding provider explicitly.');
  }
}

export function createEmbeddingProvider(settings: SettingsStore): EmbeddingProvider {
  return settings.read().provider === 'ollama'
    ? new OllamaEmbeddingProvider(settings)
    : new UnavailableEmbeddingProvider();
}
