import { OpenAICompatibleProvider } from '../openai-compatible/OpenAICompatibleProvider.js';

/** Google Gemini provider using the official OpenAI compatibility layer. */
export class GeminiProvider extends OpenAICompatibleProvider {
  override readonly id = 'gemini';
  override readonly name = 'Google Gemini';
  override readonly isCloud = true;
  override readonly requiresSecret = true;

  protected override defaultBaseUrl = 'https://generativelanguage.googleapis.com/v1beta/openai/';

  override async listModels() {
    const models = await super.listModels();
    const chat = models.filter((m) => m.id.toLowerCase().includes('gemini'));
    return chat.length > 0 ? chat : models;
  }
}
