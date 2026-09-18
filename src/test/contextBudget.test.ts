import { describe, expect, it } from 'vitest';
import { ContextBudget, estimateTokens } from '../core/context/ContextBudget.js';
import type { ContextPiece, ContextSource } from '../core/context/ContextTypes.js';

let counter = 0;

function piece(source: ContextSource, tokens: number, score = 0): ContextPiece {
  counter += 1;
  return {
    id: `p${counter}`,
    source,
    kind: 'file',
    label: `${source}-${counter}`,
    body: 'x'.repeat(Math.round(tokens * 3.6)),
    tokens,
    reason: 'test',
    score
  };
}

describe('estimateTokens', () => {
  it('returns zero for empty text', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('grows with length', () => {
    expect(estimateTokens('a'.repeat(360))).toBeGreaterThan(estimateTokens('a'.repeat(36)));
  });

  it('lands in a sane range for typical code', () => {
    const tokens = estimateTokens('export function add(a: number, b: number) { return a + b; }');
    expect(tokens).toBeGreaterThan(8);
    expect(tokens).toBeLessThan(40);
  });
});

describe('ContextBudget', () => {
  it('keeps everything when it fits', () => {
    const result = new ContextBudget(10_000).fit([piece('attachment', 100), piece('search', 200)]);
    expect(result.kept).toHaveLength(2);
    expect(result.dropped).toHaveLength(0);
    expect(result.totalTokens).toBe(300);
  });

  it('prefers attachments over search results when the budget is tight', () => {
    const attachment = piece('attachment', 900);
    const search = piece('search', 900);
    const result = new ContextBudget(1000).fit([search, attachment]);

    expect(result.kept.map((p) => p.source)).toContain('attachment');
    expect(result.dropped.map((p) => p.source)).toContain('search');
  });

  it('puts the workspace map first, since it is small and always useful', () => {
    const result = new ContextBudget(10_000).fit([
      piece('search', 50),
      piece('workspace-map', 50),
      piece('attachment', 50)
    ]);
    expect(result.kept[0].source).toBe('workspace-map');
  });

  it('ranks a selection above the current editor above a plain search hit', () => {
    const result = new ContextBudget(10_000).fit([
      piece('search', 10),
      piece('current-editor', 10),
      piece('selection', 10)
    ]);
    expect(result.kept.map((p) => p.source)).toEqual(['selection', 'current-editor', 'search']);
  });

  it('lets relevance score promote a piece within the same source', () => {
    const low = piece('search', 10, 0);
    const high = piece('search', 10, 2);
    const result = new ContextBudget(10_000).fit([low, high]);
    expect(result.kept[0].id).toBe(high.id);
  });

  it('trims an oversized piece instead of dropping it', () => {
    const huge = piece('attachment', 5000);
    const result = new ContextBudget(2000).fit([huge]);

    expect(result.kept).toHaveLength(1);
    expect(result.kept[0].tokens).toBeLessThanOrEqual(2000);
    expect(result.kept[0].body).toContain('truncated');
  });

  it('never exceeds the budget', () => {
    const pieces = Array.from({ length: 30 }, () => piece('search', 400));
    const result = new ContextBudget(3000).fit(pieces);
    expect(result.totalTokens).toBeLessThanOrEqual(3000);
    expect(result.kept.length + result.dropped.length).toBe(30);
  });

  it('drops a piece rather than leaving a useless sliver', () => {
    const result = new ContextBudget(300).fit([piece('attachment', 250), piece('search', 4000)]);
    expect(result.kept).toHaveLength(1);
    expect(result.dropped).toHaveLength(1);
  });

  it('handles an empty set', () => {
    const result = new ContextBudget(1000).fit([]);
    expect(result).toEqual({ kept: [], dropped: [], totalTokens: 0 });
  });
});
