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

      if (m.role === 'assistant') {
        const match = /<tool\s+name=["']?([^"'>]+)["']?>\n([\s\S]*?)\n<\/tool>/.exec(m.content);
        if (match) {
          const text = m.content.slice(0, match.index).trim();
          const name = match[1];
          let input = {};
          try {
            input = JSON.parse(match[2] || '{}');
          } catch {
            input = { _raw: match[2] };
          }
          const id = `tool_${nextToolId++}`;
          messages.push({
            role: 'assistant',
            content: [
              ...(text ? [{ type: 'text', text }] : []),
              { type: 'tool_use', id, name, input }
            ]
          });
        } else {
          messages.push({ role: 'assistant', content: m.content });
        }
      } else if (m.role === 'tool') {
        const id = `tool_${nextToolId - 1}`;
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
        messages.push({ role: 'user', content: m.content });
      }
    }

    const body: Record<string, unknown> = {
      model: req.model,
      messages,
      stream: true,
      max_tokens: req.maxTokens ?? 4096,
      temperature: req.temperature ?? 0.2
    };
    if (req.system) {
      body.system = req.system;
    }
    if (req.tools?.length) {
      body.tools = req.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters
      }));
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
