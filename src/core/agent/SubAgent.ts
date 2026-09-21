import * as vscode from 'vscode';
import type { AIProvider } from '../providers/AIProvider.js';
import { ToolRegistry } from '../tools/ToolRegistry.js';
import { ToolExecutor } from '../tools/ToolExecutor.js';
import type { ToolExecution } from '../tools/ToolExecutor.js';
import { Logger } from '../logging/Logger.js';

export type SubAgentRole = 'planner' | 'reviewer' | 'debugger' | 'architect' | 'coder';

export interface SubAgentConfig {
  role: SubAgentRole;
  allowedTools: string[];
  maxIterations: number;
  tokenBudget: number;
}

export interface SubAgentResult {
  role: SubAgentRole;
  success: boolean;
  output: string;
  toolExecutions: ToolExecution[];
  error?: string;
}

/**
 * Isolated, scoped sub-agent for specialized engineering tasks.
 * Inherits restricted tool permissions and an isolated context window.
 */
export class SubAgent {
  private readonly registry = new ToolRegistry();

  constructor(
    public readonly config: SubAgentConfig,
    baseRegistry: ToolRegistry,
    private readonly executor: ToolExecutor,
    private readonly provider: () => Promise<AIProvider>
  ) {
    // Filter base tools to only the allowed tools for this role
    const allowed = new Set(config.allowedTools);
    for (const tool of baseRegistry.all()) {
      if (allowed.has(tool.name)) {
        this.registry.register(tool);
      }
    }
  }

  async run(taskPrompt: string, token: vscode.CancellationToken): Promise<SubAgentResult> {
    Logger.get().info(`Starting sub-agent: ${this.config.role}`, { task: taskPrompt.slice(0, 100) });

    const provider = await this.provider();
    const toolExecutions: ToolExecution[] = [];

    const systemPrompt = `You are a specialized ${this.config.role.toUpperCase()} engineering sub-agent.
Your goal is to execute the following specific subtask with precision.
Available tools: ${this.registry.names().join(', ')}.
Focus only on your assigned role and return concise, evidence-based results.`;

    try {
      const response = await provider.chat({
        model: '',
        system: systemPrompt,
        messages: [{ role: 'user', content: taskPrompt }],
        tools: this.registry.all().map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters
        })),
        signal: undefined
      });

      // If sub-agent requested tool calls, execute them within bounds
      if (response.toolCalls && response.toolCalls.length > 0) {
        for (const call of response.toolCalls.slice(0, this.config.maxIterations)) {
          if (token.isCancellationRequested) break;
          const execution = await this.executor.execute(call.name, call.arguments, token);
          toolExecutions.push(execution);
        }
      }

      return {
        role: this.config.role,
        success: true,
        output: response.text,
        toolExecutions
      };
    } catch (error) {
      Logger.get().warn(`Sub-agent ${this.config.role} encountered error: ${(error as Error).message}`);
      return {
        role: this.config.role,
        success: false,
        output: '',
        toolExecutions,
        error: (error as Error).message
      };
    }
  }
}
