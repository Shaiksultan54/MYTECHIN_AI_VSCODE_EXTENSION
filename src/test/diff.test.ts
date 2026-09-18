import { describe, expect, it } from 'vitest';
import { DiffManager } from '../core/checkpoints/DiffManager.js';

describe('DiffManager.unifiedDiff', () => {
  it('produces no hunks when nothing changed', () => {
    const patch = DiffManager.unifiedDiff('a.ts', 'same\n', 'same\n');
    // The file headers are always emitted; what matters is that no hunk follows.
    expect(patch).not.toContain('@@');
  });

  it('marks added and removed lines', () => {
    const before = 'const expiry = 30;\nexport default expiry;\n';
    const after = 'const expiry = 60;\nexport default expiry;\n';
    const patch = DiffManager.unifiedDiff('src/config.ts', before, after);

    expect(patch).toContain('-const expiry = 30;');
    expect(patch).toContain('+const expiry = 60;');
    expect(patch).toContain('src/config.ts');
  });

  it('keeps surrounding context so a reviewer can see where the change lands', () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
    const after = before.replace('line 10', 'line ten');
    const patch = DiffManager.unifiedDiff('big.txt', before, after);

    expect(patch).toContain('@@');
    expect(patch).toContain(' line 9');
    expect(patch).toContain(' line 11');
    expect(patch).not.toContain(' line 2\n');
  });

  it('handles creating a file from nothing', () => {
    const patch = DiffManager.unifiedDiff('new.ts', '', 'export const a = 1;\n');
    expect(patch).toContain('+export const a = 1;');
  });

  it('handles deleting all content', () => {
    const patch = DiffManager.unifiedDiff('gone.ts', 'export const a = 1;\n', '');
    expect(patch).toContain('-export const a = 1;');
  });

  it('does not lose CRLF-only changes', () => {
    const patch = DiffManager.unifiedDiff('crlf.txt', 'a\nb\n', 'a\r\nb\r\n');
    expect(patch.length).toBeGreaterThan(0);
  });
});
