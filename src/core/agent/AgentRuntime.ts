import * as vscode from 'vscode';
import type { AgentPhase } from '../../shared/types.js';
import type { AIProvider } from '../providers/AIProvider.js';
import type { ToolExecutor } from '../tools/ToolExecutor.js';
import type { ToolRegistry } from '../tools/ToolRegistry.js';
import type { ConversationManager } from '../conversation/ConversationManager.js';
import type { ContextManager } from '../context/ContextManager.js';
import type { AttachmentManager } from '../context/AttachmentManager.js';
import type { VisionAdapter } from '../vision/VisionAdapter.js';
import type { SettingsStore } from '../storage/SettingsStore.js';
import type { CheckpointManager } from '../checkpoints/CheckpointManager.js';
import type { ApprovalManager } from '../approval/ApprovalManager.js';
import { Logger } from '../logging/Logger.js';
import type { AgentEventSink } from './AgentEvents.js';
import { AgentOrchestrator } from './AgentOrchestrator.js';
import { AgentState } from './AgentState.js';
import { VerificationLoop } from './VerificationLoop.js';

export interface AgentRuntimeDeps {
  provider: () => Promise<AIProvider>;
  registry: ToolRegistry;
  executor: ToolExecutor;
  workspace: import('../workspace/WorkspaceManager.js').WorkspaceManager;
  conversations: ConversationManager;
  context: ContextManager;
  attachments: AttachmentManager;
  vision: VisionAdapter;
  memory: import('../memory/MemoryRetriever.js').MemoryRetriever;
  settings: SettingsStore;
  checkpoints: CheckpointManager;
  approvals: ApprovalManager;
  events: AgentEventSink;
  onRunningChanged?: (running: boolean) => void;
}

/**
 * The public face of the agent. It owns task lifecycle — start, phase, stop —
 * and delegates the actual reasoning cycle to AgentOrchestrator. Everything above this
 * class (controller, commands, webview) only ever calls `submit` and `stop`.
 */
export class AgentRuntime implements vscode.Disposable {
  private readonly state: AgentState;
  private readonly orchestrator: AgentOrchestrator;
  private active: Promise<void> | undefined;
  private pendingPlan:
    | { plan: import('../../shared/types.js').PlanView; resolve: (text: string | undefined) => void }
    | undefined;

  constructor(private readonly deps: AgentRuntimeDeps) {
    this.state = new AgentState(
      (phase, label) => {
        this.deps.events.emit({ type: 'phaseChanged', phase, label });
      },
      deps.workspace.rootPaths()[0] || ''
    );

    this.orchestrator = new AgentOrchestrator({
      provider: deps.provider,
      registry: deps.registry,
      executor: deps.executor,
      conversations: deps.conversations,
      context: deps.context,
      attachments: deps.attachments,
      vision: deps.vision,
      memory: deps.memory,
      settings: deps.settings,
      checkpoints: deps.checkpoints,
      events: deps.events,
      state: this.state,
      verification: new VerificationLoop(deps.workspace, undefined),
      requestPlanApproval: (plan, token) => this.requestPlanApproval(plan, token)
    });
  }

  decidePlan(planId: string, decision: 'approve' | 'cancel' | 'edit', text?: string): void {
    if (!this.pendingPlan || this.pendingPlan.plan.planId !== planId) {
      return;
    }
    const pending = this.pendingPlan;
    this.pendingPlan = undefined;
    pending.resolve(decision === 'cancel' ? undefined : decision === 'edit' ? text?.trim() || undefined : pending.plan.text);
    this.deps.events.emit({ type: 'planResolved', planId });
  }

  private requestPlanApproval(
    plan: import('../../shared/types.js').PlanView,
    token: vscode.CancellationToken
  ): Promise<string | undefined> {
    this.pendingPlan?.resolve(undefined);
    this.pendingPlan = undefined;
    this.deps.events.emit({ type: 'planRequired', plan });
    return new Promise((resolve) => {
      const disposable = token.onCancellationRequested(() => {
        disposable.dispose();
        if (this.pendingPlan?.plan.planId === plan.planId) {
          this.pendingPlan = undefined;
          resolve(undefined);
        }
      });
      this.pendingPlan = {
        plan,
        resolve: (text) => {
          disposable.dispose();
          resolve(text);
        }
      };
    });
  }

  get running(): boolean {
    return this.state.running;
  }

  get phase(): AgentPhase {
    return this.state.currentPhase;
  }

  get usage(): import('../../shared/types.js').TokenUsageView {
    return { ...this.state.data.tokenUsage };
  }

  /** Cancellation token of the current task, for tools started outside the loop. */
  get token(): vscode.CancellationToken {
    return this.state.token;
  }

  /**
   * Runs one user turn. A second call while a task is running is ignored rather
   * than queued: the user has a Stop button, and silently stacking tasks would
   * make the agent feel out of control.
   */
  async submit(prompt: string): Promise<void> {
    if (this.state.running) {
      this.deps.events.emit({
        type: 'notification',
        level: 'warn',
        message: 'The agent is still working. Stop it first, or wait for it to finish.'
      });
      return;
    }

    const text = prompt.trim();
    if (text.length === 0) {
      return;
    }

    this.deps.approvals.resetTaskMemory();
    this.deps.conversations.clearTaskMemory();

    const token = this.state.start(text);
    this.setRunningContext(true);

    this.active = this.orchestrator
      .run(text, token)
      .catch((error: unknown) => {
        Logger.get().error('Agent task failed outside the loop', error);
        this.deps.events.emit({
          type: 'agentError',
          message: (error as Error)?.message ?? 'The agent stopped unexpectedly.',
          retryable: true
        });
      })
      .finally(() => {
        this.active = undefined;
        this.state.finish(this.state.currentPhase === 'error' ? 'error' : 'idle');
        this.setRunningContext(false);
      });

    await this.active;
  }

  /** Cancels the model request, the running tool and any pending approval. */
  stop(): void {
    if (!this.state.running) {
      return;
    }
    Logger.get().info('Agent stopped by the user');
    this.deps.approvals.rejectAll();
    this.pendingPlan?.resolve(undefined);
    this.pendingPlan = undefined;
    this.state.stop();
    this.setRunningContext(false);
    this.deps.events.emit({ type: 'phaseChanged', phase: 'idle', label: '' });
  }

  private setRunningContext(running: boolean): void {
    void vscode.commands.executeCommand('setContext', 'mytechin.agentRunning', running);
    this.deps.onRunningChanged?.(running);
  }

  dispose(): void {
    this.state.stop();
  }
}
