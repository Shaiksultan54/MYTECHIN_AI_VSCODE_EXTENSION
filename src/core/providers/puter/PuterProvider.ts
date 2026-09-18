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
import { PuterAuthManager } from './PuterAuthManager.js';
import { PuterErrorMapper } from './PuterErrorMapper.js';
import { PuterModelResolver } from './PuterModelResolver.js';

/**
 * Puter AI, reached through the `drivers/call` endpoint that puter.js uses in
 * the browser. Everything Puter-specific lives in this folder: the agent loop
 * only ever sees the AIProvider interface.
 *
 * Note: Puter's driver API is not formally versioned. The request shape below
 * matches puter.js at the time of writing; if Puter changes it, only
 * `buildDriverCall` and `PuterModelResolver` need to change.
 */
export class PuterProvider extends BaseProvider {
  readonly id = 'puter';
  readonly name = 'Puter';
  readonly isCloud = true;
  readonly requiresSecret = false;

  private readonly auth = new PuterAuthManager();
  private readonly models: PuterModelResolver;

  constructor() {
    super();
    this.models = new PuterModelResolver(this.auth);
  }

  override configure(config: ProviderConfig): void {
    super.configure(config);
    this.auth.configure(config.baseUrl, config.apiKey);
    this.models.invalidate();
  }

  async listModels(): Promise<ModelInfo[]> {
    return this.models.list();
  }

  async testConnection(): Promise<ProviderStatus> {
    try {
      const who = await this.auth.verify(true);
      const models = await this.listModels();
      return {
        state: 'connected',
        message: `${who.username ? `Signed in as ${who.username} · ` : 'Free session · '}${models.length} models`
      };
    } catch (error) {
      const mapped = PuterErrorMapper.map(error);
      return { state: 'error', message: mapped.hint ?? mapped.message };
    }
  }

  override supportsTools(): boolean {
    return true;
  }
  override supportsVision(): boolean {
    return true;
  }

  private buildDriverCall(req: AIRequest): Record<string, unknown> {
    const messages = [
      ...(req.system ? [{ role: 'system', content: req.system }] : []),
      ...req.messages.map((m) =>
        m.role === 'tool'
          ? { role: 'tool', content: m.content, tool_call_id: m.toolCallId ?? m.name ?? 'tool' }
          : { role: m.role, content: m.content }
      )
    ];

    const args: Record<string, unknown> = {
      messages,
      model: req.model,
      stream: true,
      temperature: req.temperature ?? 0.2,
      max_tokens: req.maxTokens ?? 4096
    };
    if (req.tools?.length) {
      args.tools = req.tools.map((tool) => ({
        type: 'function',
        function: { name: tool.name, description: tool.description, parameters: tool.parameters }
      }));
    }

    return { interface: 'puter-chat-completion', method: 'complete', args };
  }

  async stream(req: AIRequest, onEvent: (event: AIStreamEvent) => void): Promise<void> {
    await this.auth.ensureToken();
    if (!req.model) {
      throw new ProviderError('not-configured', 'No Puter model selected.', 'Pick a model in the sidebar.');
    }

    let response: Response;
    try {
      response = await request(joinUrl(this.auth.apiBase, '/drivers/call'), {
        method: 'POST',
        headers: this.auth.authHeaders(),
        body: this.buildDriverCall(req),
        signal: req.signal,
        timeoutMs: 0x7fffffff
      });
    } catch (error) {
      throw PuterErrorMapper.map(error);
    }

    const pending = new Map<number, { id: string; name: string; args: string }>();
    let finish: 'stop' | 'length' | 'tool_call' | 'aborted' = 'stop';
    let sawAnything = false;

    for await (const raw of readLines(response, req.signal)) {
      const line = raw.startsWith('data:') ? raw.slice(5).trim() : raw.trim();
      if (!line || line === '[DONE]') {
        continue;
      }

      let event: any;
      try {
        event = JSON.parse(line);
      } catch {
        // Some deployments emit bare text chunks.
        sawAnything = true;
        onEvent({ type: 'text', delta: raw });
        continue;
      }

      if (event.success === false || event.error) {
        throw PuterErrorMapper.map(event.error ?? event);
      }

      const delta = PuterProvider.extractText(event);
      if (delta) {
        sawAnything = true;
        onEvent({ type: 'text', delta });
      }

      for (const call of PuterProvider.extractToolCallChunks(event)) {
        const index = call.index;
        const existing = pending.get(index) ?? { id: call.id ?? `call-${index}`, name: '', args: '' };
        if (call.id) existing.id = call.id;
        if (call.name) existing.name = call.name;
        if (call.arguments) existing.args += call.arguments;
        pending.set(index, existing);
        finish = 'tool_call';
      }

      const usage = event.usage ?? event.result?.usage;
      if (usage) {
        onEvent({
          type: 'usage',
          promptTokens: usage.prompt_tokens ?? usage.input_tokens,
          completionTokens: usage.completion_tokens ?? usage.output_tokens
        });
      }
    }

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

    if (!sawAnything && finish === 'stop' && pending.size === 0) {
      throw new ProviderError(
        'bad-response',
        'Puter returned an empty response.',
        'Try a different model, or check the account has AI credit.'
      );
    }
    if (req.signal?.aborted) {
      finish = 'aborted';
    }
    onEvent({ type: 'done', finishReason: finish });
  }

  /** Puter wraps several upstream shapes; check each known position. */
  private static extractText(event: any): string {
    return (
      event.text ??
      event.delta?.text ??
      event.result?.message?.content?.[0]?.text ??
      event.message?.content?.[0]?.text ??
      (typeof event.result?.message?.content === 'string' ? event.result.message.content : undefined) ??
      event.choices?.[0]?.delta?.content ??
      ''
    );
  }

  private static extractToolCallChunks(event: any): { index: number; id?: string; name?: string; arguments?: string }[] {
    const raw =
      event.tool_calls ??
      event.message?.tool_calls ??
      event.result?.message?.tool_calls ??
      event.choices?.[0]?.delta?.tool_calls ??
      [];
    const out = [];
    for (let i = 0; i < (raw as any[]).length; i++) {
      const call = raw[i];
      const args = call.function?.arguments ?? call.input ?? '';
      out.push({
        index: call.index ?? i,
        id: call.id,
        name: call.function?.name ?? call.name,
        arguments: typeof args === 'string' ? args : JSON.stringify(args)
      });
    }
    return out;
  }
}
