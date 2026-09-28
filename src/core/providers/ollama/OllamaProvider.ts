import { BaseProvider } from '../AIProvider.js';
import { joinUrl, readLines, request } from '../http.js';
import {
  FillInMiddleUnsupportedError,
  type FillInMiddleCapable,
  type FillInMiddleRequest
} from '../FillInMiddle.js';
import {
  ProviderError,
  type AIRequest,
  type AIStreamEvent,
  type ModelInfo,
  type ProviderStatus
} from '../ProviderTypes.js';

/** `<tool name="x" id="y">{json}</tool>`; the id attribute is absent in transcripts saved before parallel calls. */
const TOOL_BLOCK = /<tool\s+name=["']?([^"'>\s]+)["']?(?:\s+id=["']?([^"'>\s]+)["']?)?\s*>\n?([\s\S]*?)\n?<\/tool>/g;

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

const FIM_MODELS = /coder|codellama|codegemma|codestral|starcoder|stable-code|granite-code|codeqwen/i;
const NO_INSERT = /does not support insert|support.*suffix/i;

/** Local Ollama server. The default provider: nothing leaves the machine. */
export class OllamaProvider extends BaseProvider implements FillInMiddleCapable {
  readonly id = 'ollama';
  readonly name = 'Ollama';
  readonly isCloud = false;
  readonly requiresSecret = false;

  private toolCapable = false;
  private readonly noInsert = new Set<string>();

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

  override supportsVision(): boolean {
    return true;
  }

  supportsFillInMiddle(model: string): boolean {
    return FIM_MODELS.test(model) && !this.noInsert.has(model);
  }

  async fillInMiddle(req: FillInMiddleRequest, onText: (delta: string) => void): Promise<void> {
    if (!req.model) {
      throw new ProviderError('not-configured', 'No Ollama model selected.', 'Pick a model in the sidebar.');
    }
    const unsupported = (): FillInMiddleUnsupportedError => {
      this.noInsert.add(req.model);
      return new FillInMiddleUnsupportedError(req.model);
    };

    let response: Response;
    try {
      response = await request(joinUrl(this.endpoint, '/api/generate'), {
        method: 'POST',
        body: {
          model: req.model,
          prompt: req.prefix,
          suffix: req.suffix,
          stream: true,
          options: { temperature: req.temperature ?? 0.1, num_predict: req.maxTokens ?? 128 }
        },
        signal: req.signal,
        timeoutMs: 0x7fffffff,
        retries: 0
      });
    } catch (error) {
      if (error instanceof ProviderError && NO_INSERT.test(`${error.message} ${error.hint ?? ''}`)) {
        throw unsupported();
      }
      throw error;
    }

    for await (const line of readLines(response, req.signal)) {
      if (!line.trim()) continue;
      let chunk: { response?: string; done?: boolean; error?: string };
      try {
        chunk = JSON.parse(line) as typeof chunk;
      } catch {
        continue;
      }
      if (chunk.error) {
        if (NO_INSERT.test(chunk.error)) throw unsupported();
        if (/not found|no such model/i.test(chunk.error)) {
          throw new ProviderError(
            'model-not-found',
            `Ollama does not have the model "${req.model}".`,
            `Run "ollama pull ${req.model}" or pick a different model.`
          );
        }
        throw new ProviderError('bad-response', chunk.error);
      }
      if (chunk.response) onText(chunk.response);
      if (chunk.done) break;
    }
  }

  async stream(req: AIRequest, onEvent: (event: AIStreamEvent) => void): Promise<void> {
    if (!req.model) {
      throw new ProviderError('not-configured', 'No Ollama model selected.', 'Pick a model in the sidebar.');
    }
    this.toolCapable = OllamaProvider.likelyToolCapable(req.model);

    const messages: any[] = req.system ? [{ role: 'system', content: req.system }] : [];
    for (const m of req.messages) {
      let contentString = '';
      const images: string[] = [];

      if (Array.isArray(m.content)) {
        for (const part of m.content) {
          if (part.type === 'text') {
            contentString += part.text + '\n';
          } else if (part.type === 'image_url') {
            const match = /^data:(image\/[a-z+]+);base64,(.*)$/.exec(part.image_url.url);
            if (match) {
              images.push(match[2]);
            }
          }
        }
      } else {
        contentString = m.content;
      }

      if (m.role === 'assistant' && this.toolCapable) {
        // Several tool blocks can share one assistant turn (parallel calls).
        // Ollama pairs results with calls by order, and results are recorded
        // in the order the calls were made.
        const calls: Array<{ function: { name: string; arguments: Record<string, unknown> } }> = [];
        let firstIndex = -1;
        for (const match of contentString.matchAll(TOOL_BLOCK)) {
          if (firstIndex === -1) firstIndex = match.index ?? 0;
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(match[3] || '{}');
          } catch {
            args = { _raw: match[3] };
          }
          calls.push({ function: { name: match[1], arguments: args } });
        }
        if (calls.length > 0) {
          messages.push({
            role: 'assistant',
            content: contentString.slice(0, firstIndex).trim(),
            tool_calls: calls
          });
          continue;
        }
      }

      const msg: any = {
        role: m.role === 'tool' ? 'tool' : m.role,
        content: contentString.trim()
      };
      if (images.length > 0) {
        msg.images = images;
      }
      messages.push(msg);
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
    return /llama3\.[123]|llama4|mistral|mixtral|firefunction|command-r|hermes3|devstral|granite|smollm2|qwen/i.test(
      model
    );
  }
}
