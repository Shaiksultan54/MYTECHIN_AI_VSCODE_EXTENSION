import { OpenAICompatibleProvider } from '../openai-compatible/OpenAICompatibleProvider.js';

/** GitHub Models API provider (OpenAI compatible). */
export class GitHubProvider extends OpenAICompatibleProvider {
  override readonly id = 'github';
  override readonly name = 'GitHub Models';
  override readonly isCloud = true;
  override readonly requiresSecret = true;

  protected override defaultBaseUrl = 'https://models.inference.ai.azure.com';
}
