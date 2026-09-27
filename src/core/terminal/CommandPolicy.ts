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
  { pattern: /\b(rm|del|Remove-Item)\s+.*(-rf|-r\s+-f|\/s\s+\/q)\s+([\\/]|\b[A-Za-z]:[\\/]?$)/i, reason: 'Root/drive wipe attempt' },
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

interface TokenizedCommand {
  tokens: string[];
  operators: string[];
  malformed: boolean;
}

function tokenize(command: string): TokenizedCommand {
  const tokens: string[] = [];
  const operators: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  let escaped = false;

  const flush = (): void => {
    if (current.length > 0) {
      tokens.push(current);
      current = '';
    }
  };

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\' && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      flush();
      continue;
    }
    if (';&|>'.includes(char)) {
      flush();
      const next = command[index + 1];
      const operator = (char === '&' && next === '&') || (char === '|' && next === '|')
        ? `${char}${next}`
        : char;
      operators.push(operator);
      if (operator.length === 2) index += 1;
      continue;
    }
    current += char;
  }
  if (escaped) current += '\\';
  flush();
  return { tokens, operators, malformed: quote !== undefined };
}

function blockedClassification(reason: string): CommandClassification {
  return {
    level: 'block',
    category: 'EXECUTE',
    reason: `Blocked by security policy: ${reason}`,
    isDestructive: true,
    requiresApproval: true
  };
}

export class CommandPolicy {
  /**
   * Classifies an arbitrary shell command into allow, ask, or block.
   * Dedicated Git tools do not call this classifier: their ToolRisk and
   * Git-aware previews are enforced by the tool registry and approval policy.
   */
  static classify(command: string): CommandClassification {
    const trimmed = command.trim();
    const parsed = tokenize(trimmed);

    if (parsed.malformed) {
      return blockedClassification('Unterminated shell quote.');
    }

    if (/\$\(|`/.test(trimmed)) {
      return blockedClassification('Unresolved command substitution is not permitted.');
    }

    if (/(?:base64|xxd)\b[^|]*(?:\||\|\|)\s*(?:ba)?sh\b/i.test(trimmed)) {
      return blockedClassification('Encoded payloads piped into a shell are not permitted.');
    }

    if (parsed.operators.length > 0 && parsed.tokens.length > 0) {
      return blockedClassification('Chained shell commands require explicit review and cannot use a read-only allowlist.');
    }

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
    const firstCommand = parsed.tokens.join(' ');
    if (parsed.tokens[0]?.toLowerCase() === 'git') {
      const isReadOnly =
        /^(status|diff|log|branch|show|remote|rev-parse|tag)$/i.test(parsed.tokens[1] ?? '') &&
        !parsed.tokens.some((token) => ['-d', '-D', '--delete'].includes(token));

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
    const lower = firstCommand.toLowerCase();
    const isSafeRead = SAFE_READ_ONLY_PREFIXES.some((prefix) => {
      const normalizedPrefix = prefix.trim().toLowerCase();
      return lower === normalizedPrefix || lower.startsWith(`${normalizedPrefix} `);
    });

    if (isSafeRead) {
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
