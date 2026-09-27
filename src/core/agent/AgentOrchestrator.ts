import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import type { ChatMessage, ToolCallView } from '../../shared/types.js';
import { MAX_TOOL_OUTPUT_CHARS_IN_UI } from '../../shared/constants/index.js';
import type { AIProvider } from '../providers/AIProvider.js';
import { ProviderError, type AIMessage, type AIStreamEvent } from '../providers/ProviderTypes.js';
import type { ToolExecutor } from '../tools/ToolExecutor.js';
import type { ToolRegistry } from '../tools/ToolRegistry.js';
import type { ConversationManager } from '../conversation/ConversationManager.js';
import type { ContextManager } from '../context/ContextManager.js';
import type { AttachmentManager } from '../context/AttachmentManager.js';
import type { VisionAdapter } from '../vision/VisionAdapter.js';
import { SystemPromptBuilder, TaskPromptBuilder } from '../prompt/SystemPromptBuilder.js';
import type { SettingsStore } from '../storage/SettingsStore.js';
import type { CheckpointManager } from '../checkpoints/CheckpointManager.js';
import { Logger } from '../logging/Logger.js';
import type { AgentEventSink } from './AgentEvents.js';
import { AgentState } from './AgentState.js';
import { ToolCallParser } from './ToolCallParser.js';
import type { VerificationLoop } from './VerificationLoop.js';

export interface AgentOrchestratorDeps {
  provider: () => Promise<AIProvider>;
  registry: ToolRegistry;
  executor: ToolExecutor;
  conversations: ConversationManager;
  context: ContextManager;
  attachments: AttachmentManager;
  vision: VisionAdapter;
  memory: import('../memory/MemoryRetriever.js').MemoryRetriever;
  settings: SettingsStore;
  checkpoints: CheckpointManager;
  events: AgentEventSink;
  state: AgentState;
  verification: VerificationLoop;
  requestPlanApproval: (plan: import('../../shared/types.js').PlanView, token: vscode.CancellationToken) => Promise<string | undefined>;
}

/**
 * The loop: build context, call the model, handle a tool request, get approval,
 * execute, feed the result back, repeat until the model answers or a guard
 * stops it. Every exit path is bounded — iterations, cancellation, repeated
 * calls and provider errors all terminate cleanly.
 */
export class AgentOrchestrator {
  private readonly systemPrompt = new SystemPromptBuilder();
  private readonly taskPrompt = new TaskPromptBuilder();
  private repairAttempts = 0;

  constructor(private readonly deps: AgentOrchestratorDeps) {}

  async run(userPrompt: string, token: vscode.CancellationToken): Promise<void> {
    const { conversations, events, state, settings } = this.deps;
    const config = settings.read();
    this.repairAttempts = 0;

    if (config.planBeforeExecute) {
      const plan = { planId: randomUUID(), text: `Plan for this request:\n\n${userPrompt}` };
      const approvedPlan = await this.deps.requestPlanApproval(plan, token);
      if (!approvedPlan || token.isCancellationRequested) {
        return;
      }
      // Keep the user's actual request as the task. The editable plan is
      // execution guidance, not a replacement for the request.
      userPrompt = `${userPrompt}\n\nApproved execution plan:\n${approvedPlan}`;
    }

    state.setPhase('analyzing');

    const assistantMessage: ChatMessage = {
      id: randomUUID(),
      role: 'assistant',
      text: '',
      createdAt: Date.now(),
      streaming: true,
      toolCalls: []
    };
    conversations.addMessage(assistantMessage);
    events.emit({ type: 'messageAppended', message: assistantMessage });
    events.emit({ type: 'assistantStarted', messageId: assistantMessage.id });

    await this.deps.checkpoints.endTurn();
    this.deps.checkpoints.beginTurn(conversations.id, userPrompt.slice(0, 80));

    try {
      state.setPhase('building-context');
      const context = await this.deps.context.build(userPrompt, token);
      const summary = this.deps.context.summary();
      if (summary) {
        events.emit({ type: 'contextUpdated', summary });
      }

      const provider = await this.deps.provider();
      const nativeTools = provider.supportsTools();

      const system = this.systemPrompt.build({
        context,
        tools: this.deps.registry.all(),
        nativeToolCalling: nativeTools,
        approvalMode: config.approvalMode,
        isCloud: provider.isCloud,
        providerName: provider.name,
        projectMemory: await this.deps.memory.retrieve(userPrompt)
      });

      const images = await this.deps.vision.getImagesAsDataUrls(this.deps.attachments.list());
      if (images.length > 0 && !provider.supportsVision()) {
        const note = '> **Note:** You attached images, but the selected model does not support vision capabilities. The images will be ignored.';
        this.appendText(assistantMessage, `\n\n${note}\n\n`);
        conversations.addModelTurn({ role: 'assistant', content: note });
      }

      let userContent: import('../providers/ProviderTypes.js').AIMessageContent = 
        this.taskPrompt.build(userPrompt, [], 0, config.maxToolIterations).body;

      if (images.length > 0 && provider.supportsVision()) {
        userContent = [
          { type: 'text', text: userContent as string },
          ...images.map((img) => ({ type: 'image_url' as const, image_url: { url: img.url } }))
        ];
      }

      conversations.addModelTurn({
        role: 'user',
        content: userContent
      });

      let iteration = 0;
      const maxIterations = Math.max(1, config.maxToolIterations);

      for (;;) {
        if (token.isCancellationRequested) {
          break;
        }

        state.setPhase('waiting-for-model');
        const turn = await this.streamOnce(provider, system, assistantMessage, token, config);

        if (turn.aborted || token.isCancellationRequested) {
          break;
        }

        if (!turn.call) {
          // No tool requested: the model has answered.
          conversations.addModelTurn({ role: 'assistant', content: turn.text });
          break;
        }

        iteration = state.countIteration();
        if (iteration > maxIterations) {
          const note = `Stopped after ${maxIterations} tool calls. Ask me to continue if there is more to do.`;
          this.appendText(assistantMessage, `\n\n${note}`);
          conversations.addModelTurn({ role: 'assistant', content: note });
          break;
        }

        conversations.addModelTurn({
          role: 'assistant',
          content: `${turn.text}\n<tool name="${turn.call.name}">\n${JSON.stringify(turn.call.arguments)}\n</tool>`
        });

        if (turn.call.parseError) {
          conversations.addModelTurn({
            role: 'tool',
            name: turn.call.name,
            content: turn.call.parseError
          });
          continue;
        }

        if (state.isRepeat(turn.call.name, turn.call.arguments)) {
          conversations.addModelTurn({
            role: 'tool',
            name: turn.call.name,
            content:
              'You already ran this exact tool call in this task and got a result. Use that result, or try something different. Do not repeat it again.'
          });
          continue;
        }

        if (['write_file', 'create_file', 'apply_patch', 'multi_apply_patch', 'delete_file'].includes(turn.call.name)) {
          const paths = this.editPaths(turn.call.arguments);
          for (const path of paths) {
            const impact = await this.deps.context.preEditImpact(path);
            if (impact) {
              conversations.addModelTurn({ role: 'system', content: impact.body });
            }
          }
        }

        const result = await this.runTool(
          assistantMessage,
          turn.call.name,
          turn.call.arguments,
          token
        );

        conversations.addModelTurn({
          role: 'tool',
          name: turn.call.name,
          content: AgentOrchestrator.renderToolResult(result)
        });

        if (result.output && typeof result.output === 'object' && 'verification' in result.output) {
          const verification = (result.output as { verification: import('./VerificationLoop.js').VerificationResult }).verification;
          conversations.addModelTurn({
            role: 'system',
            content: this.verificationMessage(verification)
          });
          if (verification.repairRequired && this.repairAttempts >= 2) {
            this.appendText(assistantMessage, `\n\nVerification stopped after ${this.repairAttempts} self-repair attempts.`);
            break;
          }

        }

        // Re-prime the task section so the model keeps the goal in view.
        conversations.addModelTurn({
          role: 'user',
          content: this.taskPrompt.build(
            'Continue with the task above using the tool result.',
            conversations.task,
            iteration,
            maxIterations
          ).body
        });
      }

      assistantMessage.streaming = false;
      conversations.updateMessage(assistantMessage.id, { streaming: false });
      events.emit({
        type: 'assistantCompleted',
        messageId: assistantMessage.id,
        text: assistantMessage.text
      });

      await this.deps.checkpoints.endTurn();
      await conversations.persist();
      events.emit({ type: 'agentCompleted', conversationId: conversations.id });
      state.setPhase(token.isCancellationRequested ? 'idle' : 'done');
    } catch (error) {
      assistantMessage.streaming = false;
      await this.deps.checkpoints.endTurn();
      await conversations.persist().catch(() => undefined);
      this.reportError(assistantMessage, error);
      state.setPhase('error');
    }
  }

  /** One model turn. Returns the text plus a tool call if one was requested. */
  private async streamOnce(
    provider: AIProvider,
    system: string,
    message: ChatMessage,
    token: vscode.CancellationToken,
    config: ReturnType<SettingsStore['read']>
  ): Promise<{ text: string; call?: ReturnType<ToolCallParser['push']>['call']; aborted: boolean }> {
    const controller = new AbortController();
    const cancellation = token.onCancellationRequested(() => controller.abort());

    const parser = new ToolCallParser();
    let visibleText = '';
    let call: ReturnType<ToolCallParser['push']>['call'];
    let nativeCall: { name: string; arguments: Record<string, unknown> } | undefined;

    const messages: AIMessage[] = this.deps.conversations.modelTurns.map((turn) => ({
      role: turn.role,
      content: turn.content,
      name: turn.name,
      toolCallId: turn.toolCallId
    }));

    const handle = (event: AIStreamEvent): void => {
      switch (event.type) {
        case 'text': {
          if (parser.finished) {
            return;
          }
          const parsed = parser.push(event.delta);
          if (parsed.text) {
            visibleText += parsed.text;
            this.deps.state.setPhase('streaming');
            this.appendText(message, parsed.text);
          }
          if (parsed.call && !call) {
            call = parsed.call;
            controller.abort(); // Nothing after a tool block is useful.
          }
          break;
        }
        case 'tool_call':
          if (!nativeCall) {
            nativeCall = { name: event.call.name, arguments: event.call.arguments };
          }
          break;
        case 'reasoning':
          // Private reasoning is never shown. Only the phase label updates.
          this.deps.state.setPhase('waiting-for-model', 'Thinking');
          break;
        default:
          break;
      }
    };

    try {
      await provider.stream(
        {
          model: config.model,
          messages,
          system,
          temperature: config.temperature,
          maxTokens: config.maxTokens,
          tools: provider.supportsTools() ? this.deps.registry.schemas() : undefined,
          signal: controller.signal
        },
        handle
      );
    } catch (error) {
      if (!(error instanceof ProviderError && error.kind === 'aborted') && !call) {
        throw error;
      }
    } finally {
      cancellation.dispose();
    }

    if (!call) {
      const flushed = parser.flush();
      if (flushed.text) {
        visibleText += flushed.text;
        this.appendText(message, flushed.text);
      }
      call = flushed.call;
    }

    if (!call && nativeCall) {
      call = { name: nativeCall.name, arguments: nativeCall.arguments, raw: '' };
    }

    return {
      text: visibleText,
      call,
      aborted: token.isCancellationRequested
    };
  }

  /** Executes one tool, pushing activity rows and approval prompts to the UI. */
  private async runTool(
    message: ChatMessage,
    name: string,
    input: Record<string, unknown>,
    token: vscode.CancellationToken
  ) {
    const { events, conversations, state } = this.deps;
    const callId = randomUUID();

    const view: ToolCallView = {
      callId,
      toolName: name,
      title: name,
      risk: this.deps.registry.get(name)?.risk ?? 'safe',
      status: 'running',
      startedAt: Date.now()
    };
    conversations.upsertToolCall(message.id, view);
    events.emit({ type: 'toolStarted', messageId: message.id, call: view });
    state.setPhase('running-tool', `Running ${name}`);

    const shouldVerify =
      this.deps.settings.read().verifyAfterEdit &&
      /^(write_file|create_file|apply_patch|multi_apply_patch|delete_file)$/.test(name);
    const modifiedFiles = AgentOrchestrator.touchedFiles(name, input);
    const beforeDiagnostics = shouldVerify
      ? await this.deps.verification.inspectDiagnostics(modifiedFiles)
      : [];
    const execution = await this.deps.executor.execute(name, input, token, (preview, risk) => {
      view.title = preview.title === name ? view.title : preview.title;
      view.risk = risk;
      view.detail = preview.detail;
      if (risk !== 'safe') {
        state.setPhase('awaiting-approval');
      }

    });

    view.title = execution.title;
    view.risk = execution.risk;
    view.status = execution.result.success
      ? 'success'
      : execution.approved
        ? 'error'
        : 'rejected';
    view.summary = execution.result.summary;
    view.error = execution.result.error;
    view.endedAt = Date.now();
    view.output = AgentOrchestrator.previewOutput(execution.result.output);

    conversations.upsertToolCall(message.id, view);
    events.emit({ type: 'toolCompleted', messageId: message.id, call: view });

    if (execution.result.success && shouldVerify) {
      state.setPhase('verifying');
      conversations.noteTaskFact(execution.result.summary);
      const files = AgentOrchestrator.modifiedFiles(execution.result.output);
      if (files.length > 0) {
        const verification = await this.deps.verification.verify(files, token, beforeDiagnostics);
        execution.result.output = {
          ...(execution.result.output && typeof execution.result.output === 'object'
            ? execution.result.output
            : {}),
          verification
        };
        if (!verification.passed || verification.warningsCount > 0) {
          if (verification.repairPrompt) {
            execution.result.summary += ` Verification found ${verification.errorsCount} error${verification.errorsCount === 1 ? '' : 's'}.`;
          } else if (verification.warningsCount > 0) {
            execution.result.summary += ` Verification found ${verification.warningsCount} warning${verification.warningsCount === 1 ? '' : 's'}.`;
          }
        }
      }

    }

    Logger.get().info(`Tool ${name} → ${view.status} (${execution.durationMs}ms)`);
    return execution.result;
  }

  private verificationMessage(result: import('./VerificationLoop.js').VerificationResult): string {
    if (result.repairRequired && this.repairAttempts < 2) {
      this.repairAttempts += 1;
      return `${result.repairPrompt}\nThis is self-repair attempt ${this.repairAttempts} of 2.`;
    }

    if (result.repairRequired) {
      return `Verification still reports ${result.newErrorsCount} new error(s) after the repair limit. Stop editing and report the failure.`;
    }
    return result.selectedTests.length > 0
      ? `Verification passed. A corresponding test file exists: ${result.selectedTests.join(', ')}. If useful, run only it with \`${result.testCommand} ${result.selectedTests[0]}\` using the normal run_command approval flow.`
      : 'Verification passed: no new error diagnostics were found.';
  }

  private editPaths(input: Record<string, unknown>): string[] {
    const paths: string[] = [];
    if (typeof input.path === 'string') {
      paths.push(input.path);
    }
    const entries = Array.isArray(input.files) ? input.files : input.changes;
    if (Array.isArray(entries)) {
      for (const file of entries) {
        if (file && typeof file === 'object' && typeof (file as { path?: unknown }).path === 'string') {
          paths.push((file as { path: string }).path);
        }
      }
    }
    return Array.from(new Set(paths));
  }

  private appendText(message: ChatMessage, delta: string): void {
    message.text += delta;
    this.deps.events.emit({ type: 'assistantChunk', messageId: message.id, delta });
  }

  private static modifiedFiles(output: unknown): string[] {
    if (!output || typeof output !== 'object') {
      return [];
    }

    const value = output as { path?: unknown; files?: unknown };
    if (typeof value.path === 'string') {
      return [value.path];
    }
    if (Array.isArray(value.files)) {
      return value.files.flatMap((file) => {
        if (typeof file === 'string') return [file];
        if (!file || typeof file !== 'object') return [];
        const path = (file as { path?: unknown }).path;
        return typeof path === 'string' ? [path] : [];
      });
    }
    return [];
  }

  private static touchedFiles(name: string, input: Record<string, unknown>): string[] {
    if (name === 'multi_apply_patch' && Array.isArray(input.changes)) {
      return input.changes.flatMap((change) =>
        change && typeof change === 'object' && typeof (change as { path?: unknown }).path === 'string'
          ? [(change as { path: string }).path]
          : []
      );
    }
    return typeof input.path === 'string' ? [input.path] : [];
  }

  private reportError(message: ChatMessage, error: unknown): void {
    const { events, conversations } = this.deps;
    let text = 'Something went wrong.';
    let hint: string | undefined;
    let retryable = false;

    if (error instanceof ProviderError) {
      text = error.message;
      hint = error.hint;
      retryable = error.retryable;
    } else if (error instanceof vscode.CancellationError) {
      text = 'Stopped.';
    } else {
      text = (error as Error)?.message ?? String(error);
      retryable = true;
    }

    Logger.get().error(`Agent failed: ${text}`, error);
    conversations.updateMessage(message.id, { streaming: false, error: text });
    events.emit({ type: 'agentError', message: text, hint, retryable });
  }

  /** What the model sees. Structured, compact, and never a raw UI string. */
  private static renderToolResult(result: {
    success: boolean;
    toolName: string;
    summary: string;
    output?: unknown;
    error?: string;
  }): string {
    const header = `${result.success ? 'OK' : 'FAILED'} — ${result.summary}`;
    if (!result.success) {
      return `${header}\n${result.error ?? ''}`.trim();
    }
    if (result.output === undefined) {
      return header;
    }
    const serialized =
      typeof result.output === 'string' ? result.output : JSON.stringify(result.output, null, 1);
    return `${header}\n${serialized}`;
  }

  /** What the UI shows in an expanded tool row. Bounded so the webview stays fast. */
  private static previewOutput(output: unknown): string | undefined {
    if (output === undefined) {
      return undefined;
    }
    const serialized = typeof output === 'string' ? output : JSON.stringify(output, null, 2);
    return serialized.length > MAX_TOOL_OUTPUT_CHARS_IN_UI
      ? `${serialized.slice(0, MAX_TOOL_OUTPUT_CHARS_IN_UI)}\n… truncated …`
      : serialized;
  }
}
