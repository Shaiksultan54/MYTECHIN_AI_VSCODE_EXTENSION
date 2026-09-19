import { OpenAICompatibleProvider } from '../openai-compatible/OpenAICompatibleProvider.js';

/** Groq API provider (OpenAI compatible). */
export class GroqProvider extends OpenAICompatibleProvider {
  override readonly id = 'groq';
  override readonly name = 'Groq';
  override readonly isCloud = true;
  override readonly requiresSecret = true;

  protected override defaultBaseUrl = 'https://api.groq.com/openai/v1';

  override async listModels() {
    const models = await super.listModels();
    return models.filter((m) => !m.id.includes('whisper'));
  }
}
