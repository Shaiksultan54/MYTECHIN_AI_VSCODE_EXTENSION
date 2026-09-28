import * as vscode from 'vscode';
import type { ExtensionEvent, HydrateState } from '../../shared/events/index.js';
import type { WebviewMessage } from '../../shared/messages/index.js';
import type { MentionItem, ProviderId } from '../../shared/types.js';
import { SPECIAL_MENTIONS } from '../../shared/constants/index.js';
import { Logger, type LogLevel } from '../logging/Logger.js';
import { SettingsStore } from '../storage/SettingsStore.js';
import { SecretStore } from '../storage/SecretStore.js';
import { WorkspaceManager } from '../workspace/WorkspaceManager.js';
import { FileReader } from '../workspace/FileReader.js';
import { FileWriter } from '../workspace/FileWriter.js';
import { FileSearcher } from '../workspace/FileSearcher.js';
import { WorkspaceScanner } from '../workspace/WorkspaceScanner.js';
import { WorkspaceWatcher } from '../workspace/WorkspaceWatcher.js';
import { VisionAdapter } from '../vision/VisionAdapter.js';
import { BrowserService } from '../browser/BrowserService.js';
import { SemanticSearchService } from '../search/SemanticSearchService.js';
import { createEmbeddingProvider } from '../search/EmbeddingProvider.js';
import { ProjectMemoryService } from '../memory/ProjectMemoryService.js';
import { MemoryRetriever } from '../memory/MemoryRetriever.js';
import { TerminalManager } from '../terminal/TerminalManager.js';
import { DiffManager } from '../checkpoints/DiffManager.js';
import { CheckpointManager } from '../checkpoints/CheckpointManager.js';
import { ApprovalPolicy } from '../approval/ApprovalPolicy.js';
import { ApprovalManager } from '../approval/ApprovalManager.js';
import { ProviderManager } from '../providers/ProviderManager.js';
import { ToolRegistry } from '../tools/ToolRegistry.js';
import { ToolExecutor } from '../tools/ToolExecutor.js';
import type { ToolContext } from '../tools/ToolTypes.js';
import { AttachmentManager } from '../context/AttachmentManager.js';
import { ContextCollector } from '../context/ContextCollector.js';
import { ContextManager } from '../context/ContextManager.js';
import { ConversationStore } from '../conversation/ConversationStore.js';
import { ConversationManager } from '../conversation/ConversationManager.js';
import { AgentRuntime } from '../agent/AgentRuntime.js';
import { McpConfigStore } from '../mcp/McpConfigStore.js';
import { McpServerManager } from '../mcp/McpServerManager.js';
import { WorkspaceGraph } from '../workspace/WorkspaceGraph.js';

/**
 * The single wiring point of the extension. It constructs every service, owns
 * their lifetime, translates webview messages into service calls, and pushes
 * typed events back. No other class reaches across module boundaries.
 */
export class ExtensionController implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private post: ((event: ExtensionEvent) => void) | undefined;

  readonly settings: SettingsStore;
  readonly secrets: SecretStore;
  readonly workspace: WorkspaceManager;
  readonly scanner: WorkspaceScanner;
  readonly providers: ProviderManager;
  readonly conversations: ConversationManager;
  readonly attachments: AttachmentManager;
  readonly context: ContextManager;
  readonly checkpoints: CheckpointManager;
  readonly approvals: ApprovalManager;
  readonly agent: AgentRuntime;
  readonly diffs: DiffManager;
  readonly mcp: McpServerManager;

  private readonly reader: FileReader;
  private readonly writer: FileWriter;
  private readonly searcher: FileSearcher;
  private readonly terminal: TerminalManager;
  private readonly registry: ToolRegistry;
  private readonly executor: ToolExecutor;
  private readonly watcher: WorkspaceWatcher;
  private readonly graph: WorkspaceGraph;
  private readonly browserService: BrowserService;
  private readonly semanticSearch: SemanticSearchService;
  readonly memoryService: ProjectMemoryService;

  /** Resolver for a pending `ask_user` tool call. */
  private pendingQuestion: ((answer: string) => void) | undefined;

  constructor(private readonly extensionContext: vscode.ExtensionContext) {
    const logger = Logger.get();

    this.settings = new SettingsStore();
    this.secrets = new SecretStore(extensionContext.secrets);
    logger.setLevel(this.settings.read().loggingLevel as LogLevel);

    this.workspace = new WorkspaceManager();
    this.workspace.ignoreRules.setExtraPatterns(this.settings.excludePatterns());

    this.reader = new FileReader(this.workspace, () => this.settings.read().maxFileReadBytes);
    this.writer = new FileWriter(this.workspace);
    this.searcher = new FileSearcher(this.workspace);
    this.scanner = new WorkspaceScanner(this.workspace);
    this.graph = new WorkspaceGraph(this.workspace);
    this.terminal = new TerminalManager(() => this.settings.read().terminalTimeout);
    this.diffs = new DiffManager();

    this.checkpoints = new CheckpointManager(
      extensionContext.workspaceState,
      this.workspace,
      this.diffs,
      () => this.settings.read().enableCheckpoints,
      () => this.emit({ type: 'checkpointsUpdated', checkpoints: this.checkpoints.views() })
    );

    this.providers = new ProviderManager(this.settings, this.secrets);

    const policy = new ApprovalPolicy(
      () => this.settings.read().approvalMode,
      () => this.settings.read().autoApproveSafeTools
    );
    this.approvals = new ApprovalManager(
      policy,
      (request) =>
        this.emit({
          type: 'toolApprovalRequired',
          messageId: this.conversations.messages.at(-1)?.id ?? '',
          request
        }),
      (requestId, approved) => this.emit({ type: 'toolApprovalResolved', requestId, approved })
    );

    this.registry = new ToolRegistry();
    this.browserService = new BrowserService(Logger.get());

    this.executor = new ToolExecutor(this.registry, this.approvals, (token) =>
      this.toolContext(token)
    );

    const mcpConfigStore = new McpConfigStore(this.workspace, this.reader, this.writer, this.settings);
    this.mcp = new McpServerManager(mcpConfigStore, this.registry);

    this.attachments = new AttachmentManager(this.workspace, this.reader, () =>
      this.emit({ type: 'attachmentsUpdated', attachments: this.attachments.list() })
    );

    const embedder = createEmbeddingProvider(this.settings);
    this.semanticSearch = new SemanticSearchService(
      this.workspace,
      this.reader,
      this.searcher,
      embedder,
      Logger.get()
    );

    const collector = new ContextCollector(
      this.workspace,
      this.reader,
      this.searcher,
      this.scanner,
      this.attachments,
      this.semanticSearch,
      this.graph
    );
    this.context = new ContextManager(
      collector,
      this.attachments,
      this.searcher,
      this.workspace,
      this.reader,
      this.terminal,
      () => this.settings.read().maxContextTokens
    );

    this.conversations = new ConversationManager(
      new ConversationStore(extensionContext.globalState),
      () => this.workspace.workspaceId,
      () => this.settings.read().provider,
      () => this.settings.read().model
    );

    const rootFolderUri = this.workspace.folders[0]?.uri;
    this.memoryService = new ProjectMemoryService(rootFolderUri, Logger.get());
    void this.memoryService.load();
    const memoryRetriever = new MemoryRetriever(this.memoryService, this.semanticSearch);

    const visionAdapter = new VisionAdapter(this.workspace, this.reader);

    this.agent = new AgentRuntime({
      provider: () => this.providers.active(),
      registry: this.registry,
      executor: this.executor,
      workspace: this.workspace,
      conversations: this.conversations,
      attachments: this.attachments,
      vision: visionAdapter,
      memory: memoryRetriever,
      context: this.context,
      settings: this.settings,
      checkpoints: this.checkpoints,
      approvals: this.approvals,
      events: { emit: (event) => this.emit(event) }
    });

    this.watcher = new WorkspaceWatcher(this.scanner, (uri, deleted) => {
      if (uri) {
        void this.graph.update(uri, deleted);
        return;
      }
      this.graph.invalidate();
      void this.refreshWorkspace();
    });

    this.disposables.push(
      this.settings,
      this.workspace,
      this.providers,
      this.approvals,
      this.terminal,
      this.diffs,
      this.watcher,
      this.agent,
      this.mcp,
      this.mcp.onDidChange(() => {
        this.emit({ type: 'mcpServersUpdated', servers: this.mcp.getStatusesView() });
      }),
      this.settings.onDidChange((next) => {
        Logger.get().setLevel(next.loggingLevel as LogLevel);
        this.workspace.ignoreRules.setExtraPatterns(this.settings.excludePatterns());
        this.providers.invalidate();
        this.emit({ type: 'settingsUpdated', settings: next });
        void this.pushProviders();
      }),
      this.providers.onDidChange(() => {
        void this.pushProviders();
      }),
      this.workspace.onDidChangeFolders(() => {
        void this.refreshWorkspace();
      })
    );
  }

  // ---------------------------------------------------------------- lifecycle

  /** Called by the webview provider once a view exists. */
  connect(post: (event: ExtensionEvent) => void): void {
    this.post = post;
  }

  disconnect(): void {
    this.post = undefined;
  }

  emit(event: ExtensionEvent): void {
    this.post?.(event);
  }

  async initialize(): Promise<void> {
    await Promise.all([
      this.conversations.startNew(),
      this.mcp.initialize()
    ]);
    void this.refreshWorkspace();
    void this.testConnection();
  }

  // ----------------------------------------------------------------- messages

  async handleMessage(message: WebviewMessage): Promise<void> {
    try {
      await this.route(message);
    } catch (error) {
      Logger.get().error(`Failed to handle "${message.type}"`, error);
      this.emit({
        type: 'notification',
        level: 'error',
        message: (error as Error)?.message ?? 'Something went wrong.'
      });
    }
  }

  private async route(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        await this.hydrate();
        return;

      case 'sendPrompt':
        await this.submitPrompt(message.text);
        return;

      case 'stopAgent':
        this.agent.stop();
        return;

      case 'newConversation':
        await this.newConversation();
        return;

      case 'loadConversation': {
        const conversation = await this.conversations.load(message.conversationId);
        if (conversation) {
          this.attachments.clear();
          this.emit({
            type: 'conversationLoaded',
            conversationId: conversation.id,
            title: conversation.title,
            messages: conversation.messages
          });
          this.emit({
            type: 'checkpointsUpdated',
            checkpoints: this.checkpoints.forConversation(conversation.id)
          });
        }
        return;
      }

      case 'deleteConversation':
        await this.conversations.delete(message.conversationId);
        await this.pushConversations();
        return;

      case 'renameConversation':
        await this.conversations.rename(message.conversationId, message.title);
        await this.pushConversations();
        return;

      case 'listConversations':
        await this.pushConversations(message.query);
        return;

      case 'pickAttachment': {
        const uris = await vscode.window.showOpenDialog({
          canSelectFiles: message.kind === 'file',
          canSelectFolders: message.kind === 'folder',
          canSelectMany: true,
          openLabel: 'Attach'
        });
        if (uris?.length) {
          await this.addUris(uris);
        }
        return;
      }

      case 'attachSpecial':
        await this.attachSpecial(message.kind);
        return;

      case 'attachUris':
        await this.addUris(message.uris.map((uri) => vscode.Uri.parse(uri)));
        return;

      case 'attachPastedCode':
        this.attachments.addPastedCode(message.text, message.language);
        return;

      case 'attachDataUrl':
        this.attachments.addDataUrl(message.name, message.dataUrl, message.mimeType);
        return;

      case 'removeAttachment':
        this.attachments.remove(message.attachmentId);
        return;

      case 'clearAttachments':
        this.attachments.clear();
        return;

      case 'approveTool':
        if (this.pendingQuestion) {
          // An `ask_user` prompt is answered through the same control.
          this.answerQuestion(message.approved ? 'yes' : 'no');
          return;
        }
        this.approvals.resolve(message.requestId, message.approved, message.rememberForTask);
        return;

      case 'planDecision':
        this.agent.decidePlan(message.planId, message.decision, message.text);
        return;

      case 'selectProvider':
        await this.settings.update({ provider: message.providerId, model: '' });
        await this.testConnection(message.providerId);
        return;

      case 'selectModel':
        await this.settings.update({ model: message.modelId });
        await this.testConnection();
        return;

      case 'refreshModels':
        await this.pushProviders(true);
        return;

      case 'testConnection':
        await this.testConnection(message.providerId);
        return;

      case 'saveSettings':
        await this.settings.update(message.patch);
        return;

      case 'setSecret':
        await this.promptForSecret(message.providerId);
        return;

      case 'clearSecret':
        await this.secrets.clear(message.providerId);
        this.providers.invalidate(message.providerId);
        await this.pushProviders();
        this.emit({ type: 'notification', level: 'info', message: 'Credential removed.' });
        return;

      case 'searchMentions':
        await this.searchMentions(message.query, message.requestId);
        return;

      case 'openFile':
        await this.diffs.openFile(vscode.Uri.parse(message.uri), message.line);
        return;

      case 'openDiff':
        await this.diffs.showPatch(message.title ?? 'proposed-change', message.patch);
        return;

      case 'requestContext': {
        const summary = this.context.summary();
        if (summary) {
          this.emit({ type: 'contextUpdated', summary });
        } else {
          this.emit({
            type: 'notification',
            level: 'info',
            message: 'Send a message first — context is gathered per request.'
          });
        }
        return;
      }

      case 'restoreCheckpoint': {
        const result = await this.checkpoints.restore(message.checkpointId);
        const total = result.restored.length + result.removed.length;
        if (total > 0) {
          this.emit({
            type: 'notification',
            level: 'info',
            message: `Restored ${total} file${total === 1 ? '' : 's'}.`
          });
        }
        return;
      }

      case 'compareCheckpoint':
        await this.checkpoints.compare(message.checkpointId);
        return;

      case 'openExtensionSettings':
        await vscode.commands.executeCommand(
          'workbench.action.openSettings',
          '@ext:mytechin.mytechin-ai'
        );
        return;

      case 'showLogs':
        Logger.get().show();
        return;

      case 'rebuildSemanticIndex':
        this.emit({ type: 'notification', level: 'info', message: 'Rebuilding semantic index in background...' });
        void this.semanticSearch.indexWorkspace();
        return;

      case 'getMemory':
        this.emit({ type: 'memoryUpdated', memory: this.memoryService.getEntries() });
        return;

      case 'addMemory':
        this.memoryService.addEntry(message.category as any, message.content);
        await this.memoryService.save();
        this.emit({ type: 'memoryUpdated', memory: this.memoryService.getEntries() });
        return;

      case 'updateMemory':
        this.memoryService.updateEntry(message.id, message.content);
        await this.memoryService.save();
        this.emit({ type: 'memoryUpdated', memory: this.memoryService.getEntries() });
        return;

      case 'removeMemory':
        this.memoryService.removeEntry(message.id);
        await this.memoryService.save();
        this.emit({ type: 'memoryUpdated', memory: this.memoryService.getEntries() });
        return;

      case 'addMcpServer': {
        const { McpConfigStore } = await import('../mcp/McpConfigStore.js');
        const configStore = new McpConfigStore(this.workspace, this.reader, this.writer, this.settings);
        await configStore.addServer(message.config);
        return;
      }

      case 'removeMcpServer': {
        const { McpConfigStore } = await import('../mcp/McpConfigStore.js');
        const configStore = new McpConfigStore(this.workspace, this.reader, this.writer, this.settings);
        await configStore.removeServer(message.id);
        return;
      }

      case 'toggleMcpServer': {
        const { McpConfigStore } = await import('../mcp/McpConfigStore.js');
        const configStore = new McpConfigStore(this.workspace, this.reader, this.writer, this.settings);
        const configs = await configStore.read();
        const config = configs.find((c: any) => c.id === message.id);
        if (config) {
          config.disabled = message.disabled;
          await configStore.write(configs);
        }
        return;
      }

      case 'restartMcpServer':
        await this.mcp.restart(message.id);
        return;

      default: {
        const exhaustive: never = message;
        Logger.get().warn(`Unhandled webview message`, exhaustive);
      }
    }
  }

  // ------------------------------------------------------------------ actions

  /** Entry point shared by the composer, commands and the context menu. */
  async submitPrompt(text: string): Promise<void> {
    if (this.pendingQuestion) {
      this.answerQuestion(text);
      return;
    }

    const trimmed = text.trim();
    if (trimmed.length === 0) {
      return;
    }

    const attachments = this.attachments.list();
    if (!(await this.confirmSensitive())) {
      return;
    }

    const settings = this.settings.read();
    if (!settings.model) {
      this.emit({
        type: 'agentError',
        message: 'No model selected.',
        hint: 'Pick a model next to the Send button, or configure a provider first.',
        retryable: false
      });
      return;
    }

    this.conversations.setProviderAndModel(settings.provider, settings.model);

    const userMessage = {
      id: `u_${Date.now().toString(36)}`,
      role: 'user' as const,
      text: trimmed,
      createdAt: Date.now(),
      attachments: attachments.length > 0 ? attachments : undefined
    };
    this.conversations.addMessage(userMessage);
    this.emit({ type: 'messageAppended', message: userMessage });

    await this.agent.submit(trimmed);
    this.attachments.clear();
    await this.pushConversations();
  }

  /** Focuses the sidebar and drops text into the composer without sending it. */
  async prefillComposer(text: string): Promise<void> {
    await vscode.commands.executeCommand('mytechin.chat.focus');
    this.emit({ type: 'focusComposer', prefill: text });
  }

  async newConversation(): Promise<void> {
    this.agent.stop();
    this.attachments.clear();
    const conversation = await this.conversations.startNew();
    this.emit({
      type: 'conversationLoaded',
      conversationId: conversation.id,
      title: conversation.title,
      messages: []
    });
    await this.pushConversations();
  }

  async addUris(uris: vscode.Uri[]): Promise<void> {
    const outcome = await this.attachments.addUris(uris);
    for (const error of outcome.errors) {
      this.emit({ type: 'notification', level: 'warn', message: error });
    }
  }

  async attachSpecial(kind: 'currentFile' | 'selection' | 'problems' | 'terminal'): Promise<void> {
    let error: string | undefined;
    switch (kind) {
      case 'currentFile':
        error = await this.attachments.addCurrentFile();
        break;
      case 'selection':
        error = await this.attachments.addSelection();
        break;
      case 'problems':
        this.attachments.addProblems();
        break;
      case 'terminal':
        this.attachments.addTerminal();
        break;
    }
    if (error) {
      this.emit({ type: 'notification', level: 'warn', message: error });
    }
  }

  private async testConnection(providerId?: ProviderId): Promise<void> {
    const id = providerId ?? this.settings.read().provider;
    const status = await this.providers.testConnection(id);
    this.emit({
      type: 'notification',
      level: status.state === 'connected' ? 'info' : 'error',
      message: status.message ?? (status.state === 'connected' ? 'Connected.' : 'Not reachable.')
    });
    await this.pushProviders();
  }

  private async promptForSecret(providerId: ProviderId): Promise<void> {
    const label: Record<ProviderId, string> = {
      ollama: 'Ollama needs no credential',
      puter: 'Puter API token (optional — leave empty for free auto-session)',
      openai: 'OpenAI API key',
      anthropic: 'Anthropic API key',
      'openai-compatible': 'API key for the custom endpoint',
      gemini: 'Google Gemini API key',
      groq: 'Groq API key',
      openrouter: 'OpenRouter API key',
      github: 'GitHub Personal Access Token (for GitHub Models)',
      omniroute: 'OmniRoute API key (optional — leave empty for local gateway)'
    };

    const value = await vscode.window.showInputBox({
      title: label[providerId],
      prompt: 'Stored in VS Code SecretStorage. It is never written to settings or sent to the webview.',
      password: true,
      ignoreFocusOut: true
    });
    if (value === undefined) {
      return;
    }

    if (value.trim().length === 0) {
      await this.secrets.clear(providerId);
    } else {
      await this.secrets.set(providerId, value.trim());
    }
    this.providers.invalidate(providerId);
    await this.pushProviders();
    this.emit({ type: 'notification', level: 'info', message: 'Credential saved.' });
  }

  /**
   * Cloud providers get an explicit yes before secrets or credential files
   * leave the machine. Local Ollama never triggers this.
   */
  private async confirmSensitive(): Promise<boolean> {
    const settings = this.settings.read();
    if (!settings.warnOnSensitiveUpload) {
      return true;
    }
    const sensitive = this.attachments.sensitiveOnes();
    if (sensitive.length === 0) {
      return true;
    }
    const provider = this.providers.get(settings.provider);
    if (!provider?.isCloud) {
      return true;
    }

    const answer = await vscode.window.showWarningMessage(
      `Send ${sensitive.length} sensitive file${sensitive.length === 1 ? '' : 's'} to ${provider.name}?`,
      {
        modal: true,
        detail: `${sensitive.map((a) => a.relativePath ?? a.type).join('\n')}\n\nThis leaves your machine.`
      },
      'Send anyway'
    );
    return answer === 'Send anyway';
  }

  private async searchMentions(query: string, requestId: string): Promise<void> {
    const trimmed = query.trim();
    const items: MentionItem[] = SPECIAL_MENTIONS.filter((m) =>
      trimmed.length === 0 ? true : m.label.toLowerCase().includes(trimmed.toLowerCase())
    ).map((m) => ({
      kind: 'special' as const,
      label: m.label,
      detail: m.detail,
      insert: m.label
    }));

    if (trimmed.length > 0 && this.workspace.hasWorkspace) {
      const [files, folders] = await Promise.all([
        this.searcher.findFiles(trimmed, 12),
        this.searcher.findFolders(trimmed, 5)
      ]);
      for (const folder of folders) {
        items.push({
          kind: 'folder',
          label: folder.split('/').pop() ?? folder,
          detail: folder,
          insert: `@folder ${folder}`
        });
      }
      for (const file of files) {
        items.push({
          kind: 'file',
          label: file.split('/').pop() ?? file,
          detail: file,
          insert: `@file ${file}`
        });
      }
    }

    this.emit({ type: 'mentionResults', requestId, items: items.slice(0, 20) });
  }

  // -------------------------------------------------------------- state pushes

  private async hydrate(): Promise<void> {
    const settings = this.settings.read();
    const [providers, models, conversations] = await Promise.all([
      this.providers.statusViews(),
      this.providers.listModels().catch(() => []),
      this.conversations.list()
    ]);

    const state: HydrateState = {
      settings,
      providers,
      models,
      workspace: this.scanner.current(),
      conversationId: this.conversations.id,
      title: this.conversations.current.title,
      messages: this.conversations.messages,
      attachments: this.attachments.list(),
      conversations,
      checkpoints: this.checkpoints.forConversation(this.conversations.id),
      phase: this.agent.phase,
      mcpServers: this.mcp.getStatusesView(),
      memory: this.memoryService.getEntries()
    };
    this.emit({ type: 'hydrate', state });
    void this.refreshWorkspace();
  }

  private async pushProviders(force = false): Promise<void> {
    const providers = await this.providers.statusViews();
    const models = await this.providers.listModels(force).catch(() => []);
    this.emit({ type: 'providersUpdated', providers, models });
  }

  private async pushConversations(query?: string): Promise<void> {
    this.emit({ type: 'conversationsList', conversations: await this.conversations.list(query) });
  }

  private async refreshWorkspace(): Promise<void> {
    if (!this.settings.read().enableWorkspaceIndex) {
      this.emit({ type: 'workspaceUpdated', workspace: this.scanner.current() });
      return;
    }
    const summary = await this.scanner.scan();
    this.emit({ type: 'workspaceUpdated', workspace: summary });
  }

  // ----------------------------------------------------------------- tool glue

  private toolContext(token: vscode.CancellationToken): ToolContext {
    return {
      workspace: this.workspace,
      reader: this.reader,
      writer: this.writer,
      searcher: this.searcher,
      terminal: this.terminal,
      checkpoints: this.checkpoints,
      diffs: this.diffs,
      graph: this.graph,
      browser: this.browserService,
      token,
      conversationId: this.conversations.id,
      report: (status) => this.emit({ type: 'phaseChanged', phase: 'running-tool', label: status }),
      askUser: (question, options) => this.askUser(question, options, token)
    };
  }

  /**
   * `ask_user` needs a real answer from a human. A quick pick keeps the agent
   * unblocked without inventing a second chat input mode; free text falls back
   * to an input box.
   */
  private async askUser(
    question: string,
    options: string[] | undefined,
    token: vscode.CancellationToken
  ): Promise<string> {
    this.emit({
      type: 'phaseChanged',
      phase: 'awaiting-approval',
      label: 'Waiting for your answer'
    });

    const answered = new Promise<string>((resolve) => {
      this.pendingQuestion = resolve;
      token.onCancellationRequested(() => resolve(''));
    });

    const asked =
      options && options.length > 0
        ? vscode.window.showQuickPick([...options, 'Something else…'], {
            title: 'Mytechin AI',
            placeHolder: question,
            ignoreFocusOut: true
          })
        : vscode.window.showInputBox({
            title: 'Mytechin AI',
            prompt: question,
            ignoreFocusOut: true
          });

    const picked = await Promise.race([asked, answered]);
    this.pendingQuestion = undefined;

    if (picked === 'Something else…') {
      const free = await vscode.window.showInputBox({
        title: 'Mytechin AI',
        prompt: question,
        ignoreFocusOut: true
      });
      return free ?? '';
    }
    return picked ?? '';
  }

  private answerQuestion(answer: string): void {
    const resolve = this.pendingQuestion;
    this.pendingQuestion = undefined;
    resolve?.(answer);
  }

  get extensionUri(): vscode.Uri {
    return this.extensionContext.extensionUri;
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.browserService.dispose();
    this.semanticSearch.dispose();
    this.disposables.length = 0;
  }
}
