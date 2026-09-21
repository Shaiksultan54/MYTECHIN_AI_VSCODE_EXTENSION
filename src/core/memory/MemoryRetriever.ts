import type { ProjectMemoryService } from './ProjectMemoryService.js';
import type { MemoryEntry } from '../../shared/types.js';
import type { SemanticSearchService } from '../search/SemanticSearchService.js';

export class MemoryRetriever {
  constructor(
    private readonly memoryService: ProjectMemoryService,
    private readonly _semanticSearch?: SemanticSearchService
  ) {}

  /**
   * Given a user prompt, retrieves the most relevant memory entries.
   * Safety rules are always prioritized.
   */
  async retrieve(prompt: string, maxEntries = 15): Promise<MemoryEntry[]> {
    // @ts-ignore: used for future semantic search implementation
    void this._semanticSearch;
    const all = this.memoryService.getEntries();
    if (all.length === 0) return [];

    const rules = all.filter(e => e.category === 'rules');
    const others = all.filter(e => e.category !== 'rules');

    // For now, return all rules, and if we have space, a keyword-based sample of others.
    // If semantic search is fully hooked up to memory, we could embed memory entries.
    // But since memory is typically small (< 50 items), we can just do basic keyword scoring.
    
    const queryWords = prompt.toLowerCase().split(/\W+/).filter(w => w.length > 3);
    
    const scored = others.map(entry => {
      let score = 0;
      const text = entry.content.toLowerCase();
      for (const word of queryWords) {
        if (text.includes(word)) score += 1;
      }
      return { entry, score };
    });

    scored.sort((a, b) => b.score - a.score);
    
    // Take entries that match at least 1 keyword, or just take the first few if none match
    const relevantOthers = scored
      .filter(s => s.score > 0)
      .slice(0, maxEntries - rules.length)
      .map(s => s.entry);

    if (relevantOthers.length < maxEntries - rules.length) {
      const needed = maxEntries - rules.length - relevantOthers.length;
      const remaining = scored.filter(s => s.score === 0).slice(0, needed).map(s => s.entry);
      relevantOthers.push(...remaining);
    }

    return [...rules, ...relevantOthers];
  }
}
