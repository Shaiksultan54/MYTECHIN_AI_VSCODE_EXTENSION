import { joinUrl, request } from '../providers/http.js';
import type { SettingsStore } from '../storage/SettingsStore.js';

export interface EmbeddingProvider {
  /** Returns the dimensions of the embedding vector. */
  getDimensions(): number;
  /** Embeds a batch of texts. */
  embed(texts: string[]): Promise<number[][]>;
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly settings: SettingsStore) {}

  getDimensions(): number {
    return 768; // Nomic Embed Text default
  }

  async embed(texts: string[]): Promise<number[][]> {
    const endpoint = this.settings.read().ollamaEndpoint || 'http://127.0.0.1:11434';
    
    // We process sequentially or in small batches to not overload Ollama
    const results: number[][] = [];
    
    for (const text of texts) {
      const response = await request(joinUrl(endpoint, '/api/embeddings'), {
        method: 'POST',
        body: {
          model: 'nomic-embed-text', // Assumes this model is pulled
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
}
