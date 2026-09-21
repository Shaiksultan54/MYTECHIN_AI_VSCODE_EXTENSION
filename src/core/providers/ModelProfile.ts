import type { ProviderId } from '../../shared/types.js';

export type ToolCallDialect = 'native-openai' | 'native-anthropic' | 'native-gemini' | 'xml-tags' | 'json-wrapped';
export type EditModePreference = 'unified-patch' | 'find-replace-block' | 'whole-file';

export interface ModelCapabilityMetadata {
  supportsStreaming: boolean;
  supportsTools: boolean;
  supportsParallelTools: boolean;
  supportsVision: boolean;
  supportsReasoning: boolean;
  supportsLargeContext: boolean;
  supportsPatchEditing: boolean;
  supportsStructuredOutput: boolean;
  supportsEmbeddings: boolean;
  maxContext: number;
  maxOutput: number;
}

export interface ModelProfile {
  id: string;
  name: string;
  family: 'openai' | 'anthropic' | 'gemini' | 'ollama' | 'omniroute' | 'generic';
  capabilities: ModelCapabilityMetadata;
  dialect: ToolCallDialect;
  preferredEditMode: EditModePreference;
}

export class ModelProfileRegistry {
  private static readonly PROFILES: Record<string, ModelProfile> = {
    // OpenAI family
    'openai-codex': {
      id: 'openai-codex',
      name: 'OpenAI / Codex Profile',
      family: 'openai',
      capabilities: {
        supportsStreaming: true,
        supportsTools: true,
        supportsParallelTools: true,
        supportsVision: true,
        supportsReasoning: true,
        supportsLargeContext: true,
        supportsPatchEditing: true,
        supportsStructuredOutput: true,
        supportsEmbeddings: true,
        maxContext: 128000,
        maxOutput: 4096
      },
      dialect: 'native-openai',
      preferredEditMode: 'unified-patch'
    },

    // Anthropic Claude family
    'anthropic-claude': {
      id: 'anthropic-claude',
      name: 'Anthropic Claude Profile',
      family: 'anthropic',
      capabilities: {
        supportsStreaming: true,
        supportsTools: true,
        supportsParallelTools: true,
        supportsVision: true,
        supportsReasoning: true,
        supportsLargeContext: true,
        supportsPatchEditing: true,
        supportsStructuredOutput: false,
        supportsEmbeddings: false,
        maxContext: 200000,
        maxOutput: 8192
      },
      dialect: 'native-anthropic',
      preferredEditMode: 'find-replace-block'
    },

    // Google Gemini family
    'google-gemini': {
      id: 'google-gemini',
      name: 'Google Gemini Profile',
      family: 'gemini',
      capabilities: {
        supportsStreaming: true,
        supportsTools: true,
        supportsParallelTools: true,
        supportsVision: true,
        supportsReasoning: true,
        supportsLargeContext: true,
        supportsPatchEditing: true,
        supportsStructuredOutput: true,
        supportsEmbeddings: true,
        maxContext: 1000000,
        maxOutput: 8192
      },
      dialect: 'native-gemini',
      preferredEditMode: 'unified-patch'
    },

    // Local Ollama family
    'local-ollama': {
      id: 'local-ollama',
      name: 'Local Ollama Profile',
      family: 'ollama',
      capabilities: {
        supportsStreaming: true,
        supportsTools: true,
        supportsParallelTools: false,
        supportsVision: false,
        supportsReasoning: true,
        supportsLargeContext: false,
        supportsPatchEditing: true,
        supportsStructuredOutput: false,
        supportsEmbeddings: true,
        maxContext: 32768,
        maxOutput: 4096
      },
      dialect: 'xml-tags',
      preferredEditMode: 'find-replace-block'
    },

    // OmniRoute Gateway family
    'omniroute-routed': {
      id: 'omniroute-routed',
      name: 'OmniRoute Gateway Profile',
      family: 'omniroute',
      capabilities: {
        supportsStreaming: true,
        supportsTools: true,
        supportsParallelTools: true,
        supportsVision: true,
        supportsReasoning: true,
        supportsLargeContext: true,
        supportsPatchEditing: true,
        supportsStructuredOutput: true,
        supportsEmbeddings: true,
        maxContext: 128000,
        maxOutput: 4096
      },
      dialect: 'native-openai',
      preferredEditMode: 'find-replace-block'
    }
  };

  static profileFor(providerId: ProviderId, modelId = ''): ModelProfile {
    const mid = modelId.toLowerCase();

    if (providerId === 'anthropic' || mid.includes('claude')) {
      return this.PROFILES['anthropic-claude'];
    }
    if (providerId === 'gemini' || mid.includes('gemini')) {
      return this.PROFILES['google-gemini'];
    }
    if (providerId === 'omniroute') {
      return this.PROFILES['omniroute-routed'];
    }
    if (providerId === 'ollama') {
      return this.PROFILES['local-ollama'];
    }
    if (providerId === 'openai') {
      return this.PROFILES['openai-codex'];
    }

    return this.PROFILES['openai-codex'];
  }
}
