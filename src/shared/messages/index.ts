import type { ApprovalMode, ContextAttachment, ProviderId } from '../types.js';

/** Messages the webview sends to the extension host. Discriminated on `type`. */
export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'sendPrompt'; text: string }
  | { type: 'stopAgent' }
  | { type: 'newConversation' }
  | { type: 'loadConversation'; conversationId: string }
  | { type: 'deleteConversation'; conversationId: string }
  | { type: 'renameConversation'; conversationId: string; title: string }
  | { type: 'listConversations'; query?: string }
  | { type: 'pickAttachment'; kind: 'file' | 'folder' }
  | { type: 'attachSpecial'; kind: 'currentFile' | 'selection' | 'problems' | 'terminal' }
  | { type: 'attachUris'; uris: string[] }
  | { type: 'attachPastedCode'; text: string; language?: string }
  | { type: 'attachDataUrl'; name: string; dataUrl: string; mimeType: string }
  | { type: 'removeAttachment'; attachmentId: string }
  | { type: 'clearAttachments' }
  | { type: 'approveTool'; requestId: string; approved: boolean; rememberForTask?: boolean }
  | { type: 'selectProvider'; providerId: ProviderId }
  | { type: 'selectModel'; modelId: string }
  | { type: 'refreshModels' }
  | { type: 'testConnection'; providerId?: ProviderId }
  | { type: 'saveSettings'; patch: Partial<SettingsPatch> }
  | { type: 'setSecret'; providerId: ProviderId }
  | { type: 'clearSecret'; providerId: ProviderId }
  | { type: 'searchMentions'; query: string; requestId: string }
  | { type: 'openFile'; uri: string; line?: number }
  | { type: 'openDiff'; uri: string; patch: string; title?: string }
  | { type: 'requestContext' }
  | { type: 'restoreCheckpoint'; checkpointId: string }
  | { type: 'compareCheckpoint'; checkpointId: string }
  | { type: 'openExtensionSettings' }
  | { type: 'showLogs' }
  | { type: 'addMcpServer'; config: import('../types.js').McpServerConfig }
  | { type: 'removeMcpServer'; id: string }
  | { type: 'toggleMcpServer'; id: string; disabled: boolean }
  | { type: 'restartMcpServer'; id: string }
  | { type: 'rebuildSemanticIndex' }
  | { type: 'getMemory' }
  | { type: 'addMemory'; category: string; content: string }
  | { type: 'updateMemory'; id: string; content: string }
  | { type: 'removeMemory'; id: string };

export interface SettingsPatch {
  provider: ProviderId;
  model: string;
  ollamaEndpoint: string;
  openaiCompatibleBaseUrl: string;
  openaiCompatibleOrganization: string;
  puterBaseUrl: string;
  omniRouteBaseUrl?: string;
  approvalMode: ApprovalMode;
  autoApproveSafeTools: boolean;
  maxToolIterations: number;
  maxContextTokens: number;
  temperature: number;
  maxTokens: number;
  streaming: boolean;
  enableCheckpoints: boolean;
}

export type AttachmentDraft = Omit<ContextAttachment, 'id' | 'status'> &
  Partial<Pick<ContextAttachment, 'id' | 'status'>>;
