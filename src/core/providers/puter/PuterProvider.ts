import { BaseProvider } from '../AIProvider.js';
import { joinUrl, readLines, request } from '../http.js';
import {
  ProviderError,
  type AIRequest,
  type AIStreamEvent,
  type ModelInfo,
  type ProviderConfig,
  type ProviderStatus
} from '../ProviderTypes.js';
import { PuterAuth } from './PuterAuth.js';
import { PuterErrorMapper } from './PuterErrorMapper.js';
import { PuterModelService } from './PuterModelService.js';

/**
 * OpenAI-compatible SSE chunk shape. Matches the wire format of
 * `POST /puterai/openai/v1/chat/completions` with `stream: true`.
 */
interface ChatChunk {
  choices?: {
    delta?: {
      content?: string;
      reasoning_content?: string;
      tool_calls?: {
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }[];
    };
    finish_reason?: string;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * Puter AI provider — accesses the Puter AI Gateway through its
 * **OpenAI-compatible endpoint** at `/puterai/openai/v1/`.
 *
 * Why the OpenAI-compat endpoint and not `@heyputer/puter.js`?
 *   - The SDK requires Node 24+; VS Code ships Node 20–22.
 *   - The SDK's `getAuthToken()` opens a browser — unusable in an extension.
 *   - The OpenAI-compat endpoint is officially documented and recommended
 *     for non-browser environments.
 *
 * Architecture:
 *   PuterProvider (facade)
 *     → PuterAuth        (token management + guest sessions)
 *     → PuterModelService (live model discovery)
 *     → http.ts           (SSE streaming, same as OpenAICompatibleProvider)
 *     → PuterErrorMapper  (error normalization)
 *
 * The agent loop only sees the AIProvider interface and has no idea
 * that Puter is involved.
 */
export class PuterProvider extends BaseProvider {
  readonly id = 'puter';
  readonly name = 'Puter';
  readonly isCloud = true;
  readonly requiresSecret = false;

  private readonly auth = new PuterAuth();
  private readonly models: PuterModelService;

  constructor() {
    super();
    this.models = new PuterModelService(this.auth);
  }

  override configure(config: ProviderConfig): void {
    super.configure(config);
    this.auth.configure(config.baseUrl, config.apiKey);
    this.models.invalidate();
  }

  // ─── Model Discovery ──────────────────────────────────────────────

  async listModels(): Promise<ModelInfo[]> {
    return this.models.list();
  }

  // ─── Connection Test ──────────────────────────────────────────────

  async testConnection(): Promise<ProviderStatus> {
    try {
      const status = await this.auth.verify(true);
      const models = await this.listModels();
      const freeCount = models.length; // All Puter models are free via User-Pays

      const authLabel = status.authType === 'account'
        ? `Signed in as ${status.username ?? 'Puter user'}`
        : 'Temporary session';

      return {
        state: 'connected',
        message: `${authLabel} · ${freeCount} free models`
      };
    } catch (error) {
      const mapped = PuterErrorMapper.map(error);
      return { state: 'error', message: mapped.hint ?? mapped.message };
    }
  }

  // ─── Capability Flags ─────────────────────────────────────────────

  override supportsTools(): boolean {
    return true;
  }

  override supportsVision(): boolean {
    return true;
  }

  // ─── Streaming Chat ───────────────────────────────────────────────

  async stream(req: AIRequest, onEvent: (event: AIStreamEvent) => void): Promise<void> {
    await this.auth.ensureToken();

    if (!req.model) {
      throw new ProviderError('not-configured', 'No Puter model selected.', 'Pick a model in the sidebar.');
    }

    // Build OpenAI-compatible request body
    const messages = [
      ...(req.system ? [{ role: 'system', content: req.system }] : []),
      ...req.messages.map((m) =>
        m.role === 'tool'
          ? { role: 'tool', content: m.content, tool_call_id: m.toolCallId ?? m.name ?? 'tool' }
          : { role: m.role, content: m.content }
      )
    ];

    const body: Record<string, unknown> = {
      model: req.model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      temperature: req.temperature ?? 0.2,
      max_tokens: req.maxTokens ?? 4096
    };

    if (req.tools?.length) {
      body.tools = req.tools.map((tool) => ({
        type: 'function',
        function: { name: tool.name, description: tool.description, parameters: tool.parameters }
      }));
      body.tool_choice = 'auto';
    }

    // Send to the OpenAI-compatible chat/completions endpoint
    let response: Response;
    try {
      response = await request(
        joinUrl(this.auth.openaiBase, '/chat/completions'),
        {
          method: 'POST',
          headers: this.auth.authHeaders(),
          body,
          signal: req.signal,
          timeoutMs: 0x7fffffff
        }
      );
    } catch (error) {
      throw PuterErrorMapper.map(error);
    }

    // Parse SSE stream — identical to the OpenAI wire format
    const pending = new Map<number, { id: string; name: string; args: string }>();
    let finish: 'stop' | 'length' | 'tool_call' | 'aborted' = 'stop';

    for await (const line of readLines(response, req.signal)) {
      if (!line.startsWith('data:')) {
        continue;
      }
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') {
        break;
      }

      let chunk: ChatChunk;
      try {
        chunk = JSON.parse(payload) as ChatChunk;
      } catch {
        continue;
      }

      // Usage
      if (chunk.usage) {
        onEvent({
          type: 'usage',
          promptTokens: chunk.usage.prompt_tokens,
          completionTokens: chunk.usage.completion_tokens
        });
      }

      const choice = chunk.choices?.[0];
      if (!choice) {
        continue;
      }

      // Reasoning content (extended thinking)
      if (choice.delta?.reasoning_content) {
        onEvent({ type: 'reasoning', delta: choice.delta.reasoning_content });
      }

      // Text content
      if (choice.delta?.content) {
        onEvent({ type: 'text', delta: choice.delta.content });
      }

      // Tool calls
      for (const call of choice.delta?.tool_calls ?? []) {
        const index = call.index ?? 0;
        const existing = pending.get(index) ?? { id: call.id ?? `call-${index}`, name: '', args: '' };
        if (call.id) existing.id = call.id;
        if (call.function?.name) existing.name = call.function.name;
        if (call.function?.arguments) existing.args += call.function.arguments;
        pending.set(index, existing);
      }

      // Finish reason
      if (choice.finish_reason === 'tool_calls') {
        finish = 'tool_call';
      } else if (choice.finish_reason === 'length') {
        finish = 'length';
      }
    }

    // Emit accumulated tool calls
    for (const call of pending.values()) {
      let args: Record<string, unknown> = {};
      try {
        args = call.args ? (JSON.parse(call.args) as Record<string, unknown>) : {};
      } catch {
        args = { _raw: call.args };
      }
      onEvent({ type: 'tool_call', call: { id: call.id, name: call.name, arguments: args } });
      finish = 'tool_call';
    }

    if (req.signal?.aborted) {
      finish = 'aborted';
    }

    onEvent({ type: 'done', finishReason: finish });
  }
}
