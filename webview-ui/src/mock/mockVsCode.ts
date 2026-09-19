import type { ExtensionEvent, HydrateState } from '../../../src/shared/events/index.js';
import type { WebviewMessage } from '../../../src/shared/messages/index.js';

let mockState: HydrateState = {
  settings: {
    provider: 'ollama',
    model: 'llama3:latest',
    ollamaEndpoint: 'http://127.0.0.1:11434',
    puterBaseUrl: 'https://api.puter.com',
    openaiCompatibleBaseUrl: '',
    openaiCompatibleOrganization: '',
    approvalMode: 'askForRisky',
    autoApproveSafeTools: true,
    maxToolIterations: 24,
    maxContextTokens: 32000,
    maxFileReadBytes: 262144,
    temperature: 0.2,
    maxTokens: 4096,
    streaming: true,
    enableWorkspaceIndex: true,
    enableCheckpoints: true,
    loggingLevel: 'info',
    excludePatterns: [],
    terminalTimeout: 120000,
    warnOnSensitiveUpload: true,
    mcpConfigPath: '.mytechin/mcp.json',
    debugPuter: false
  },
  providers: [
    { id: 'ollama', name: 'Ollama (Local)', state: 'connected', isCloud: false, requiresSecret: false },
    { id: 'puter', name: 'Puter.js (Free Cloud)', state: 'connected', isCloud: true, requiresSecret: false },
    { id: 'openai', name: 'OpenAI', state: 'not-configured', isCloud: true, requiresSecret: true, hasSecret: false },
    { id: 'anthropic', name: 'Anthropic', state: 'not-configured', isCloud: true, requiresSecret: true, hasSecret: false },
    { id: 'gemini', name: 'Google Gemini', state: 'not-configured', isCloud: true, requiresSecret: true, hasSecret: false },
    { id: 'groq', name: 'Groq', state: 'not-configured', isCloud: true, requiresSecret: true, hasSecret: false },
    { id: 'openrouter', name: 'OpenRouter', state: 'not-configured', isCloud: true, requiresSecret: true, hasSecret: false },
    { id: 'github', name: 'GitHub Models', state: 'not-configured', isCloud: true, requiresSecret: true, hasSecret: false }
  ],
  models: [
    { id: 'llama3:latest', name: 'Llama 3 (8B)', provider: 'ollama', isFree: false, supportsTools: true, supportsVision: false, contextWindow: 8192 },
    { id: 'deepseek-coder-v2:latest', name: 'DeepSeek Coder V2', provider: 'ollama', isFree: false, supportsTools: true, supportsVision: false, contextWindow: 16384 },
    { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'puter', isFree: true, supportsTools: true, supportsVision: true, contextWindow: 200000 },
    { id: 'gpt-4o', name: 'GPT-4o', provider: 'puter', isFree: true, supportsTools: true, supportsVision: true, contextWindow: 128000 }
  ],
  workspace: {
    name: 'localcode-ai-source',
    folders: ['d:/zip/localcode-ai-source'],
    files: 128,
    sourceRoots: ['src', 'webview-ui'],
    languages: ['TypeScript', 'CSS', 'HTML'],
    frameworks: ['React', 'Vite']
  },
  conversationId: 'conv-mock-1',
  title: 'Development Preview',
  messages: [],
  attachments: [],
  conversations: [
    { id: 'conv-mock-1', title: 'Development Preview', updatedAt: Date.now() - 60000, messageCount: 0 },
    { id: 'conv-mock-0', title: 'Architecture Planning', updatedAt: Date.now() - 3600000, messageCount: 4 }
  ],
  checkpoints: [],
  phase: 'idle',
  mcpServers: [
    { id: 'filesystem', name: 'Local Filesystem', status: 'connected', toolCount: 4 },
    { id: 'github', name: 'GitHub Server', status: 'connected', toolCount: 6 }
  ],
  memory: [
    { id: 'm-1', content: 'Local Ollama is default provider, Puter for free cloud fallbacks', category: 'architecture', timestamp: Date.now() - 7200000 },
    { id: 'm-2', content: 'Use TypeScript strict mode and ES modules across all components', category: 'preference', timestamp: Date.now() - 3600000 }
  ]
};

function dispatchEvent(event: ExtensionEvent): void {
  window.postMessage(event, '*');
}

export function setupMockVsCode(): void {
  if (typeof window === 'undefined' || window.acquireVsCodeApi) {
    return;
  }

  console.info('[Mytechin AI] Running in browser standalone dev mode. Mock VS Code API active.');

  let savedState: Record<string, unknown> = {};

  window.acquireVsCodeApi = () => ({
    getState: () => savedState,
    setState: (newState: unknown) => {
      savedState = (newState as Record<string, unknown>) ?? {};
    },
    postMessage: (message: unknown) => {
      handleMockMessage(message as WebviewMessage);
    }
  });
}

function handleMockMessage(message: WebviewMessage): void {
  console.log('[Mock ExtensionHost Received]', message);

  switch (message.type) {
    case 'ready': {
      setTimeout(() => {
        dispatchEvent({ type: 'hydrate', state: mockState });
      }, 50);
      break;
    }

    case 'sendPrompt': {
      const userText = message.text;
      const turnId = `turn-${Date.now()}`;
      const userMsgId = `u_${Date.now()}`;
      const assistantMsgId = `a_${Date.now()}`;

      // 1. User message appended
      dispatchEvent({
        type: 'messageAppended',
        message: {
          id: userMsgId,
          role: 'user',
          text: userText,
          createdAt: Date.now()
        }
      });

      // 2. Start turn & enter thinking
      dispatchEvent({ type: 'turnStart', turnId });
      dispatchEvent({ type: 'phase', phase: 'thinking', label: 'Thinking…' });

      // 3. After a moment, switch to generating
      setTimeout(() => {
        dispatchEvent({ type: 'phase', phase: 'generating', label: 'Generating…' });

        // 4. Stream final assistant response
        setTimeout(() => {
          dispatchEvent({
            type: 'messageAppended',
            message: {
              id: assistantMsgId,
              role: 'assistant',
              text: `Hello! I received your message:\n> "${userText}"\n\nAll features are operating as expected in **production mode**:\n- **Single Generation Display**: Verified and clean.\n- **Provider & Model Status**: Ollama & Puter are ready.\n- **Project Memory**: Active.\n- **Real-Time Context**: Synced.\n\nLet me know what you'd like to build or inspect!`,
              createdAt: Date.now()
            }
          });
          dispatchEvent({ type: 'phase', phase: 'idle', label: '' });
          dispatchEvent({ type: 'turnEnd', turnId });
        }, 500);
      }, 500);
      break;
    }

    case 'selectModel': {
      mockState.settings.model = message.modelId;
      dispatchEvent({ type: 'settingsUpdated', settings: mockState.settings });
      dispatchEvent({
        type: 'notification',
        level: 'info',
        message: `Model set to ${message.modelId}. Connected.`
      });
      break;
    }

    case 'selectProvider': {
      mockState.settings.provider = message.providerId;
      const firstModel = mockState.models.find((m) => m.provider === message.providerId);
      mockState.settings.model = firstModel ? firstModel.id : '';
      dispatchEvent({ type: 'settingsUpdated', settings: mockState.settings });
      dispatchEvent({
        type: 'notification',
        level: 'info',
        message: `Switched provider to ${message.providerId}.`
      });
      break;
    }

    case 'testConnection': {
      dispatchEvent({
        type: 'notification',
        level: 'info',
        message: 'Connection to AI provider verified successfully.'
      });
      break;
    }

    case 'refreshModels': {
      dispatchEvent({ type: 'providersUpdated', providers: mockState.providers, models: mockState.models });
      dispatchEvent({
        type: 'notification',
        level: 'info',
        message: 'Model list refreshed.'
      });
      break;
    }

    case 'requestContext': {
      dispatchEvent({
        type: 'contextUpdated',
        summary: {
          totalTokens: 1420,
          budgetTokens: 32000,
          droppedCount: 0,
          items: [
            {
              kind: 'file',
              label: 'src/core/agent/AgentLoop.ts',
              tokens: 850,
              uri: 'file:///d:/zip/localcode-ai-source/src/core/agent/AgentLoop.ts',
              reason: 'Active editor file'
            },
            {
              kind: 'selection',
              label: 'lines 12–45',
              tokens: 570,
              reason: 'Selected function'
            }
          ]
        }
      });
      break;
    }

    case 'newConversation': {
      mockState.conversationId = `conv-${Date.now()}`;
      mockState.messages = [];
      dispatchEvent({
        type: 'conversationLoaded',
        conversationId: mockState.conversationId,
        title: 'New chat',
        messages: []
      });
      break;
    }

    case 'searchMentions': {
      dispatchEvent({
        type: 'mentionResults',
        requestId: message.requestId,
        items: [
          { kind: 'file', label: 'src/extension.ts', detail: 'Extension entrypoint', insert: 'src/extension.ts' },
          { kind: 'file', label: 'src/core/agent/AgentLoop.ts', detail: 'Autonomous agent loop', insert: 'src/core/agent/AgentLoop.ts' },
          { kind: 'folder', label: 'src', detail: 'Source folder', insert: 'src/' }
        ]
      });
      break;
    }

    default:
      break;
  }
}
