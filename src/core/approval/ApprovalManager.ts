import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import type { ApprovalRequestView, ToolRisk } from '../../shared/types.js';
import type { ApprovalPolicy } from './ApprovalPolicy.js';
import type { ApprovalPreview } from '../tools/ToolTypes.js';
import { Logger } from '../logging/Logger.js';

export interface ApprovalOutcome {
  approved: boolean;
  /** True when the policy allowed it without asking the user. */
  automatic: boolean;
  rememberForTask?: boolean;
}

interface Pending {
  resolve: (outcome: ApprovalOutcome) => void;
  toolName: string;
}

/**
 * Turns a tool call into a yes/no question for the user and waits for the
 * answer. Requests resolve as rejected when the task is cancelled, so the agent
 * loop can never hang on a prompt nobody will answer.
 */
export class ApprovalManager implements vscode.Disposable {
  private readonly pending = new Map<string, Pending>();
  /** Per-task remembered approvals, keyed by tool name. Cleared on new task. */
  private readonly remembered = new Set<string>();

  constructor(
    private readonly policy: ApprovalPolicy,
    private readonly present: (request: ApprovalRequestView) => void,
    private readonly resolved: (requestId: string, approved: boolean) => void
  ) {}

  resetTaskMemory(): void {
    this.remembered.clear();
  }

  async request(options: {
    toolName: string;
    risk: ToolRisk;
    preview: ApprovalPreview;
    token: vscode.CancellationToken;
  }): Promise<ApprovalOutcome> {
    const risk = options.preview.riskOverride ?? options.risk;

    if (this.remembered.has(options.toolName) && risk !== 'strong') {
      return { approved: true, automatic: true };
    }

    if (this.policy.decide(risk) === 'auto-approve') {
      return { approved: true, automatic: true };
    }

    const requestId = randomUUID();
    const view: ApprovalRequestView = {
      requestId,
      toolName: options.toolName,
      risk,
      title: options.preview.title,
      detail: options.preview.detail,
      diff: options.preview.diff,
      command: options.preview.command,
      cwd: options.preview.cwd,
      path: options.preview.path
    };

    Logger.get().debug(`Approval requested for ${options.toolName}`, { risk, requestId });

    return new Promise<ApprovalOutcome>((resolve) => {
      let settled = false;
      const settle = (outcome: ApprovalOutcome): void => {
        if (settled) {
          return;
        }
        settled = true;
        this.pending.delete(requestId);
        cancellation.dispose();
        this.resolved(requestId, outcome.approved);
        resolve(outcome);
      };

      const cancellation = options.token.onCancellationRequested(() =>
        settle({ approved: false, automatic: false })
      );

      this.pending.set(requestId, { resolve: settle, toolName: options.toolName });
      this.present(view);
    });
  }

  /** Called from the webview message handler. */
  resolve(requestId: string, approved: boolean, rememberForTask = false): void {
    const entry = this.pending.get(requestId);
    if (!entry) {
      return;
    }
    if (approved && rememberForTask) {
      this.remembered.add(entry.toolName);
    }
    entry.resolve({ approved, automatic: false, rememberForTask });
  }

  /** Rejects everything outstanding, used when a task is stopped. */
  rejectAll(): void {
    for (const [requestId] of this.pending) {
      this.resolve(requestId, false);
    }
  }

  dispose(): void {
    this.rejectAll();
  }
}
