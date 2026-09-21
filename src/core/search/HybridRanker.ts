import type { VectorSearchResult } from './VectorStore.js';
import type { SearchMatch } from '../workspace/FileSearcher.js';

export interface HybridSearchResult {
  uriPath: string;
  startLine: number;
  endLine: number;
  text: string;
  score: number;
  sources: ('semantic' | 'keyword')[];
}

export class HybridRanker {
  /**
   * Reciprocal Rank Fusion (RRF) to merge semantic and keyword search results.
   */
  merge(
    semanticResults: VectorSearchResult[],
    keywordResults: SearchMatch[],
    k = 60
  ): HybridSearchResult[] {
    const scores = new Map<string, HybridSearchResult>();

    // Process semantic results
    semanticResults.forEach((res, rank) => {
      // Chunk ID is a good unique key since it has the file path and chunk identifier
      const id = res.id;
      const score = 1 / (k + rank + 1);
      
      scores.set(id, {
        uriPath: res.uriPath,
        startLine: res.startLine,
        endLine: res.endLine,
        text: res.text,
        score,
        sources: ['semantic']
      });
    });

    // Process keyword results
    keywordResults.forEach((res, rank) => {
      // Create a pseudo-ID for the keyword match
      const id = `${res.relativePath}#L${res.line}`;
      const score = 1 / (k + rank + 1);
      
      const existing = scores.get(id);
      if (existing) {
        existing.score += score;
        if (!existing.sources.includes('keyword')) {
          existing.sources.push('keyword');
        }
      } else {
        scores.set(id, {
          uriPath: res.relativePath,
          startLine: res.line,
          endLine: res.line,
          text: res.preview,
          score,
          sources: ['keyword']
        });
      }
    });

    const merged = Array.from(scores.values());
    merged.sort((a, b) => b.score - a.score);
    return merged;
  }
}
