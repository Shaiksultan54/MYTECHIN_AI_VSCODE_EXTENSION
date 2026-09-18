import type { ContextPiece } from './ContextTypes.js';
import { SOURCE_PRIORITY } from './ContextTypes.js';

/**
 * Rough token estimate. Deliberately cheap: a real tokenizer would differ per
 * model and per provider, and a 10–15% error is fine for a budget whose job is
 * to stop the prompt running away.
 */
export function estimateTokens(text: string): number {
  if (!text) {
    return 0;
  }
  // ~3.6 chars/token holds up reasonably across code and prose.
  return Math.ceil(text.length / 3.6);
}

export interface BudgetResult {
  kept: ContextPiece[];
  dropped: ContextPiece[];
  totalTokens: number;
}

/**
 * Fits context into the token budget. Pieces are sorted by source priority and
 * relevance, then taken until the budget runs out. A piece that is too big on
 * its own is trimmed rather than dropped, so an attached file always
 * contributes something.
 */
export class ContextBudget {
  constructor(private readonly budget: number) {}

  fit(pieces: ContextPiece[]): BudgetResult {
    const sorted = pieces.slice().sort((a, b) => {
      const aRank = SOURCE_PRIORITY[a.source] - (a.score ?? 0);
      const bRank = SOURCE_PRIORITY[b.source] - (b.score ?? 0);
      return aRank === bRank ? b.tokens - a.tokens : aRank - bRank;
    });

    const kept: ContextPiece[] = [];
    const dropped: ContextPiece[] = [];
    let used = 0;

    for (const piece of sorted) {
      const remaining = this.budget - used;
      if (remaining <= 64) {
        dropped.push(piece);
        continue;
      }
      if (piece.tokens <= remaining) {
        kept.push(piece);
        used += piece.tokens;
        continue;
      }

      // Trim to fit. Anything below a useful floor is dropped instead.
      if (remaining < 200) {
        dropped.push(piece);
        continue;
      }
      // The notice is part of the piece, so it has to come out of the same
      // allowance — otherwise trimming quietly overshoots the budget.
      const notice = '\n… truncated to fit the context budget …';
      const charBudget = Math.max(0, Math.floor(remaining * 3.6) - notice.length);
      const trimmed = `${piece.body.slice(0, charBudget)}${notice}`;
      const trimmedTokens = estimateTokens(trimmed);
      kept.push({ ...piece, body: trimmed, tokens: trimmedTokens });
      used += trimmedTokens;
    }

    return { kept, dropped, totalTokens: used };
  }
}
