import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode
} from 'react';
import type { ExtensionEvent } from '../../../src/shared/events/index.js';
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
  WorkspaceSummary,
  MemoryEntry
} from '../../../src/shared/types.js';
import { post } from '../vscode.js';

export type Panel = 'chat' | 'settings' | 'history' | 'context' | 'memory';

export interface AppState {
  ready: boolean;
  panel: Panel;
  settings: SettingsView | undefined;
  providers: ProviderStatusView[];
  models: ModelInfo[];
  workspace: WorkspaceSummary | undefined;
  conversationId: string;
  title: string;
  messages: ChatMessage[];
  attachments: ContextAttachment[];
  conversations: ConversationSummary[];
  checkpoints: CheckpointView[];
  approvals: ApprovalRequestView[];
  context: ContextSummaryView | undefined;
  phase: AgentPhase;
  phaseLabel: string;
  error: { message: string; hint?: string; retryable: boolean } | undefined;
  notice: { level: 'info' | 'warn' | 'error'; message: string; at: number } | undefined;
  mentions: { requestId: string; items: MentionItem[] };
  prefill: { text: string; at: number } | undefined;
  mcpServers: McpServerStatusView[];
  memory: MemoryEntry[];
}

const initialState: AppState = {
  ready: false,
  panel: 'chat',
  settings: undefined,
  providers: [],
  models: [],
  workspace: undefined,
  conversationId: '',
  title: 'New chat',
  messages: [],
  attachments: [],
  conversations: [],
  checkpoints: [],
  approvals: [],
  context: undefined,
  phase: 'idle',
  phaseLabel: '',
  error: undefined,
  notice: undefined,
  mentions: { requestId: '', items: [] },
  prefill: undefined,
  mcpServers: [],
  memory: []
};

export type Action =
  | { kind: 'event'; event: ExtensionEvent }
  | { kind: 'setPanel'; panel: Panel }
  | { kind: 'dismissError' }
  | { kind: 'dismissNotice' }
  | { kind: 'consumePrefill' };

/** Replaces a message in place, keeping array identity changes minimal. */
function replaceMessage(
  messages: ChatMessage[],
  id: string,
  update: (message: ChatMessage) => ChatMessage
): ChatMessage[] {
  let found = false;
  const next = messages.map((message) => {
    if (message.id !== id) {
      return message;
    }
    found = true;
    return update(message);
  });
  return found ? next : messages;
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.kind) {
    case 'setPanel':
      return { ...state, panel: action.panel };
    case 'dismissError':
      return { ...state, error: undefined };
    case 'dismissNotice':
      return { ...state, notice: undefined };
    case 'consumePrefill':
      return { ...state, prefill: undefined };
    case 'event':
      return applyEvent(state, action.event);
    default:
      return state;
  }
}

function applyEvent(state: AppState, event: ExtensionEvent): AppState {
  switch (event.type) {
    case 'hydrate':
      return {
        ...state,
        ready: true,
        settings: event.state.settings,
        providers: event.state.providers,
        models: event.state.models,
        workspace: event.state.workspace,
        conversationId: event.state.conversationId,
        title: event.state.title,
        messages: event.state.messages,
        attachments: event.state.attachments,
        conversations: event.state.conversations,
        checkpoints: event.state.checkpoints,
        phase: event.state.phase,
        mcpServers: event.state.mcpServers,
        memory: event.state.memory
      };

    case 'settingsUpdated':
      return { ...state, settings: event.settings };

    case 'providersUpdated':
      return { ...state, providers: event.providers, models: event.models };

    case 'workspaceUpdated':
      return { ...state, workspace: event.workspace };

    case 'conversationLoaded':
      return {
        ...state,
        panel: 'chat',
        conversationId: event.conversationId,
        title: event.title,
        messages: event.messages,
        approvals: [],
        context: undefined,
        error: undefined
      };

    case 'conversationsList':
      return { ...state, conversations: event.conversations };

    case 'messageAppended':
      return { ...state, panel: 'chat', messages: [...state.messages, event.message], error: undefined };

    case 'assistantStarted':
      return { ...state, phase: 'streaming' };

    case 'assistantChunk':
      return {
        ...state,
        messages: replaceMessage(state.messages, event.messageId, (message) => ({
          ...message,
          text: message.text + event.delta,
          streaming: true
        }))
      };

    case 'assistantCompleted':
      return {
        ...state,
        messages: replaceMessage(state.messages, event.messageId, (message) => ({
          ...message,
          text: event.text,
          streaming: false
        }))
      };

    case 'phaseChanged':
      return { ...state, phase: event.phase, phaseLabel: event.label };

    case 'toolStarted':
    case 'toolCompleted':
      return {
        ...state,
        messages: replaceMessage(state.messages, event.messageId, (message) => {
          const calls = message.toolCalls ?? [];
          const index = calls.findIndex((call) => call.callId === event.call.callId);
          const next =
            index === -1
              ? [...calls, event.call]
              : calls.map((call, i) => (i === index ? event.call : call));
          return { ...message, toolCalls: next };
        })
      };

    case 'toolApprovalRequired':
      return { ...state, approvals: [...state.approvals, event.request] };

    case 'toolApprovalResolved':
      return {
        ...state,
        approvals: state.approvals.filter((request) => request.requestId !== event.requestId)
      };

    case 'attachmentsUpdated':
      return { ...state, attachments: event.attachments };

    case 'contextUpdated':
      return { ...state, context: event.summary };

    case 'checkpointsUpdated':
      return { ...state, checkpoints: event.checkpoints };

    case 'agentCompleted':
      return { ...state, approvals: [] };

    case 'agentError':
      return {
        ...state,
        phase: 'error',
        approvals: [],
        error: { message: event.message, hint: event.hint, retryable: event.retryable }
      };

    case 'mentionResults':
      return { ...state, mentions: { requestId: event.requestId, items: event.items } };

    case 'notification':
      return { ...state, notice: { level: event.level, message: event.message, at: Date.now() } };

    case 'focusComposer':
      return { ...state, prefill: { text: event.prefill ?? '', at: Date.now() } };

    case 'showPanel':
      return { ...state, panel: event.panel };

    case 'mcpServersUpdated':
      return { ...state, mcpServers: event.servers };

    case 'memoryUpdated':
      return { ...state, memory: event.memory };

    default:
      return state;
  }
}

const StateContext = createContext<AppState>(initialState);
const DispatchContext = createContext<Dispatch<Action>>(() => undefined);

export function StoreProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    const onMessage = (event: MessageEvent<ExtensionEvent>): void => {
      if (event.data && typeof event.data === 'object' && 'type' in event.data) {
        dispatch({ kind: 'event', event: event.data });
      }
    };
    window.addEventListener('message', onMessage);
    post({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <StateContext.Provider value={state}>
      <DispatchContext.Provider value={dispatch}>{children}</DispatchContext.Provider>
    </StateContext.Provider>
  );
}

export function useAppState(): AppState {
  return useContext(StateContext);
}

export function useDispatch(): Dispatch<Action> {
  return useContext(DispatchContext);
}

/** True while the agent is doing anything the Stop button should interrupt. */
export function useBusy(): boolean {
  const { phase } = useAppState();
  return useMemo(() => phase !== 'idle' && phase !== 'done' && phase !== 'error', [phase]);
}
