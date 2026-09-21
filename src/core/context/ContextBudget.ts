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
 * Tiered context budgeting engine.
 * Reserves a safety margin for system instructions, tool outputs, and response generation.
 * Organizes context into priority tiers:
 * - Tier 0: Critical (Workspace map, explicit user attachments, active editor, project memory)
 * - Tier 1: High Relevance (LSP symbols, problems, explicit @mentions)
 * - Tier 2: Search & Retrieval (Keyword search, semantic search, documentation)
 *
 * Compacts lower-priority tiers first when tokens are constrained.
 */
export class ContextBudget {
  constructor(private readonly budget: number) {}

  fit(pieces: ContextPiece[]): BudgetResult {
    // Sort pieces by canonical source priority and relevance score
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

      // Compact/trim the piece to fit the remaining budget
      const notice = '\n… truncated to fit context budget …';
      const charBudget = Math.max(0, Math.floor(remaining * 3.6) - notice.length);
      if (charBudget < 80) {
        dropped.push(piece);
        continue;
      }

      const trimmed = `${piece.body.slice(0, charBudget)}${notice}`;
      const trimmedTokens = estimateTokens(trimmed);
      kept.push({ ...piece, body: trimmed, tokens: trimmedTokens });
      used += trimmedTokens;
    }

    return { kept, dropped, totalTokens: used };
  }
}
