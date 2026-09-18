import { BaseProvider } from '../AIProvider.js';
import { joinUrl, readLines, request } from '../http.js';
import {
  ProviderError,
  type AIRequest,
  type AIStreamEvent,
  type ModelInfo,
  type ProviderStatus
} from '../ProviderTypes.js';

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
 * Speaks the OpenAI /chat/completions dialect. Serves OpenAI itself, LM Studio,
 * vLLM, llama.cpp, Together, Groq and anything else that implements the shape.
 */
export class OpenAICompatibleProvider extends BaseProvider {
  readonly id: string = 'openai-compatible';
  readonly name: string = 'OpenAI Compatible';
  readonly isCloud: boolean = true;
  readonly requiresSecret: boolean = true;

  protected defaultBaseUrl = '';

  protected get baseUrl(): string {
    const configured = this.config.baseUrl?.trim() || this.defaultBaseUrl;
    return configured.replace(/\/+$/, '');
  }

  protected headers(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.config.apiKey) {
      headers.Authorization = `Bearer ${this.config.apiKey}`;
    }
    if (this.config.organization) {
      headers['OpenAI-Organization'] = this.config.organization;
    }
    return headers;
  }

  protected assertConfigured(): void {
    if (!this.baseUrl) {
      throw new ProviderError(
        'not-configured',
        `${this.name} has no base URL.`,
        'Add the endpoint URL, including /v1, in provider settings.'
      );
    }
    if (this.requiresSecret && !this.config.apiKey) {
      throw new ProviderError(
        'not-configured',
        `${this.name} has no API key.`,
        'Add an API key in provider settings. It is stored in the VS Code secret store.'
      );
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    this.assertConfigured();
    const response = await request(joinUrl(this.baseUrl, '/models'), {
      headers: this.headers(),
      timeoutMs: 15000
    });
    const data = (await response.json()) as { data?: { id: string }[] };
    return (data.data ?? [])
      .map((model) => ({ id: model.id, name: model.id, supportsTools: true }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async testConnection(): Promise<ProviderStatus> {
    try {
      this.assertConfigured();
      const models = await this.listModels();
      return { state: 'connected', message: `${models.length} models available` };
    } catch (error) {
      if (error instanceof ProviderError && error.kind === 'not-configured') {
        return { state: 'not-configured', message: error.hint ?? error.message };
      }
      return { state: 'error', message: (error as Error).message };
    }
  }

  override supportsTools(): boolean {
    return true;
  }

  override supportsVision(): boolean {
    return true;
  }

  async stream(req: AIRequest, onEvent: (event: AIStreamEvent) => void): Promise<void> {
    this.assertConfigured();
    if (!req.model) {
      throw new ProviderError('not-configured', `No ${this.name} model selected.`, 'Pick a model in the sidebar.');
    }

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

    const response = await request(joinUrl(this.baseUrl, '/chat/completions'), {
      method: 'POST',
      headers: this.headers(),
      body,
      signal: req.signal,
      timeoutMs: 0x7fffffff
    });

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
      if (choice.delta?.reasoning_content) {
        onEvent({ type: 'reasoning', delta: choice.delta.reasoning_content });
      }
      if (choice.delta?.content) {
        onEvent({ type: 'text', delta: choice.delta.content });
      }
      for (const call of choice.delta?.tool_calls ?? []) {
        const index = call.index ?? 0;
        const existing = pending.get(index) ?? { id: call.id ?? `call-${index}`, name: '', args: '' };
        if (call.id) {
          existing.id = call.id;
        }
        if (call.function?.name) {
          existing.name = call.function.name;
        }
        if (call.function?.arguments) {
          existing.args += call.function.arguments;
        }
        pending.set(index, existing);
      }
      if (choice.finish_reason === 'tool_calls') {
        finish = 'tool_call';
      } else if (choice.finish_reason === 'length') {
        finish = 'length';
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

    if (req.signal?.aborted) {
      finish = 'aborted';
    }
    onEvent({ type: 'done', finishReason: finish });
  }
}
