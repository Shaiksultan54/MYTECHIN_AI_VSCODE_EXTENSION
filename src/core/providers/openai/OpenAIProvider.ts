import { OpenAICompatibleProvider } from '../openai-compatible/OpenAICompatibleProvider.js';

/** OpenAI proper. Same wire format, fixed base URL, curated model list. */
export class OpenAIProvider extends OpenAICompatibleProvider {
  override readonly id = 'openai';
  override readonly name = 'OpenAI';
  override readonly isCloud = true;
  override readonly requiresSecret = true;

  protected override defaultBaseUrl = 'https://api.openai.com/v1';

  override async listModels() {
    const models = await super.listModels();
    // Chat-capable ids only; the /models list also returns embeddings and audio.
    const chat = models.filter((m) => /^(gpt|o[13-9]|chatgpt)/i.test(m.id));
    return chat.length > 0 ? chat : models;
  }
}
