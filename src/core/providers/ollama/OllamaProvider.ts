import { BaseProvider } from '../AIProvider.js';
import { joinUrl, readLines, request } from '../http.js';
import {
  ProviderError,
  type AIRequest,
  type AIStreamEvent,
  type ModelInfo,
  type ProviderStatus
} from '../ProviderTypes.js';

interface OllamaTag {
  name: string;
  details?: { parameter_size?: string; family?: string };
}

interface OllamaChunk {
  message?: {
    content?: string;
    thinking?: string;
    tool_calls?: { function?: { name?: string; arguments?: unknown } }[];
  };
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

/** Local Ollama server. The default provider: nothing leaves the machine. */
export class OllamaProvider extends BaseProvider {
  readonly id = 'ollama';
  readonly name = 'Ollama';
  readonly isCloud = false;
  readonly requiresSecret = false;

  private toolCapable = false;

  private get endpoint(): string {
    return this.config.endpoint?.trim() || 'http://127.0.0.1:11434';
  }

  async listModels(): Promise<ModelInfo[]> {
    const response = await request(joinUrl(this.endpoint, '/api/tags'), { timeoutMs: 8000 });
    const data = (await response.json()) as { models?: OllamaTag[] };
    return (data.models ?? []).map((model) => ({
      id: model.name,
      name: model.details?.parameter_size
        ? `${model.name} (${model.details.parameter_size})`
        : model.name,
      supportsTools: OllamaProvider.likelyToolCapable(model.name)
    }));
  }

  async testConnection(): Promise<ProviderStatus> {
    try {
      const response = await request(joinUrl(this.endpoint, '/api/version'), { timeoutMs: 4000 });
      const data = (await response.json()) as { version?: string };
      const models = await this.listModels().catch(() => [] as ModelInfo[]);
      if (models.length === 0) {
        return {
          state: 'error',
          message: `Ollama ${data.version ?? ''} is running but has no models. Run "ollama pull qwen2.5-coder" first.`
        };
      }
      return { state: 'connected', message: `Ollama ${data.version ?? ''} · ${models.length} models` };
    } catch (error) {
      const hint =
        error instanceof ProviderError && error.kind === 'unavailable'
          ? 'Ollama is not running. Start it and try again.'
          : (error as Error).message;
      return { state: 'error', message: hint };
    }
  }

  override supportsTools(): boolean {
    return this.toolCapable;
  }

  override supportsReasoning(): boolean {
    return true;
  }

  async stream(req: AIRequest, onEvent: (event: AIStreamEvent) => void): Promise<void> {
    if (!req.model) {
      throw new ProviderError('not-configured', 'No Ollama model selected.', 'Pick a model in the sidebar.');
    }
    this.toolCapable = OllamaProvider.likelyToolCapable(req.model);

    const messages: any[] = req.system ? [{ role: 'system', content: req.system }] : [];
    for (const m of req.messages) {
      if (m.role === 'assistant' && this.toolCapable) {
        const match = /<tool\s+name=["']?([^"'>]+)["']?>\n([\s\S]*?)\n<\/tool>/.exec(m.content);
        if (match) {
          const text = m.content.slice(0, match.index).trim();
          let args = {};
          try {
            args = JSON.parse(match[2] || '{}');
          } catch {
            args = { _raw: match[2] };
          }
          messages.push({
            role: 'assistant',
            content: text,
            tool_calls: [{ function: { name: match[1], arguments: args } }]
          });
          continue;
        }
      }
      messages.push({
        role: m.role === 'tool' ? 'tool' : m.role,
        content: m.content
      });
    }

    const body: Record<string, unknown> = {
      model: req.model,
      messages,
      stream: true,
      options: {
        temperature: req.temperature ?? 0.2,
        num_predict: req.maxTokens ?? 4096
      }
    };
    if (req.tools?.length && this.toolCapable) {
      body.tools = req.tools.map((tool) => ({
        type: 'function',
        function: { name: tool.name, description: tool.description, parameters: tool.parameters }
      }));
    }

    const response = await request(joinUrl(this.endpoint, '/api/chat'), {
      method: 'POST',
      body,
      signal: req.signal,
      timeoutMs: 0x7fffffff
    });

    let finish: 'stop' | 'length' | 'tool_call' | 'aborted' = 'stop';
    let callIndex = 0;

    for await (const line of readLines(response, req.signal)) {
      if (!line.trim()) {
        continue;
      }
      let chunk: OllamaChunk;
      try {
        chunk = JSON.parse(line) as OllamaChunk;
      } catch {
        continue;
      }

      if (chunk.error) {
        if (/not found|no such model/i.test(chunk.error)) {
          throw new ProviderError(
            'model-not-found',
            `Ollama does not have the model "${req.model}".`,
            `Run "ollama pull ${req.model}" or pick a different model.`
          );
        }
        throw new ProviderError('bad-response', chunk.error);
      }

      if (chunk.message?.thinking) {
        onEvent({ type: 'reasoning', delta: chunk.message.thinking });
      }
      if (chunk.message?.content) {
        onEvent({ type: 'text', delta: chunk.message.content });
      }
      for (const call of chunk.message?.tool_calls ?? []) {
        const args = call.function?.arguments;
        onEvent({
          type: 'tool_call',
          call: {
            id: `ollama-${Date.now()}-${callIndex++}`,
            name: call.function?.name ?? 'unknown',
            arguments:
              typeof args === 'string'
                ? (JSON.parse(args) as Record<string, unknown>)
                : ((args ?? {}) as Record<string, unknown>)
          }
        });
        finish = 'tool_call';
      }

      if (chunk.done) {
        if (chunk.done_reason === 'length') {
          finish = 'length';
        }
        onEvent({
          type: 'usage',
          promptTokens: chunk.prompt_eval_count,
          completionTokens: chunk.eval_count
        });
      }
    }

    if (req.signal?.aborted) {
      finish = 'aborted';
    }
    onEvent({ type: 'done', finishReason: finish });
  }

  /**
   * Ollama advertises tool support per model but not through /api/tags, so this
   * is a name heuristic. When it is wrong the agent falls back to the text tool
   * protocol, which works on every model.
   */
  private static likelyToolCapable(model: string): boolean {
    return /llama3\.[123]|llama4|mistral|mixtral|firefunction|command-r|hermes3|devstral|granite|smollm2/i.test(
      model
    );
  }
}
