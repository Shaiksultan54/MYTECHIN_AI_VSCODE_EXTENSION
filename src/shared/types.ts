/**
 * Types shared by the extension host and the webview.
 * Nothing in this file may import `vscode` — the webview bundles it too.
 */

export type AttachmentType = 'file' | 'folder' | 'selection' | 'problems' | 'terminal';
export type AttachmentStatus = 'pending' | 'loaded' | 'error';

export interface ContextAttachment {
  id: string;
  type: AttachmentType;
  uri?: string;
  relativePath?: string;
  lineStart?: number;
  lineEnd?: number;
  sizeBytes?: number;
  language?: string;
  status: AttachmentStatus;
  error?: string;
  /** Set when the path matches a sensitive pattern such as .env or *.pem. */
  sensitive?: boolean;
}

export interface WorkspaceContext {
  workspaceFolderUri: string;
  relativePath: string;
  absoluteUri: string;
}

export interface WorkspaceSummary {
  name: string;
  folders: { name: string; uri: string }[];
  languages: string[];
  frameworks: string[];
  packageManagers: string[];
  files: number;
  sourceRoots: string[];
  testRoots: string[];
  indexed: boolean;
}

export type ToolRisk = 'safe' | 'ask' | 'strong';

export interface ToolCallView {
  callId: string;
  toolName: string;
  title: string;
  detail?: string;
  risk: ToolRisk;
  status: 'running' | 'success' | 'error' | 'rejected';
  summary?: string;
  output?: string;
  error?: string;
  startedAt: number;
  endedAt?: number;
}

export interface ApprovalRequestView {
  requestId: string;
  toolName: string;
  risk: ToolRisk;
  title: string;
  detail?: string;
  /** Unified diff when the tool changes a file. */
  diff?: string;
  /** Command line when the tool runs a shell command. */
  command?: string;
  cwd?: string;
  path?: string;
}

export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  createdAt: number;
  attachments?: ContextAttachment[];
  toolCalls?: ToolCallView[];
  /** Short status line such as "Searching project". */
  status?: string;
  streaming?: boolean;
  error?: string;
}

export interface ContextItemView {
  kind: 'file' | 'selection' | 'problems' | 'workspace' | 'terminal' | 'folder';
  label: string;
  detail?: string;
  tokens: number;
  reason: string;
  uri?: string;
}

export interface ContextSummaryView {
  items: ContextItemView[];
  totalTokens: number;
  budgetTokens: number;
  droppedCount: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  contextWindow?: number;
  supportsTools?: boolean;
  supportsVision?: boolean;
}

export type ProviderId = 'ollama' | 'puter' | 'openai' | 'anthropic' | 'openai-compatible';

export type ProviderState = 'connected' | 'not-configured' | 'error' | 'checking';

export interface ProviderStatusView {
  id: ProviderId;
  name: string;
  state: ProviderState;
  message?: string;
  /** True when requests leave the machine. Drives the cloud warning in the UI. */
  isCloud: boolean;
  requiresSecret: boolean;
  hasSecret?: boolean;
}

export type ApprovalMode = 'alwaysAsk' | 'askForRisky' | 'autoApproveSafe' | 'autonomous';

export interface SettingsView {
  provider: ProviderId;
  model: string;
  ollamaEndpoint: string;
  openaiCompatibleBaseUrl: string;
  openaiCompatibleOrganization: string;
  puterBaseUrl: string;
  approvalMode: ApprovalMode;
  autoApproveSafeTools: boolean;
  maxToolIterations: number;
  maxContextTokens: number;
  maxFileReadBytes: number;
  temperature: number;
  maxTokens: number;
  streaming: boolean;
  enableWorkspaceIndex: boolean;
  enableCheckpoints: boolean;
  loggingLevel: string;
  terminalTimeout: number;
  warnOnSensitiveUpload: boolean;
}

export interface ConversationSummary {
  id: string;
  title: string;
  workspaceId: string;
  provider: string;
  model: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export interface CheckpointView {
  id: string;
  index: number;
  label: string;
  createdAt: number;
  added: string[];
  modified: string[];
  deleted: string[];
}

export interface MentionItem {
  kind: 'file' | 'folder' | 'special';
  label: string;
  detail?: string;
  uri?: string;
  insert: string;
}

export type AgentPhase =
  | 'idle'
  | 'analyzing'
  | 'building-context'
  | 'waiting-for-model'
  | 'streaming'
  | 'awaiting-approval'
  | 'running-tool'
  | 'verifying'
  | 'done'
  | 'error';
