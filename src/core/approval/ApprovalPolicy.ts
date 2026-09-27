import type { ApprovalMode, ToolRisk } from '../../shared/types.js';

export type ApprovalDecision = 'auto-approve' | 'ask';

export type ActionCategory =
  | 'READ'
  | 'WRITE'
  | 'EXECUTE'
  | 'NETWORK'
  | 'GIT'
  | 'DATABASE'
  | 'SECRET'
  | 'MCP';

/**
 * Pure policy, no I/O, so the rules are easy to test and to reason about.
 * Maps tools and operations to granular risk categories (READ, WRITE, EXECUTE, etc.)
 *
 * `askForRisky` is the default: read-only tools run without a prompt,
 * mutating tools need approval, and destructive commands are flagged with strong warnings.
 */
export class ApprovalPolicy {
  constructor(
    private readonly mode: () => ApprovalMode,
    private readonly autoApproveSafeTools: () => boolean
  ) {}

  /** Maps any registered tool name to its canonical action category. */
  categoryForTool(toolName: string): ActionCategory {
    if (toolName.startsWith('mcp_')) {
      return 'MCP';
    }

    switch (toolName) {
      case 'read_file':
      case 'read_files':
      case 'search_code':
      case 'list_directory':
      case 'get_file_metadata':
      case 'get_current_file':
      case 'get_selection':
      case 'get_problems':
      case 'get_terminal_output':
      case 'get_document_symbols':
      case 'get_workspace_symbols':
      case 'get_definition':
      case 'get_references':
      case 'get_hover':
      case 'find_definition':
      case 'find_references':
      case 'workspace_symbols':
      case 'document_symbols':
      case 'get_impact':
      case 'git_status':
      case 'git_diff':
      case 'git_log':
      case 'open_file':
      case 'open_diff':
      case 'ask_user':
        return 'READ';

      case 'write_file':
      case 'create_file':
      case 'apply_patch':
      case 'multi_apply_patch':
      case 'delete_file':
      case 'git_commit':
      case 'git_branch':
        return 'WRITE';

      case 'run_command':
        return 'EXECUTE';

      case 'web_search':
      case 'browse_page':
      case 'extract_content':
        return 'NETWORK';

      default:
        return 'EXECUTE';
    }
  }

  decide(risk: ToolRisk, category?: ActionCategory): ApprovalDecision {
    const mode = this.mode();

    if (mode === 'autonomous') {
      return 'auto-approve';
    }

    if (mode === 'alwaysAsk') {
      return 'ask';
    }

    // Secret access or high risk always requires explicit user confirmation
    if (category === 'SECRET' || risk === 'strong') {
      return 'ask';
    }

    if (risk === 'safe' || category === 'READ') {
      return this.autoApproveSafeTools() ? 'auto-approve' : 'ask';
    }

    if (mode === 'autoApproveSafe' && risk === 'ask') {
      return 'auto-approve';
    }

    return 'ask';
  }

  /** True when the yes/no prompt should be styled as a serious warning. */
  isHighRisk(risk: ToolRisk): boolean {
    return risk === 'strong';
  }
}
