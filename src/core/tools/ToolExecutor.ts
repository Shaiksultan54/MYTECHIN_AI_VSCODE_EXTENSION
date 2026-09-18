import * as vscode from 'vscode';
import { MAX_TOOL_OUTPUT_CHARS_TO_MODEL } from '../../shared/constants/index.js';
import type { ToolRisk } from '../../shared/types.js';
import { PathSecurityError } from '../workspace/PathSecurity.js';
import { Logger } from '../logging/Logger.js';
import type { ApprovalManager } from '../approval/ApprovalManager.js';
import type { ToolRegistry } from './ToolRegistry.js';
import { ToolValidationError, fail, type ApprovalPreview, type ToolContext, type ToolResult } from './ToolTypes.js';

export interface ToolExecution {
  result: ToolResult;
  risk: ToolRisk;
  title: string;
  approved: boolean;
  automatic: boolean;
  durationMs: number;
}

/**
 * Runs one tool call end to end: validate, preview, ask for approval, execute,
 * bound the output. Errors are returned as failed results rather than thrown,
 * so the agent can tell the model what went wrong and try again.
 */
export class ToolExecutor {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly approvals: ApprovalManager,
    private readonly makeContext: (token: vscode.CancellationToken) => ToolContext
  ) {}

  async execute(
    name: string,
    input: Record<string, unknown>,
    token: vscode.CancellationToken,
    onPreview?: (preview: ApprovalPreview, risk: ToolRisk) => void
  ): Promise<ToolExecution> {
    const started = Date.now();
    const tool = this.registry.get(name);

    if (!tool) {
      const suggestion = this.registry.suggest(name);
      return {
        result: fail(
          name,
          `There is no tool called "${name}".${suggestion ? ` Did you mean "${suggestion}"?` : ''} Available tools: ${this.registry.names().join(', ')}.`
        ),
        risk: 'safe',
        title: `Unknown tool ${name}`,
        approved: false,
        automatic: true,
        durationMs: Date.now() - started
      };
    }

    let title: string = tool.name;
    try {
      title = tool.title(input);
    } catch {
      // A malformed input should not stop us from labelling the row.
    }

    const ctx = this.makeContext(token);

    // Build the preview first: it doubles as argument validation, so a broken
    // tool call is caught before anything is shown to the user.
    let preview: ApprovalPreview = { title, detail: undefined };
    if (tool.preview) {
      try {
        preview = await tool.preview(input, ctx);
      } catch (error) {
        return this.errorExecution(tool.name, title, tool.risk, error, started);
      }
    }
    const risk = preview.riskOverride ?? tool.risk;
    onPreview?.(preview, risk);

    if (token.isCancellationRequested) {
      return {
        result: fail(tool.name, 'Cancelled before the tool ran.'),
        risk,
        title,
        approved: false,
        automatic: true,
        durationMs: Date.now() - started
      };
    }

    const outcome = await this.approvals.request({ toolName: tool.name, risk, preview, token });
    if (!outcome.approved) {
      return {
        result: {
          success: false,
          toolName: tool.name,
          summary: 'The user rejected this action.',
          error:
            'The user rejected this action. Do not retry it. Explain what you were trying to do, or suggest a different approach.'
        },
        risk,
        title,
        approved: false,
        automatic: outcome.automatic,
        durationMs: Date.now() - started
      };
    }

    try {
      const result = await tool.execute(input, ctx);
      return {
        result: ToolExecutor.bound(result),
        risk,
        title,
        approved: true,
        automatic: outcome.automatic,
        durationMs: Date.now() - started
      };
    } catch (error) {
      return this.errorExecution(tool.name, title, risk, error, started, outcome.automatic);
    }
  }

  private errorExecution(
    toolName: string,
    title: string,
    risk: ToolRisk,
    error: unknown,
    started: number,
    automatic = true
  ): ToolExecution {
    let message: string;
    if (error instanceof PathSecurityError) {
      message = error.message;
    } else if (error instanceof ToolValidationError) {
      message = error.message;
    } else if (error instanceof vscode.CancellationError) {
      message = 'Cancelled.';
    } else {
      message = (error as Error)?.message ?? String(error);
    }
    Logger.get().warn(`Tool ${toolName} failed: ${message}`);
    return {
      result: fail(toolName, message),
      risk,
      title,
      approved: false,
      automatic,
      durationMs: Date.now() - started
    };
  }

  /** Keeps a single tool result from swallowing the whole context window. */
  private static bound(result: ToolResult): ToolResult {
    if (result.output === undefined) {
      return result;
    }
    const serialized = JSON.stringify(result.output);
    if (serialized.length <= MAX_TOOL_OUTPUT_CHARS_TO_MODEL) {
      return result;
    }
    return {
      ...result,
      output: {
        _truncated: true,
        _note: `Output was ${serialized.length} characters and has been cut to ${MAX_TOOL_OUTPUT_CHARS_TO_MODEL}. Narrow the request — read a line range, or search with a more specific query.`,
        preview: serialized.slice(0, MAX_TOOL_OUTPUT_CHARS_TO_MODEL)
      }
    };
  }
}
