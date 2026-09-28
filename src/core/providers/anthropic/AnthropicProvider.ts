import { BaseProvider } from '../AIProvider.js';
import { joinUrl, readLines, request } from '../http.js';
import {
  ProviderError,
  type AIRequest,
  type AIStreamEvent,
  type ModelInfo,
  type ProviderStatus
} from '../ProviderTypes.js';

const API_VERSION = '2023-06-01';

/** `<tool name="x" id="y">{json}</tool>`; the id attribute is absent in transcripts saved before parallel calls. */
const TOOL_BLOCK = /<tool\s+name=["']?([^"'>\s]+)["']?(?:\s+id=["']?([^"'>\s]+)["']?)?\s*>\n?([\s\S]*?)\n?<\/tool>/g;

/** Results for one assistant turn's tool calls belong in a single user message. */
function mergeToolResults(messages: any[]): any[] {
  const isToolResults = (m: any): boolean =>
    m.role === 'user' &&
    Array.isArray(m.content) &&
    m.content.length > 0 &&
    m.content.every((b: any) => b?.type === 'tool_result');
  const merged: any[] = [];
  for (const m of messages) {
    const prev = merged[merged.length - 1];
    if (prev && isToolResults(prev) && isToolResults(m)) {
      prev.content = [...prev.content, ...m.content];
    } else {
      merged.push(m);
    }
  }
  return merged;
}

/**
 * Marks the last content block of the second-to-last message with an
 * ephemeral cache breakpoint. In an agent loop the transcript only grows â€”
 * every turn appends a tool call and its result â€” so everything up to (but
 * not including) the newest message is stable and worth caching. The newest
 * message is left alone since it changes every turn and would never hit.
 * Combined with the system-prompt and tools breakpoints, a long-running task
 * re-processes only the newest turn instead of the whole growing transcript,
 * which is most of the latency and cost win in a multi-step agent session.
 */
function applyCacheBreakpoints(messages: Array<{ content: unknown }>): void {
  if (messages.length < 2) {
    return;
  }
  const target = messages[messages.length - 2];
  if (typeof target.content === 'string') {
    target.content = [{ type: 'text', text: target.content, cache_control: { type: 'ephemeral' } }];
    return;
  }
  if (Array.isArray(target.content) && target.content.length > 0) {
    const lastBlock = target.content[target.content.length - 1] as Record<string, unknown> | undefined;
    if (lastBlock && typeof lastBlock === 'object') {
      lastBlock.cache_control = { type: 'ephemeral' };
    }
  }
}

/** Anthropic Messages API with SSE streaming and native tool calls. */
export class AnthropicProvider extends BaseProvider {
  readonly id = 'anthropic';
  readonly name = 'Anthropic';
  readonly isCloud = true;
  readonly requiresSecret = true;

  private get baseUrl(): string {
    return (this.config.baseUrl?.trim() || 'https://api.anthropic.com').replace(/\/+$/, '');
  }

  private headers(): Record<string, string> {
    return {
      'x-api-key': this.config.apiKey ?? '',
      'anthropic-version': API_VERSION
    };
  }

  private assertConfigured(): void {
    if (!this.config.apiKey) {
      throw new ProviderError(
        'not-configured',
        'Anthropic has no API key.',
        'Add an API key in provider settings. It is stored in the VS Code secret store.'
      );
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    this.assertConfigured();
    const response = await request(joinUrl(this.baseUrl, '/v1/models?limit=100'), {
      headers: this.headers(),
      timeoutMs: 15000
    });
    const data = (await response.json()) as { data?: { id: string; display_name?: string }[] };
    return (data.data ?? []).map((model) => ({
      id: model.id,
      name: model.display_name ?? model.id,
      supportsTools: true,
      supportsVision: true
    }));
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
  override supportsReasoning(): boolean {
    return true;
  }

  async stream(req: AIRequest, onEvent: (event: AIStreamEvent) => void): Promise<void> {
    this.assertConfigured();
    if (!req.model) {
      throw new ProviderError('not-configured', 'No Anthropic model selected.', 'Pick a model in the sidebar.');
    }

    // The Messages API has no `tool` role: results go back as user turns.
    const messages: any[] = [];
    let nextToolId = 1;

    for (const m of req.messages) {
      if (m.role === 'system') continue;

      let textContent = '';
      if (typeof m.content === 'string') {
        textContent = m.content;
      } else if (Array.isArray(m.content)) {
        for (const part of m.content) {
          if (part.type === 'text') {
            textContent += part.text + '\n';
          }
        }
      }

      if (m.role === 'assistant' && this.supportsTools()) {
        // A turn may carry several tool blocks (parallel calls). Each has its
        // own id so results pair back correctly; blocks saved before ids
        // existed fall back to a counter, which is right for one call per turn.
        const blocks: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
        let firstIndex = -1;
        for (const match of textContent.matchAll(TOOL_BLOCK)) {
          if (firstIndex === -1) firstIndex = match.index ?? 0;
          let input: Record<string, unknown> = {};
          try {
            input = JSON.parse(match[3] || '{}');
          } catch {
            input = { _raw: match[3] };
          }
          blocks.push({ id: match[2] ?? `tool_${nextToolId++}`, name: match[1], input });
        }
        if (blocks.length > 0) {
          const text = textContent.slice(0, firstIndex).trim();
          messages.push({
            role: 'assistant',
            content: [
              ...(text ? [{ type: 'text', text }] : []),
              ...blocks.map((b) => ({ type: 'tool_use', id: b.id, name: b.name, input: b.input }))
            ]
          });
        } else {
          messages.push({ role: 'assistant', content: m.content });
        }
      } else if (m.role === 'tool') {
        const id = m.toolCallId ?? `tool_${nextToolId - 1}`;
        messages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: id,
              content: m.content
            }
          ]
        });
      } else {
        if (Array.isArray(m.content)) {
          const content = m.content.map((part) => {
            if (part.type === 'text') {
              return { type: 'text', text: part.text };
            } else if (part.type === 'image_url') {
              const match = /^data:(image\/[a-z+]+);base64,(.*)$/.exec(part.image_url.url);
              if (match) {
                return {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: match[1],
                    data: match[2]
                  }
                };
              }
            }
            return part;
          });
          messages.push({ role: 'user', content });
        } else {
          messages.push({ role: 'user', content: m.content });
        }
      }
    }

    const merged = mergeToolResults(messages);
    applyCacheBreakpoints(merged);

    const body: Record<string, unknown> = {
      model: req.model,
      messages: merged,
      stream: true,
      max_tokens: req.maxTokens ?? 4096,
      temperature: req.temperature ?? 0.2
    };
    if (req.system) {
      // A structured block (rather than a bare string) lets us mark it
      // cache_control. The system prompt is rebuilt fresh most turns but its
      // *content* â€” tool docs, project rules, workspace summary â€” is stable
      // for many turns in a row, so caching it cuts latency and cost on
      // every follow-up message in the same task.
      body.system = [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }];
    }
    if (req.tools?.length) {
      const tools = req.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters
      }));
      // Tool definitions don't change within a task. Caching the block up to
      // and including the last tool means the (often large) combined tool
      // schema is only billed and re-processed once per cache window.
      (tools[tools.length - 1] as Record<string, unknown>).cache_control = { type: 'ephemeral' };
      body.tools = tools;
    }

    const response = await request(joinUrl(this.baseUrl, '/v1/messages'), {
      method: 'POST',
      headers: this.headers(),
      body,
      signal: req.signal,
      timeoutMs: 0x7fffffff
    });

    let finish: 'stop' | 'length' | 'tool_call' | 'aborted' = 'stop';
    let activeTool: { id: string; name: string; json: string } | undefined;

    for await (const line of readLines(response, req.signal)) {
      if (!line.startsWith('data:')) {
        continue;
      }
      let event: any;
      try {
        event = JSON.parse(line.slice(5).trim());
      } catch {
        continue;
      }

      switch (event.type) {
        case 'content_block_start':
          if (event.content_block?.type === 'tool_use') {
            activeTool = { id: event.content_block.id, name: event.content_block.name, json: '' };
          }
          break;
        case 'content_block_delta':
          if (event.delta?.type === 'text_delta') {
            onEvent({ type: 'text', delta: event.delta.text });
          } else if (event.delta?.type === 'thinking_delta') {
            onEvent({ type: 'reasoning', delta: event.delta.thinking });
          } else if (event.delta?.type === 'input_json_delta' && activeTool) {
            activeTool.json += event.delta.partial_json ?? '';
          }
          break;
        case 'content_block_stop':
          if (activeTool) {
            let args: Record<string, unknown> = {};
            try {
              args = activeTool.json ? JSON.parse(activeTool.json) : {};
            } catch {
              args = { _raw: activeTool.json };
            }
            onEvent({ type: 'tool_call', call: { id: activeTool.id, name: activeTool.name, arguments: args } });
            finish = 'tool_call';
            activeTool = undefined;
          }
          break;
        case 'message_delta':
          if (event.delta?.stop_reason === 'max_tokens') {
            finish = 'length';
          }
          if (event.usage) {
            onEvent({ type: 'usage', completionTokens: event.usage.output_tokens });
          }
          break;
        case 'error':
          throw new ProviderError('bad-response', event.error?.message ?? 'Anthropic returned an error.');
        default:
          break;
      }
    }

    if (req.signal?.aborted) {
      finish = 'aborted';
    }
    onEvent({ type: 'done', finishReason: finish });
  }
}
