import type * as vscode from 'vscode';
import type { ToolRisk } from '../../shared/types.js';
import type { WorkspaceManager } from '../workspace/WorkspaceManager.js';
import type { FileReader } from '../workspace/FileReader.js';
import type { FileWriter } from '../workspace/FileWriter.js';
import type { FileSearcher } from '../workspace/FileSearcher.js';
import type { TerminalManager } from '../terminal/TerminalManager.js';
import type { CheckpointManager } from '../checkpoints/CheckpointManager.js';
import type { DiffManager } from '../checkpoints/DiffManager.js';

/** Structured result. Tools never return UI strings. */
export interface ToolResult {
  success: boolean;
  toolName: string;
  summary: string;
  output?: unknown;
  error?: string;
}

/** What the approval UI shows before a tool runs. */
export interface ApprovalPreview {
  title: string;
  detail?: string;
  diff?: string;
  command?: string;
  cwd?: string;
  path?: string;
  /** Lets a tool escalate at runtime, e.g. a command matching a destructive pattern. */
  riskOverride?: ToolRisk;
}

export interface ToolContext {
  workspace: WorkspaceManager;
  reader: FileReader;
  writer: FileWriter;
  searcher: FileSearcher;
  terminal: TerminalManager;
  checkpoints: CheckpointManager;
  diffs: DiffManager;
  browser?: import('../browser/BrowserService.js').BrowserService;
  token: vscode.CancellationToken;
  conversationId: string;
  /** Short status line pushed to the UI while the tool runs. */
  report(status: string): void;
  /** Used by `ask_user` to put a question in the chat and wait for the reply. */
  askUser(question: string, options?: string[]): Promise<string>;
}

export interface ToolDefinition<TInput = Record<string, unknown>> {
  name: string;
  description: string;
  risk: ToolRisk;
  source?: 'core' | 'mcp' | 'browser' | 'system';
  /** JSON Schema for native tool-calling providers and for validation. */
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  /** One-line label for the tool activity row, e.g. "Read auth.service.ts". */
  title(input: TInput): string;
  /** Called before approval so the user sees exactly what will happen. */
  preview?(input: TInput, ctx: ToolContext): Promise<ApprovalPreview>;
  execute(input: TInput, ctx: ToolContext): Promise<ToolResult>;
}

export function ok(toolName: string, summary: string, output?: unknown): ToolResult {
  return { success: true, toolName, summary, output };
}

export function fail(toolName: string, error: string, summary?: string): ToolResult {
  return { success: false, toolName, summary: summary ?? error, error };
}

export class ToolValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolValidationError';
  }
}

/** Minimal runtime validation: enough to catch a malformed model tool call. */
export function requireString(input: Record<string, unknown>, key: string, toolName: string): string {
  const value = input[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ToolValidationError(`${toolName} needs a "${key}" string argument.`);
  }
  return value.trim();
}

export function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function optionalNumber(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return Number(value);
  }
  return undefined;
}

export function optionalBoolean(input: Record<string, unknown>, key: string): boolean | undefined {
  const value = input[key];
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return undefined;
}
