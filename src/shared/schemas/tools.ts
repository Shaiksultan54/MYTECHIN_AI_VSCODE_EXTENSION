import type { ToolRisk } from '../types.js';

export const TOOL_NAMES = [
  'read_file',
  'read_files',
  'search_code',
  'list_directory',
  'get_file_metadata',
  'get_current_file',
  'get_selection',
  'get_problems',
  'get_terminal_output',
  'write_file',
  'create_file',
  'delete_file',
  'apply_patch',
  'open_file',
  'open_diff',
  'run_command',
  'ask_user'
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

/**
 * Risk classification. `safe` tools never change the workspace, `ask` tools
 * change files, `strong` tools destroy data or execute arbitrary code.
 */
export const TOOL_RISK: Record<ToolName, ToolRisk> = {
  read_file: 'safe',
  read_files: 'safe',
  search_code: 'safe',
  list_directory: 'safe',
  get_file_metadata: 'safe',
  get_current_file: 'safe',
  get_selection: 'safe',
  get_problems: 'safe',
  get_terminal_output: 'safe',
  open_file: 'safe',
  open_diff: 'safe',
  ask_user: 'safe',
  write_file: 'ask',
  create_file: 'ask',
  apply_patch: 'ask',
  run_command: 'strong',
  delete_file: 'strong'
};

/** Command fragments that always require explicit approval, whatever the mode. */
export const DESTRUCTIVE_COMMAND_PATTERNS: RegExp[] = [
  /\brm\s+(-[a-z]*\s+)*-?[rf]/i,
  /\brmdir\b/i,
  /\bdel\s+\/[sq]/i,
  /Remove-Item/i,
  /\bgit\s+reset\s+--hard/i,
  /\bgit\s+clean\s+-[a-z]*d/i,
  /\bgit\s+checkout\s+--\s/i,
  /\bgit\s+push\s+.*--force/i,
  /\bdrop\s+(database|table)\b/i,
  /\btruncate\s+table\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\bshutdown\b|\breboot\b/i,
  /\bchmod\s+-R\s+777/i,
  /\bcurl\b[^|]*\|\s*(ba)?sh/i,
  /\bwget\b[^|]*\|\s*(ba)?sh/i,
  /\bnpm\s+publish\b/i,
  /:\(\)\s*\{\s*:\|:&\s*\}/
];
