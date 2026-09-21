# MYTECHIN AI — Current Architecture Audit & Technical Baseline

**Document Version:** 1.0.0  
**Audit Date:** 2026-09-21  
**Scope:** Full codebase audit of `localcode-ai-source` (VS Code extension + Webview UI)  
**Status:** Completed Baseline Audit  

---

## 1. Executive Summary & Objective

The primary objective is to upgrade the existing **MYTECHIN AI** VS Code extension into a **model-independent, repository-aware software engineering agent platform**.

Large software projects cannot be understood by sending entire codebases into model context windows. Instead, MYTECHIN must index, parse, relate, search, retrieve, contextualize, execute, diff, verify, and repair autonomously using targeted repository intelligence:

$$\text{REPOSITORY} \longrightarrow \text{INDEX} \longrightarrow \text{STRUCTURE} \longrightarrow \text{SYMBOLS} \longrightarrow \text{RELATIONSHIPS} \longrightarrow \text{SEARCH} \longrightarrow \text{RETRIEVAL} \longrightarrow \text{CONTEXT ASSEMBLY} \longrightarrow \text{MODEL} \longrightarrow \text{TOOLS} \longrightarrow \text{PATCH} \longrightarrow \text{DIFF} \longrightarrow \text{APPROVAL} \longrightarrow \text{APPLY} \longrightarrow \text{BUILD} \longrightarrow \text{TEST} \longrightarrow \text{REVIEW} \longrightarrow \text{RESULT}$$

This document records the exact state of every module in the existing repository prior to deep architectural expansion, highlighting strengths, vulnerabilities, gaps, and the precise migration path forward.

---

## 2. Existing Architecture & Directory Map

The codebase is organized into a modular TypeScript architecture with a dual-project structure (VS Code Extension core + React Webview UI):

```
d:\zip\localcode-ai-source\
├── package.json                   # Extension manifest, contributes, settings, commands
├── tsconfig.json                  # Extension TypeScript configuration (ES2022, Node16)
├── esbuild.mjs                    # Production bundle builder (esbuild targeting Node)
├── src\
│   ├── extension.ts               # Extension activation & deactivation lifecycle
│   ├── commands\
│   │   └── registerCommands.ts    # 18 VS Code command handlers & context-menu actions
│   ├── core\
│   │   ├── agent\                 # Orchestration, state machine, runtime, tool parser
│   │   ├── approval\              # Approval policies (alwaysAsk, askForRisky, etc.)
│   │   ├── browser\               # Playwright headless browser tools
│   │   ├── checkpoints\           # Local snapshot manager & virtual diff editor
│   │   ├── context\               # Attachment, mention, editor & search context collector
│   │   ├── controller\            # ExtensionController mediator (IPC hub between UI & core)
│   │   ├── conversation\          # Multi-turn conversation manager & Memento storage
│   │   ├── logging\               # OutputChannel logger with trace levels
│   │   ├── mcp\                   # Model Context Protocol client & server adapter
│   │   ├── memory\                # Project-level memory store (.mytechin/memory.json)
│   │   ├── prompt\                # System & Task prompt builders
│   │   ├── providers\             # Multi-vendor LLM provider implementations
│   │   ├── search\                # Hybrid ranker, VectorStore, AST code chunker
│   │   ├── storage\               # SecretStore (VS Code Secrets) & SettingsStore
│   │   ├── terminal\              # Child process terminal manager with output capture
│   │   ├── tools\                 # Tool registry, executor, schemas, and handlers
│   │   ├── vision\                # Image attachment and data URL converter
│   │   └── workspace\             # WorkspaceScanner, FileReader, FileWriter, PathSecurity
│   ├── shared\                    # Shared DTOs, schemas, constants across UI and core
│   └── test\                      # Vitest unit test suite
└── webview-ui\                    # React 18 + Vite frontend for the VS Code sidebar
    ├── package.json
    ├── vite.config.ts
    └── src\
        ├── App.tsx                # Main UI state router
        ├── components\            # Chat, Composer, DiffViewer, Approval, Memory, Settings
        ├── state\                 # React context & reducers for UI state
        └── styles.css             # Vanilla CSS design system
```

---

## 3. Existing Modules & Responsibilities

| Module | Core Files | Responsibility | Current Status |
| :--- | :--- | :--- | :--- |
| **Agent Orchestration** | `AgentOrchestrator.ts`, `AgentRuntime.ts`, `AgentState.ts`, `ToolCallParser.ts` | Coordinates LLM streaming, handles tool call parsing (XML/JSON/native), tracks lifecycle phases and loop limits. | **Solid Baseline**: Cleanly bounds iterations and loops; needs sub-agent abstraction and multi-phase validation loops. |
| **Tool System** | `ToolRegistry.ts`, `ToolExecutor.ts`, `ToolTypes.ts`, `handlers/*` | Validates parameters, generates UI approval previews, runs tool executions. | **Functional**: Has read/write/command/browser tools. Lacks LSP, SCIP, Tree-sitter, Git, and structural code intelligence tools. |
| **File Operations** | `FileWriter.ts`, `FileReader.ts`, `PathSecurity.ts`, `writeTools.ts` | Resolves paths against workspace roots, verifies bounds, writes files, applies unified patches. | **Partially Hardened**: Strict string matching in `apply_patch`; lacks true filesystem atomic temp writes and rollback recovery. |
| **Terminal Operations** | `TerminalManager.ts`, `commandTools.ts` | Executes terminal commands via PowerShell/sh with output streaming and capture. | **Vulnerable**: Relies primarily on regex blacklist `DESTRUCTIVE_COMMAND_PATTERNS` rather than an explicit ALLOW/ASK/BLOCK engine. |
| **Diff & Checkpoints** | `CheckpointManager.ts`, `DiffManager.ts` | Virtual diff viewer (`mytechin-diff:` scheme), file rollback snapshots. | **Working**: Virtual diff provider works smoothly without writing disk trash; snapshot storage in Memento has a 30-entry limit. |
| **Approval System** | `ApprovalManager.ts`, `ApprovalPolicy.ts` | Maps actions to risk levels (`safe`, `ask`, `strong`) and collects human-in-the-loop decisions. | **Working**: 4 user-configurable approval modes (`alwaysAsk`, `askForRisky`, `autoApproveSafe`, `autonomous`). |
| **Context Assembly** | `ContextManager.ts`, `ContextCollector.ts`, `ContextBudget.ts`, `ContextRanker.ts` | Gathers workspace summaries, open editors, attachments, @mentions, keyword search. | **Basic**: Fits items by simple token estimation; lacks progressive context tiers, symbol-level compaction, and impact graph context. |
| **Workspace Indexing** | `WorkspaceScanner.ts`, `WorkspaceWatcher.ts`, `WorkspaceManager.ts` | Scans project markers (`package.json`, `csproj`, `go.mod`, etc.) to detect languages/frameworks. | **Shallow**: Marker-only scan. Does not index symbols, AST, relationships, or dependencies. |
| **Search & Vectors** | `VectorStore.ts`, `SemanticSearchService.ts`, `CodeChunker.ts`, `HybridRanker.ts` | Local JSON file vector storage, simple code chunker, reciprocal rank fusion. | **Primitive**: JSON-based storage has scaling limits; path parsing bugs on Windows; embedder requires cloud API key. |
| **Model Providers** | `ProviderManager.ts`, `AIProvider.ts`, `OllamaProvider.ts`, `OpenAIProvider.ts`, `AnthropicProvider.ts`, `GeminiProvider.ts`, etc. | Provider adapter interface supporting streaming and tool calling. | **Extensive Stubs**: Good Ollama and Anthropic streaming. Missing OmniRoute provider and provider-specific model profiles. |
| **MCP Integration** | `McpServerManager.ts`, `McpClient.ts`, `McpToolAdapter.ts` | Connects to external MCP servers via stdio transport and dynamically exposes MCP tools. | **Basic**: Lacks sandboxing and granular capability policies. |
| **Conversation & Persistence** | `ConversationManager.ts`, `ConversationStore.ts`, `SettingsStore.ts`, `SecretStore.ts` | Multi-turn chat persistence in Memento, secrets stored in `vscode.SecretStorage`. | **Stable**: Stores up to 200 conversations in globalState; transcripts capped to prevent bloat. |
| **Project Memory** | `ProjectMemoryService.ts`, `MemoryRetriever.ts` | Manages persistent user rules and architectural constraints in `.mytechin/memory.json`. | **Working**: Injected into system prompt upon retrieval. |
| **Chat UI** | `WebviewProvider.ts`, React components | VS Code sidebar chat panel, diff cards, approval prompts, markdown rendering. | **Polished**: React 18 frontend with VS Code Theme styling. |

---

## 4. Existing Data Flow

```
User Prompt (Chat UI / Command Palette / Context Menu)
      │
      ▼
ExtensionController.submitPrompt()
      │
      ▼
AgentOrchestrator.run()
      │
      ├──> CheckpointManager.beginTurn()
      │
      ├──> ContextManager.build(prompt)
      │      ├── Tier 0: Workspace Map (WorkspaceScanner markers)
      │      ├── Tier 1/2: Attachments & Selections
      │      ├── Tier 3: Active Editor Document
      │      ├── Tier 4: @mentions (@file, @folder, @problems, @terminal)
      │      └── Tier 5: Keyword Search (FileSearcher)
      │
      ├──> SystemPromptBuilder.build()
      │      └── Injects Context + Tool Schemas + Memory
      │
      ├──> AIProvider.stream() (Ollama / Claude / OpenAI / etc.)
      │      │
      │      ▼ (Streaming Text + Tool Call Chunks)
      │   ToolCallParser.parse()
      │      │
      │      ▼ (Parsed Tool Call)
      ├──> ApprovalManager.requestApproval()
      │      └── Webview User Prompt (Approve / Reject / View Diff)
      │
      ├──> ToolExecutor.execute()
      │      ├── read_file / search_code / list_directory
      │      ├── write_file / apply_patch (creates Checkpoint -> writes disk -> verifies)
      │      └── run_command (TerminalManager spawn -> captures output)
      │
      ├──> Loop Guard & Deduplication Check (Max 24 iterations, repeat call signatures)
      │
      └──> Loop Repeat until Model emits final answer or termination guard triggers
```

---

## 5. Architectural Strengths

1. **Clean Seams & Decoupling:** The UI layer (`WebviewProvider`), mediation layer (`ExtensionController`), agent runtime (`AgentOrchestrator`), and tool registry (`ToolRegistry`) are decoupled via strict TypeScript interfaces.
2. **Provider Pluggability:** `AIProvider` encapsulates network streaming and tool-calling interfaces, preventing vendor lock-in.
3. **Loop Bounding & Deduplication:** `AgentState` maintains signatures of recent tool executions to detect repetitive loops and enforces hard iteration ceilings (`maxToolIterations`).
4. **Non-Destructive Checkpointing:** `CheckpointManager` captures before-states in VS Code storage and leverages native VS Code virtual documents for unified diff review without writing garbage files to the workspace.
5. **Interactive Human Approval:** Every mutating action (file write, terminal command, deletion) surfaces preview diffs and execution details with granular approval modes.
6. **Robust Parsing Fallbacks:** `ToolCallParser` handles both native LLM structured tool calls and XML-tagged fallback formats (`<tool name="...">...<tool>`).

---

## 6. Weaknesses, Missing Capabilities & Critical Gaps

### 6.1 Missing Repository Intelligence (Phases 2–13, 20–21)
* **No AST / Symbol Index:** Currently, the extension has zero understanding of symbols (functions, classes, interfaces, methods). It can only read entire files or search for raw strings.
* **No Code Graph / Dependency Graph:** No concept of call chains, imports, dependents, or impact radius. Modifying a function cannot predict what breaks.
* **No Language Server Protocol (LSP) Tools:** VS Code's rich LSP capabilities (`vscode.executeDocumentSymbolProvider`, `vscode.executeWorkspaceSymbolProvider`, `vscode.executeDefinitionProvider`, `vscode.executeReferenceProvider`) are completely unused.
* **No SCIP Compatibility:** No ingestion or export of standardized SCIP code intelligence.
* **No Search Router:** Code search is limited to regex ripgrep or full file list. There is no classification into symbol search, exact search, reference search, structural search, or semantic search.
* **No Feature Graph or Architectural Analyzer:** No automatic detection of layered architecture (UI -> API -> Service -> DB), entry points, or data flow.

### 6.2 Missing Model Abstraction Features (Phases 14, 27, 39, 41)
* **No OmniRoute Provider:** OmniRoute routing, fallback, and free-first selection are completely unintegrated.
* **Lack of Provider-Specific Model Profiles:** Every model receives identical system prompts and tool schemas. Anthropic, Gemini, OpenAI, and Ollama require provider-aligned tool structures.
* **No Cost & Token Budget Enforcement:** There are no hard constraints tracking dollar spend or provider quotas per task.

### 6.3 Missing Git & Sandboxing Capabilities (Phases 28, 31, 32, 38)
* **No Dedicated Git Tooling:** Git commands must be run through `run_command` with full shell privileges, triggering destructive warnings. There are no safe, dedicated tools for `git_status`, `git_diff`, `git_log`, `git_branch`, or `git_commit`.
* **Fragile Command Policy:** `commandTools.ts` checks a regex blacklist. An explicit ALLOW/ASK/BLOCK engine with command argument tokenization is needed.
* **Lack of Execution Sandboxing:** Commands execute directly on the host shell without isolation.

### 6.4 Missing Verification & Self-Repair Loops (Phases 33, 35, 36)
* **No Automated Verification Loop:** The agent stops after modifying a file without automatically validating diagnostics (Problems panel), running tests, or building the project.
* **No Targeted Test Selection:** The agent cannot determine which unit tests test the modified symbols.

---

## 7. Performance, Security & Compatibility Risks

| Category | Risk Details | Severity | Mitigation Plan |
| :--- | :--- | :--- | :--- |
| **Compatibility** | **Windows Path Resolution in PathSecurity:** `resolveWithinRoots` fails when running tests with POSIX root paths on Windows because Node's `path.resolve` injects drive letters (`D:`). | **Medium** | Use platform-aware / POSIX-aware path normalization in `PathSecurity.ts`. |
| **Security** | **Terminal Regex Bypass:** Simple regex matching on commands can be bypassed using subshells, variable interpolation, or encoded characters (e.g. `$(rm -rf ...)`). | **High** | Implement AST/token-based command parser with explicit ALLOW/ASK/BLOCK policy. |
| **Performance** | **In-Memory VectorStore JSON Serialization:** `VectorStore` reads and writes the entire index as a single JSON file (`.mytechin/index/vectors.json`). On large repos (10K+ files), this will cause severe memory bloat and UI freezes. | **High** | Replace monolithic JSON with SQLite / FTS / bounded incremental indexing. |
| **Context Management** | **Monolithic Context Injection:** Full files are injected into prompt context. If a user asks a broad question, token limits are quickly exhausted. | **High** | Implement tiered context engine with symbol extraction, signature extraction, and progressive disclosure. |
| **Reliability** | **Non-Atomic File Writes:** `FileWriter.ts` writes directly to the destination URI. If writing fails midway or the editor is locked, files can become corrupt. | **Medium** | Implement atomic `.tmp` staging and safe atomic rename with automatic rollback. |

---

## 8. Target Architectural Roadmap (Phases 1 — 68)

To resolve these gaps without rewriting the existing functional core, implementation will proceed through the sequential phases:

```
[CURRENT BASELINE AUDIT] (Completed)
         │
         ▼
[PHASE 2] Safe File Editing & Tool Registry (Atomic writes, rollbacks, LSP tools)
         │
         ▼
[PHASE 3] Terminal Security & Approval Policies (Explicit ALLOW/ASK/BLOCK engine)
         │
         ▼
[PHASE 4] Project Metadata & Incremental Scanner (Auto-detecting tech stack, incremental watching)
         │
         ▼
[PHASE 5] Code Intelligence: Symbol Index, Tree-sitter & LSP (Precise symbol retrieval)
         │
         ▼
[PHASE 6] Code Graph & Impact Analysis (Dependency tracking, caller/callee graphs)
         │
         ▼
[PHASE 7] Multi-Mode Search & Search Router (Exact, regex, symbol, structural, semantic)
         │
         ▼
[PHASE 8] Repository Map & Context Engine (Budgeting, ranking, symbol-level compaction)
         │
         ▼
[PHASE 9] Model Abstraction & OmniRoute Provider (FREE_FIRST routing, provider profiles)
         │
         ▼
[PHASE 10] Verification Loop & Self-Repair (Automated build, targeted test execution, repair)
         │
         ▼
[PHASE 11] Sub-Agents, Checkpoints & Final Validation (BILLIT validation & documentation)
```

---

## 9. Conclusion

The MYTECHIN AI codebase has a resilient, well-engineered foundation: clean message passing, multi-provider interfaces, streaming UI, and user approval safety.

By systematically introducing **Symbol Indexing**, **LSP Code Intelligence**, **Dependency Graphs**, **Tiered Context Engine**, and **Automated Verification**, MYTECHIN AI will successfully transform from a prompt-and-patch assistant into a true **repository-aware, model-independent software engineering agent**.
