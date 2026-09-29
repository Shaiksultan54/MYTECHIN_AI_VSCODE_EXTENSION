import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import type {
  AgentPhase,
  ApprovalRequestView,
  ChatMessage,
  ToolCallView
} from '../../shared/types.js';
import type { ToolResult } from '../tools/ToolTypes.js';

const PHASE_LABEL: Record<AgentPhase, string> = {
  idle: '',
  analyzing: 'Analyzing request',
  'building-context': 'Gathering context',
  'waiting-for-model': 'Thinking',
  verifying: 'Verifying the change',
  done: 'Completed',
  error: 'Stopped',
  planning: 'Planning execution',
  discovery: 'Discovering context',
  implementation: 'Implementing changes',
  validation: 'Validating changes',
  repair: 'Repairing errors',
  review: 'Reviewing',
  completed: 'Task completed',
  failed: 'Task failed',
  cancelled: 'Task cancelled',
  streaming: 'Responding',
  'awaiting-approval': 'Waiting for your approval',
  'running-tool': 'Running tool'
};

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface AgentDiagnostic {
  file: string;
  line?: number;
  column?: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
}

export interface AgentTestResult {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  durationMs?: number;
}

export interface AgentBuildResult {
  command: string;
  status: 'passed' | 'failed' | 'skipped';
  output?: string;
  durationMs?: number;
}

export interface AgentStateData {
  taskId: string;
  sessionId: string;
  workspaceRoot: string;
  phase: AgentPhase;
  userRequest: string;
  plan?: string;
  currentStep?: string;
  messages: ChatMessage[];
  toolCalls: ToolCallView[];
  toolResults: ToolResult[];
  changedFiles: string[];
  diagnostics: AgentDiagnostic[];
  tests: AgentTestResult[];
  buildResults: AgentBuildResult[];
  retries: number;
  tokenUsage: TokenUsage;
  estimatedCost: number;
  selectedModel: string;
  provider: string;
  errors: string[];
  approvals: ApprovalRequestView[];
  createdAt: number;
  updatedAt: number;
}

/**
 * Tracks whether a task is running, the current phase, and the cancellation
 * token that every operation in the task hangs off. 
 * Provides a structured state machine for the agent runtime.
 */
export class AgentState {
  private source: vscode.CancellationTokenSource | undefined;
  private iterations = 0;
  
  public data: AgentStateData;

  /** Signature of each executed tool call, to catch the model looping. */
  private readonly signatures: string[] = [];

  constructor(
    private readonly onPhase: (phase: AgentPhase, label: string) => void,
    workspaceRoot: string,
    sessionId: string = randomUUID()
  ) {
    this.data = {
      taskId: randomUUID(),
      sessionId,
      workspaceRoot,
      phase: 'idle',
      userRequest: '',
      messages: [],
      toolCalls: [],
      toolResults: [],
      changedFiles: [],
      diagnostics: [],
      tests: [],
      buildResults: [],
      retries: 0,
      tokenUsage: { promptTokens: 0, completionTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      estimatedCost: 0,
      selectedModel: '',
      provider: '',
      errors: [],
      approvals: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  }

  get running(): boolean {
    return this.source !== undefined;
  }

  get token(): vscode.CancellationToken {
    return this.source?.token ?? new vscode.CancellationTokenSource().token;
  }

  get currentPhase(): AgentPhase {
    return this.data.phase;
  }

  get toolIterations(): number {
    return this.iterations;
  }

  start(userRequest: string): vscode.CancellationToken {
    this.stop();
    this.source = new vscode.CancellationTokenSource();
    this.iterations = 0;
    this.signatures.length = 0;
    
    this.data.taskId = randomUUID();
    this.data.userRequest = userRequest;
    this.data.createdAt = Date.now();
    this.data.updatedAt = Date.now();
    this.data.messages = [];
    this.data.toolCalls = [];
    this.data.toolResults = [];
    this.data.changedFiles = [];
    this.data.errors = [];
    
    return this.source.token;
  }

  countIteration(): number {
    this.data.updatedAt = Date.now();
    return ++this.iterations;
  }

  setPhase(phase: AgentPhase, label?: string): void {
    this.data.phase = phase;
    this.data.updatedAt = Date.now();
    this.onPhase(phase, label ?? PHASE_LABEL[phase] ?? phase);
  }

  addTokenUsage(usage: { prompt: number; completion: number; cacheRead?: number; cacheWrite?: number }): void {
    this.data.tokenUsage.promptTokens += usage.prompt;
    this.data.tokenUsage.completionTokens += usage.completion;
    this.data.tokenUsage.cacheReadTokens += usage.cacheRead ?? 0;
    this.data.tokenUsage.cacheWriteTokens += usage.cacheWrite ?? 0;
    this.data.updatedAt = Date.now();
  }

  addError(error: string): void {
    this.data.errors.push(error);
    this.data.updatedAt = Date.now();
  }

  trackFileChange(filePath: string): void {
    if (!this.data.changedFiles.includes(filePath)) {
      this.data.changedFiles.push(filePath);
      this.data.updatedAt = Date.now();
    }
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
    if (this.data.phase !== 'completed' && this.data.phase !== 'failed') {
      this.setPhase('cancelled');
    }
  }

  finish(phase: AgentPhase = 'completed'): void {
    this.source?.dispose();
    this.source = undefined;
    this.setPhase(phase);
  }
}
