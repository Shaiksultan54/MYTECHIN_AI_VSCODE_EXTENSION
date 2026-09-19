import { OpenAICompatibleProvider } from '../openai-compatible/OpenAICompatibleProvider.js';

/** OpenRouter provider (OpenAI compatible). */
export class OpenRouterProvider extends OpenAICompatibleProvider {
  override readonly id = 'openrouter';
  override readonly name = 'OpenRouter';
  override readonly isCloud = true;
  override readonly requiresSecret = true;

  protected override defaultBaseUrl = 'https://openrouter.ai/api/v1';

  protected override headers(): Record<string, string> {
    return {
      ...super.headers(),
      'HTTP-Referer': 'https://github.com/mytechin/mytechin-ai',
      'X-Title': 'Mytechin AI',
    };
  }
}
