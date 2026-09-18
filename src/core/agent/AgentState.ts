import * as vscode from 'vscode';
import type { AgentPhase } from '../../shared/types.js';

const PHASE_LABEL: Record<AgentPhase, string> = {
  idle: '',
  analyzing: 'Analyzing request',
  'building-context': 'Gathering context',
  'waiting-for-model': 'Thinking',
  streaming: 'Responding',
  'awaiting-approval': 'Waiting for your approval',
  'running-tool': 'Running tool',
  verifying: 'Verifying the change',
  done: 'Completed',
  error: 'Stopped'
};

/**
 * Tracks whether a task is running, the current phase, and the cancellation
 * token that every operation in the task hangs off.
 */
export class AgentState {
  private source: vscode.CancellationTokenSource | undefined;
  private phase: AgentPhase = 'idle';
  private iterations = 0;
  /** Signature of each executed tool call, to catch the model looping. */
  private readonly signatures: string[] = [];

  constructor(private readonly onPhase: (phase: AgentPhase, label: string) => void) {}

  get running(): boolean {
    return this.source !== undefined;
  }

  get token(): vscode.CancellationToken {
    return this.source?.token ?? new vscode.CancellationTokenSource().token;
  }

  get currentPhase(): AgentPhase {
    return this.phase;
  }

  get toolIterations(): number {
    return this.iterations;
  }

  start(): vscode.CancellationToken {
    this.stop();
    this.source = new vscode.CancellationTokenSource();
    this.iterations = 0;
    this.signatures.length = 0;
    return this.source.token;
  }

  countIteration(): number {
    return ++this.iterations;
  }

  setPhase(phase: AgentPhase, label?: string): void {
    this.phase = phase;
    this.onPhase(phase, label ?? PHASE_LABEL[phase]);
  }

  /**
   * True when this exact call has already run in this task. Repeating a tool
   * call verbatim means the model is stuck; the loop tells it so rather than
   * burning iterations.
   */
  isRepeat(toolName: string, input: unknown): boolean {
    const signature = `${toolName}:${JSON.stringify(input)}`;
    const repeat = this.signatures.includes(signature);
    this.signatures.push(signature);
    if (this.signatures.length > 40) {
      this.signatures.shift();
    }
    return repeat;
  }

  stop(): void {
    this.source?.cancel();
    this.source?.dispose();
    this.source = undefined;
  }

  finish(phase: AgentPhase = 'idle'): void {
    this.source?.dispose();
    this.source = undefined;
    this.setPhase(phase);
  }
}
