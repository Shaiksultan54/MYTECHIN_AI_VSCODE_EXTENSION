import * as path from 'node:path';
import { SENSITIVE_PATTERNS } from '../../shared/constants/index.js';

export class PathSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathSecurityError';
  }
}

/**
 * Pure path logic, kept free of `vscode` so it can be unit tested directly.
 * Every filesystem operation in the extension resolves through these helpers
 * before touching disk — paths coming from the model are never trusted.
 */

/** Normalises for comparison: forward slashes, no trailing separator. */
export function normalize(p: string): string {
  const normalized = path.normalize(p).replace(/\\/g, '/');
  return normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized;
}

/** True when `child` is inside `root` (or is `root` itself). */
export function isInside(root: string, child: string): boolean {
  const relative = path.relative(normalize(root), normalize(child));
  if (relative === '') {
    return true;
  }
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * Resolves a possibly-relative path against a set of workspace roots.
 * Throws when the result escapes every root.
 */
export function resolveWithinRoots(roots: string[], candidate: string): string {
  if (roots.length === 0) {
    throw new PathSecurityError('No workspace folder is open, so files cannot be resolved.');
  }
  if (candidate.includes('\0')) {
    throw new PathSecurityError('Path contains an illegal character.');
  }

  const cleaned = candidate.trim().replace(/^["']|["']$/g, '');

  if (path.isAbsolute(cleaned) || /^[A-Za-z]:[\\/]/.test(cleaned)) {
    const absolute = path.resolve(cleaned);
    const root = roots.find((r) => isInside(r, absolute));
    if (!root) {
      throw new PathSecurityError(
        `"${candidate}" is outside the open workspace. Mytechin AI only touches files inside the workspace.`
      );
    }
    return normalize(absolute);
  }

  // Relative: try each root, first hit wins. Callers that need a specific root
  // pass a single-element array.
  for (const root of roots) {
    const absolute = path.resolve(root, cleaned);
    if (isInside(root, absolute)) {
      return normalize(absolute);
    }
  }

  throw new PathSecurityError(
    `"${candidate}" resolves outside the open workspace and was refused.`
  );
}

/** Workspace-relative path used in prompts and the UI. */
export function toRelative(roots: string[], absolute: string): string {
  for (const root of roots) {
    if (isInside(root, absolute)) {
      const relative = path.relative(normalize(root), normalize(absolute));
      return relative === '' ? path.basename(root) : relative.replace(/\\/g, '/');
    }
  }
  return normalize(absolute);
}

/** True for credential material that must never be indexed or auto-included. */
export function isSensitivePath(p: string): boolean {
  const normalized = normalize(p);
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(normalized));
}

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.tiff', '.avif',
  '.pdf', '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar', '.jar', '.war',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.obj', '.o', '.a', '.lib',
  '.pdb', '.class', '.pyc', '.pyo', '.wasm', '.node',
  '.mp3', '.mp4', '.wav', '.avi', '.mov', '.mkv', '.webm', '.flac',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.db', '.sqlite', '.sqlite3', '.mdb', '.bak', '.dat'
]);

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

export function isImage(p: string): boolean {
  return IMAGE_EXTENSIONS.has(path.extname(p).toLowerCase());
}

export function isLikelyBinary(p: string): boolean {
  return BINARY_EXTENSIONS.has(path.extname(p).toLowerCase());
}

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescriptreact', '.mts': 'typescript', '.cts': 'typescript',
  '.js': 'javascript', '.jsx': 'javascriptreact', '.mjs': 'javascript', '.cjs': 'javascript',
  '.cs': 'csharp', '.csproj': 'xml', '.sln': 'plaintext', '.razor': 'razor', '.cshtml': 'razor',
  '.py': 'python', '.pyi': 'python', '.java': 'java', '.kt': 'kotlin', '.kts': 'kotlin',
  '.go': 'go', '.rs': 'rust', '.php': 'php', '.rb': 'ruby', '.swift': 'swift',
  '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.cc': 'cpp', '.hpp': 'cpp', '.hh': 'cpp',
  '.sql': 'sql', '.html': 'html', '.htm': 'html', '.css': 'css', '.scss': 'scss',
  '.less': 'less', '.json': 'json', '.jsonc': 'jsonc', '.yaml': 'yaml', '.yml': 'yaml',
  '.xml': 'xml', '.md': 'markdown', '.mdx': 'markdown', '.sh': 'shellscript',
  '.bash': 'shellscript', '.zsh': 'shellscript', '.ps1': 'powershell', '.bat': 'bat',
  '.toml': 'toml', '.ini': 'ini', '.env': 'dotenv', '.vue': 'vue', '.svelte': 'svelte',
  '.dart': 'dart', '.ex': 'elixir', '.exs': 'elixir', '.scala': 'scala', '.r': 'r',
  '.lua': 'lua', '.pl': 'perl', '.graphql': 'graphql', '.gql': 'graphql', '.proto': 'proto',
  '.tf': 'terraform', '.dockerfile': 'dockerfile'
};

export function languageForPath(p: string): string {
  const base = path.basename(p).toLowerCase();
  if (base === 'dockerfile') {
    return 'dockerfile';
  }
  if (base === 'makefile') {
    return 'makefile';
  }
  return LANGUAGE_BY_EXTENSION[path.extname(p).toLowerCase()] ?? 'plaintext';
}
