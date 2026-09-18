import { describe, expect, it } from 'vitest';
import { IgnoreRules } from '../core/workspace/IgnoreRules.js';
import { DEFAULT_EXCLUDES } from '../shared/constants/index.js';

function rules(): IgnoreRules {
  return new IgnoreRules(() => ['/home/dev/project']);
}

describe('IgnoreRules.excludeGlob', () => {
  it('produces a single brace group VS Code findFiles accepts', () => {
    const glob = rules().excludeGlob();
    expect(glob.startsWith('{')).toBe(true);
    expect(glob.endsWith('}')).toBe(true);
  });

  it('always excludes the heavy directories', () => {
    const glob = rules().excludeGlob();
    for (const pattern of ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/bin/**']) {
      expect(glob).toContain(pattern);
    }
  });

  it('covers the .NET and Python build output the spec calls out', () => {
    const glob = rules().excludeGlob();
    expect(glob).toContain('**/obj/**');
    expect(glob).toContain('**/__pycache__/**');
  });

  it('includes user patterns once they are set', () => {
    const instance = rules();
    instance.setExtraPatterns(['**/fixtures/**']);
    expect(instance.excludeGlob()).toContain('**/fixtures/**');
  });

  it('drops user patterns again when the setting is cleared', () => {
    const instance = rules();
    instance.setExtraPatterns(['**/fixtures/**']);
    instance.setExtraPatterns([]);
    expect(instance.excludeGlob()).not.toContain('**/fixtures/**');
  });

  it('ignores blank entries in the user setting', () => {
    const instance = rules();
    instance.setExtraPatterns(['', '   ']);
    expect(instance.excludeGlob()).not.toContain('{,');
  });
});

describe('DEFAULT_EXCLUDES', () => {
  it('has no duplicates', () => {
    expect(new Set(DEFAULT_EXCLUDES).size).toBe(DEFAULT_EXCLUDES.length);
  });

  it('never excludes source directories', () => {
    for (const pattern of DEFAULT_EXCLUDES) {
      expect(pattern).not.toMatch(/\*\*\/(src|lib|app|tests?)\/\*\*/);
    }
  });
});
