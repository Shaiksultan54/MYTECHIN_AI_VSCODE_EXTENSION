import type { ApprovalMode, ToolRisk } from '../../shared/types.js';

export type ApprovalDecision = 'auto-approve' | 'ask';

/**
 * Pure policy, no I/O, so the rules are easy to test and to reason about.
 *
 * `askForRisky` is the default. It maps to the tool classification in the
 * product spec: read-only tools are Safe and run without a prompt, everything
 * that changes files or runs code needs an explicit yes. Nothing destructive
 * ever happens silently in any mode except `autonomous`, which is opt-in.
 */
export class ApprovalPolicy {
  constructor(
    private readonly mode: () => ApprovalMode,
    private readonly autoApproveSafeTools: () => boolean
  ) {}

  decide(risk: ToolRisk): ApprovalDecision {
    const mode = this.mode();

    if (mode === 'autonomous') {
      return 'auto-approve';
    }

    if (mode === 'alwaysAsk') {
      return 'ask';
    }

    if (risk === 'safe') {
      return this.autoApproveSafeTools() ? 'auto-approve' : 'ask';
    }

    if (mode === 'autoApproveSafe' && risk === 'ask') {
      return 'auto-approve';
    }

    // `strong` risk always asks outside autonomous mode.
    return 'ask';
  }

  /** True when the yes/no prompt should be styled as a serious warning. */
  isHighRisk(risk: ToolRisk): boolean {
    return risk === 'strong';
  }
}
