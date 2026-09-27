import type {
  AgentPhase,
  ApprovalRequestView,
  ChatMessage,
  CheckpointView,
  ContextAttachment,
  ContextSummaryView,
  ConversationSummary,
  McpServerStatusView,
  MentionItem,
  ModelInfo,
  ProviderStatusView,
  SettingsView,
  ToolCallView,
  WorkspaceSummary
} from '../types.js';

/** Events the extension host pushes to the webview. Discriminated on `type`. */
export type ExtensionEvent =
  | { type: 'hydrate'; state: HydrateState }
  | { type: 'settingsUpdated'; settings: SettingsView }
  | { type: 'providersUpdated'; providers: ProviderStatusView[]; models: ModelInfo[] }
  | { type: 'workspaceUpdated'; workspace: WorkspaceSummary }
  | { type: 'conversationLoaded'; conversationId: string; title: string; messages: ChatMessage[] }
  | { type: 'conversationsList'; conversations: ConversationSummary[] }
  | { type: 'messageAppended'; message: ChatMessage }
  | { type: 'assistantStarted'; messageId: string }
  | { type: 'assistantChunk'; messageId: string; delta: string }
  | { type: 'assistantCompleted'; messageId: string; text: string }
  | { type: 'phaseChanged'; phase: AgentPhase; label: string }
  | { type: 'toolStarted'; messageId: string; call: ToolCallView }
  | { type: 'toolCompleted'; messageId: string; call: ToolCallView }
  | { type: 'toolApprovalRequired'; messageId: string; request: ApprovalRequestView }
  | { type: 'toolApprovalResolved'; requestId: string; approved: boolean }
  | { type: 'planRequired'; plan: import('../types.js').PlanView }
  | { type: 'planResolved'; planId: string }
  | { type: 'attachmentsUpdated'; attachments: ContextAttachment[] }
  | { type: 'contextUpdated'; summary: ContextSummaryView }
  | { type: 'checkpointsUpdated'; checkpoints: CheckpointView[] }
  | { type: 'agentCompleted'; conversationId: string }
  | { type: 'agentError'; message: string; hint?: string; retryable: boolean }
  | { type: 'mentionResults'; requestId: string; items: MentionItem[] }
  | { type: 'notification'; level: 'info' | 'warn' | 'error'; message: string }
  | { type: 'focusComposer'; prefill?: string }
  | { type: 'showPanel'; panel: 'chat' | 'settings' | 'history' | 'context' | 'memory' }
  | { type: 'mcpServersUpdated'; servers: McpServerStatusView[] }
  | { type: 'memoryUpdated'; memory: import('../types.js').MemoryEntry[] };

export interface HydrateState {
  settings: SettingsView;
  providers: ProviderStatusView[];
  models: ModelInfo[];
  workspace: WorkspaceSummary;
  conversationId: string;
  title: string;
  messages: ChatMessage[];
  attachments: ContextAttachment[];
  conversations: ConversationSummary[];
  checkpoints: CheckpointView[];
  phase: AgentPhase;
  mcpServers: McpServerStatusView[];
  memory: import('../types.js').MemoryEntry[];
}
