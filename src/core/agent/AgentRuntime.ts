import * as vscode from 'vscode';
import type { AgentPhase } from '../../shared/types.js';
import type { AIProvider } from '../providers/AIProvider.js';
import type { ToolExecutor } from '../tools/ToolExecutor.js';
import type { ToolRegistry } from '../tools/ToolRegistry.js';
import type { ConversationManager } from '../conversation/ConversationManager.js';
import type { ContextManager } from '../context/ContextManager.js';
import type { SettingsStore } from '../storage/SettingsStore.js';
import type { CheckpointManager } from '../checkpoints/CheckpointManager.js';
import type { ApprovalManager } from '../approval/ApprovalManager.js';
import { Logger } from '../logging/Logger.js';
import type { AgentEventSink } from './AgentEvents.js';
import { AgentLoop } from './AgentLoop.js';
import { AgentState } from './AgentState.js';

export interface AgentRuntimeDeps {
  provider: () => Promise<AIProvider>;
  registry: ToolRegistry;
  executor: ToolExecutor;
  conversations: ConversationManager;
  context: ContextManager;
  settings: SettingsStore;
  checkpoints: CheckpointManager;
  approvals: ApprovalManager;
  events: AgentEventSink;
  onRunningChanged?: (running: boolean) => void;
}

/**
 * The public face of the agent. It owns task lifecycle — start, phase, stop —
 * and delegates the actual reasoning cycle to AgentLoop. Everything above this
 * class (controller, commands, webview) only ever calls `submit` and `stop`.
 */
export class AgentRuntime implements vscode.Disposable {
  private readonly state: AgentState;
  private readonly loop: AgentLoop;
  private active: Promise<void> | undefined;

  constructor(private readonly deps: AgentRuntimeDeps) {
    this.state = new AgentState((phase, label) => {
      this.deps.events.emit({ type: 'phaseChanged', phase, label });
    });

    this.loop = new AgentLoop({
      provider: deps.provider,
      registry: deps.registry,
      executor: deps.executor,
      conversations: deps.conversations,
      context: deps.context,
      settings: deps.settings,
      checkpoints: deps.checkpoints,
      events: deps.events,
      state: this.state
    });
  }

  get running(): boolean {
    return this.state.running;
  }

  get phase(): AgentPhase {
    return this.state.currentPhase;
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

    const token = this.state.start();
    this.setRunningContext(true);

    this.active = this.loop
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
