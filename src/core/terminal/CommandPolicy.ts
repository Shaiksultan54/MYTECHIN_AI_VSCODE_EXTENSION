import { DESTRUCTIVE_COMMAND_PATTERNS } from '../../shared/schemas/tools.js';

export type CommandRiskLevel = 'allow' | 'ask' | 'block';
export type ActionCategory =
  | 'READ'
  | 'WRITE'
  | 'EXECUTE'
  | 'NETWORK'
  | 'GIT'
  | 'DATABASE'
  | 'SECRET'
  | 'MCP';

export interface CommandClassification {
  level: CommandRiskLevel;
  category: ActionCategory;
  reason: string;
  isDestructive: boolean;
  requiresApproval: boolean;
}

const HARD_BLOCKED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\b(rm|del|Remove-Item)\s+.*(-rf|-r\s+-f|\/s\s+\/q)\s+([\\\/]|\b[A-Za-z]:[\\\/]?$)/i, reason: 'Root/drive wipe attempt' },
  { pattern: /\bmkfs\b|\bdd\s+if=/i, reason: 'Disk overwrite command' },
  { pattern: /\bformat\s+[A-Za-z]:/i, reason: 'Disk format command' },
  { pattern: /\b(shutdown|reboot)\b/i, reason: 'System restart/shutdown command' },
  { pattern: /:\(\)\s*\{\s*:\|:&\s*\}/, reason: 'Fork bomb attempt' },
  { pattern: /\bcurl\b[^|]*\|\s*(ba)?sh/i, reason: 'Piping arbitrary web scripts directly into shell execution' },
  { pattern: /\bwget\b[^|]*\|\s*(ba)?sh/i, reason: 'Piping arbitrary web scripts directly into shell execution' },
  { pattern: /\bnpm\s+publish\b/i, reason: 'Publishing packages to public registries' }
];

const SAFE_READ_ONLY_PREFIXES = [
  'git status',
  'git diff',
  'git log',
  'git show',
  'git branch',
  'git remote',
  'npm test',
  'npm run test',
  'npx vitest',
  'npx vitest run',
  'dotnet test',
  'cargo test',
  'pytest',
  'go test',
  'node -v',
  'npm -v',
  'git --version',
  'dotnet --version',
  'python --version',
  'python3 --version',
  'cargo --version',
  'go version',
  'echo ',
  'dir',
  'ls',
  'pwd',
  'where ',
  'which '
];

export class CommandPolicy {
  /**
   * Classifies an arbitrary shell command into allow, ask, or block.
   */
  static classify(command: string): CommandClassification {
    const trimmed = command.trim();

    // 1. Check hard blocked patterns
    for (const { pattern, reason } of HARD_BLOCKED_PATTERNS) {
      if (pattern.test(trimmed)) {
        return {
          level: 'block',
          category: 'EXECUTE',
          reason: `Blocked by security policy: ${reason}`,
          isDestructive: true,
          requiresApproval: true
        };
      }
    }

    // 2. Check destructive patterns from schema
    for (const pattern of DESTRUCTIVE_COMMAND_PATTERNS) {
      if (pattern.test(trimmed)) {
        return {
          level: 'ask',
          category: 'EXECUTE',
          reason: 'This command matches a destructive command pattern and can alter or delete data.',
          isDestructive: true,
          requiresApproval: true
        };
      }
    }

    // 3. Check for Git operations
    if (/^\s*git\s+/i.test(trimmed)) {
      const isReadOnly =
        /^\s*git\s+(status|diff|log|branch|show|remote|rev-parse|tag)\b/i.test(trimmed) &&
        !/\b(-d|-D|--delete)\b/.test(trimmed);

      if (isReadOnly) {
        return {
          level: 'allow',
          category: 'GIT',
          reason: 'Read-only Git query.',
          isDestructive: false,
          requiresApproval: false
        };
      }

      return {
        level: 'ask',
        category: 'GIT',
        reason: 'Git mutating operation (commit, checkout, push, merge, reset).',
        isDestructive: false,
        requiresApproval: true
      };
    }

    // 4. Check for Database operations
    if (/\b(sqlcmd|psql|mysql|sqlite3|prisma\s+migrate|dotnet\s+ef\s+database)\b/i.test(trimmed)) {
      return {
        level: 'ask',
        category: 'DATABASE',
        reason: 'Database management or migration command.',
        isDestructive: false,
        requiresApproval: true
      };
    }

    // 5. Check for Network / package operations
    if (/^\s*(curl|wget|npm\s+install|npm\s+i|yarn\s+add|pnpm\s+add|pip\s+install|dotnet\s+add)\b/i.test(trimmed)) {
      return {
        level: 'ask',
        category: 'NETWORK',
        reason: 'Network download or dependency installation.',
        isDestructive: false,
        requiresApproval: true
      };
    }

    // 6. Check safe read-only commands (single commands or safe sequences)
    const lower = trimmed.toLowerCase();
    const isSafeRead = SAFE_READ_ONLY_PREFIXES.some(
      (prefix) => lower === prefix || lower.startsWith(prefix + ' ')
    );

    if (isSafeRead && !/[;&|>]/.test(trimmed)) {
      return {
        level: 'allow',
        category: 'READ',
        reason: 'Safe read-only command or test query.',
        isDestructive: false,
        requiresApproval: false
      };
    }

    // 7. Default to ask with EXECUTE
    return {
      level: 'ask',
      category: 'EXECUTE',
      reason: 'Standard workspace execution command.',
      isDestructive: false,
      requiresApproval: true
    };
  }
}
