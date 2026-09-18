import { describe, expect, it } from 'vitest';
import {
  PathSecurityError,
  isInside,
  isLikelyBinary,
  isSensitivePath,
  languageForPath,
  resolveWithinRoots,
  toRelative
} from '../core/workspace/PathSecurity.js';

const ROOTS = ['/home/dev/project'];

describe('resolveWithinRoots', () => {
  it('resolves a relative path against the workspace root', () => {
    expect(resolveWithinRoots(ROOTS, 'src/app.ts')).toBe('/home/dev/project/src/app.ts');
  });

  it('accepts an absolute path that is already inside a root', () => {
    expect(resolveWithinRoots(ROOTS, '/home/dev/project/src/app.ts')).toBe(
      '/home/dev/project/src/app.ts'
    );
  });

  it('collapses traversal that stays inside the root', () => {
    expect(resolveWithinRoots(ROOTS, 'src/../src/app.ts')).toBe('/home/dev/project/src/app.ts');
  });

  it.each([
    '../secrets.txt',
    '../../etc/passwd',
    'src/../../outside.ts',
    '/etc/passwd',
    '/home/dev/other-project/app.ts'
  ])('refuses to escape the workspace with %s', (candidate) => {
    expect(() => resolveWithinRoots(ROOTS, candidate)).toThrow(PathSecurityError);
  });

  it('refuses a sibling directory that merely shares a prefix', () => {
    expect(() => resolveWithinRoots(ROOTS, '/home/dev/project-other/app.ts')).toThrow(
      PathSecurityError
    );
  });

  it('throws when there is no workspace at all', () => {
    expect(() => resolveWithinRoots([], 'src/app.ts')).toThrow(PathSecurityError);
  });

  it('searches every root in a multi-root workspace', () => {
    const roots = ['/home/dev/api', '/home/dev/web'];
    expect(resolveWithinRoots(roots, '/home/dev/web/src/main.ts')).toBe('/home/dev/web/src/main.ts');
  });
});

describe('isInside', () => {
  it('treats the root itself as inside', () => {
    expect(isInside('/a/b', '/a/b')).toBe(true);
  });

  it('does not match on a shared prefix', () => {
    expect(isInside('/a/b', '/a/bc')).toBe(false);
  });
});

describe('toRelative', () => {
  it('produces a forward-slash relative path', () => {
    expect(toRelative(ROOTS, '/home/dev/project/src/app.ts')).toBe('src/app.ts');
  });
});

describe('isSensitivePath', () => {
  it.each(['.env', 'config/.env.local', 'certs/server.pem', '.ssh/id_rsa', '.npmrc'])(
    'flags %s',
    (path) => {
      expect(isSensitivePath(path)).toBe(true);
    }
  );

  it.each(['src/environment.ts', 'README.md', 'src/keyboard.ts'])('allows %s', (path) => {
    expect(isSensitivePath(path)).toBe(false);
  });
});

describe('isLikelyBinary', () => {
  it.each(['logo.png', 'app.dll', 'archive.zip', 'font.woff2'])('flags %s', (path) => {
    expect(isLikelyBinary(path)).toBe(true);
  });

  it.each(['main.ts', 'Program.cs', 'query.sql'])('allows %s', (path) => {
    expect(isLikelyBinary(path)).toBe(false);
  });
});

describe('languageForPath', () => {
  it.each([
    ['Program.cs', 'csharp'],
    ['app.component.ts', 'typescript'],
    ['main.py', 'python'],
    ['Main.java', 'java'],
    ['main.go', 'go'],
    ['lib.rs', 'rust'],
    ['index.php', 'php'],
    ['schema.sql', 'sql']
  ])('maps %s to %s', (path, language) => {
    expect(languageForPath(path)).toBe(language);
  });
});
