# Mytechin AI Feature Guide

This guide describes the behavior implemented by the extension. It is intended
for users, maintainers, and reviewers who need to understand not only what a
feature does, but also where it runs and what safety boundary applies.

## Product model

Mytechin AI is a VS Code extension with two cooperating parts:

1. The extension host (`src/`) owns filesystem access, providers, indexing,
   approvals, terminal processes, and persistence.
2. The React webview (`webview-ui/`) renders chat, context, settings, history,
   memory, approvals, plans, diffs, and status. It communicates with the
   extension through typed messages and never receives credentials.

There is no hosted Mytechin backend. Provider traffic goes directly from the
extension host to the configured local or remote provider.

## Request lifecycle

Every submitted prompt follows the same bounded pipeline:

1. `ExtensionController` receives the request from the webview, command palette,
   editor context menu, or Explorer context menu.
2. `AgentRuntime` starts a cancellable task and resets per-task approval and
   repetition state.
3. `AgentOrchestrator` optionally waits for the plan approval flow, then builds
   context and the system prompt.
4. `ContextManager` collects workspace metadata, explicit mentions, the active
   editor, diagnostics, attachments, memory, search results, language-server
   results, and dependency impact within a token budget.
5. The selected provider streams a response. Native tool calling is used when
   supported; otherwise `ToolCallParser` handles the XML/text protocol.
6. `ToolExecutor` validates arguments, classifies risk, shows the appropriate
   preview, requests approval when required, executes the handler, and bounds
   the returned output.
7. Tool results are added to the conversation and the model may continue until
   it answers, is cancelled, reaches `maxToolIterations`, or repeats an exact
   call.
8. Successful edits trigger post-edit verification. New error diagnostics are
   returned to the model as a system message, with at most two repair attempts.

## Context and repository intelligence

### Explicit context

The composer supports `@file`, `@folder`, `@workspace`, `@currentFile`,
`@selection`, `@problems`, and `@terminal`. The attachment button and drag/drop
support the same sources. The Context view shows the final items, source,
reason, and estimated token cost.

### Search

`search_code` combines filename and text search with the repository's ignore
rules. Semantic search is used when embeddings are available; lexical search
remains the reliable fallback. Search results are ranked and truncated before
they enter the model context.

### Language-server intelligence

The safe LSP tools use VS Code command providers:

- `find_definition(file, line, character)`
- `find_references(file, line, character)`
- `workspace_symbols(query)`
- `document_symbols(file)`

Compatibility names (`get_definition`, `get_references`,
`get_workspace_symbols`, and `get_document_symbols`) remain available. When no
language server is installed, the tools return a clear no-provider result
instead of failing. Symbol-specific requests prefer these tools over raw text
search.

### WorkspaceGraph and impact analysis

`WorkspaceGraph` maintains a cheap file-level graph for TypeScript/JavaScript,
Python, Go, and C# import forms. It records dependencies, dependents, and
imported names where syntax makes them determinable. `get_impact` is safe and
is included before mutation tools so a signature or export change can be
reviewed with likely consumers.

The graph is an approximation, not a compiler. Dynamic imports, aliases,
generated files, package export maps, and language-specific resolution rules
may be missed. Use LSP definitions and references when exact relationships are
required. Source file changes update individual graph entries through
`WorkspaceWatcher`; project-marker changes invalidate the broader scan.

### Budgeting

`ContextBudget` reserves space for the system prompt, tool definitions, and
model output. Higher-value explicit context and diagnostics are retained first;
large search results and low-priority files are truncated or removed first.
Token counts are estimates rather than provider-specific tokenizer counts.

## Editing, checkpoints, and verification

### Safe file writes

`write_file`, `create_file`, `apply_patch`, and `multi_apply_patch` resolve paths
inside workspace roots and preserve patch anchor/uniqueness validation.
Before the first edit in a turn, `CheckpointManager` snapshots the original
state. `FileWriter` then writes a sibling temporary file, attempts `fsync`,
atomically renames it over the destination, and removes the temporary file on
failure. The destination is not replaced by a partial write.

### Diff and restore

The webview shows a unified diff before an approved edit is committed. History
stores checkpoints and provides compare and restore actions. Restore is explicit
and confirmation-based; it never runs automatically.

### Post-edit verification

When `mytechin.verifyAfterEdit` is enabled, the extension captures diagnostics
before and after edits and reports only newly introduced Error-severity
diagnostics. It also discovers a plausible corresponding test file and test
runner. Test execution is offered through `run_command` and therefore keeps its
normal approval policy; it is not silently launched in a mode that cannot run
commands without permission.

## Approval and command safety

Risk categories are applied at the tool boundary:

- **Safe:** read-only inspection, search, diagnostics, LSP, impact analysis,
  read-only Git, and metadata.
- **Ask:** edits, Git commits, and branch changes.
- **Strong:** deletion and shell execution.

`ApprovalPolicy` combines the category with the configured approval mode.
`run_command` is analyzed by a tokenizer-aware `CommandPolicy` before ordinary
allow/ask/block patterns. Command substitution, encoded payloads piped to a
shell, and chained-command allowlist bypasses are blocked conservatively.
Push, force-push, hard reset, and rebase intentionally remain generic command
operations rather than dedicated Git tools.

## Git tools

The dedicated Git tools are:

- `git_status`: working-tree status.
- `git_diff`: working-tree or path-scoped diff.
- `git_log`: bounded recent history.
- `git_commit`: stages specified paths and commits with the supplied message.
- `git_branch`: creates or switches branches.

Status, diff, and log are safe. Commit and branch operations require approval
and preview the exact paths, branch, and message before execution.

## Providers and embeddings

The provider manager supports Ollama, OpenAI, Anthropic, Gemini, Puter, and
OpenAI-compatible endpoints through a common streaming interface. Secrets are
stored in VS Code `SecretStorage`; they are not written to settings or sent to
the webview.

Ollama is local-first:

```text
Chat:      http://127.0.0.1:11434/api/chat
Embeddings http://127.0.0.1:11434/api/embeddings
```

When Ollama is active, `OllamaEmbeddingProvider` uses
`mytechin.ollama.embeddingModel` (default `nomic-embed-text`). It checks
`/api/tags` and offers an `ollama pull <model>` action when the model is
missing. Other providers use lexical search unless an embedding provider is
explicitly available.

`VectorStore` persists bounded JSON shards under
`.mytechin/index/vectors/`, keyed by a hash of the source path. This avoids a
single monolithic vector file. Similarity search is still a linear scan over
loaded vectors, so very large repositories may eventually benefit from a
database or ANN index.

## Memory, conversations, and checkpoints

Conversations are persisted in VS Code global state with bounded history.
Project memory stores user-approved rules and architectural constraints in
`.mytechin/memory.json`; retrieved entries are added to the system prompt.
Checkpoints are separate from conversation history and preserve pre-edit file
content for comparison and restore.

## MCP and browser capabilities

MCP configuration exposes tools from configured stdio MCP servers through the
same registry and approval boundary as built-in tools. Treat external MCP
servers as trusted local programs: the extension does not sandbox their
processes.

Browser tools support web search, page navigation, and content extraction when
configured. Network-capable actions are classified separately from local
read-only tools and should be used only when the task requires them.

## Webview experience

The sidebar provides:

- branded Chat, Context, History, Memory, and Settings navigation;
- streaming responses and tool activity;
- approval cards, editable plan cards, diff previews, and error notices;
- provider/model selection and credential status;
- Ollama embedding configuration;
- verification and plan-before-execute controls;
- keyboard shortcuts and theme-safe VS Code styling.

The webview uses a restrictive content security policy and communicates through
the extension API rather than accessing the filesystem or network directly.

## Settings reference

| Setting | Default | Purpose |
| --- | --- | --- |
| `mytechin.provider` | `ollama` | Active model provider |
| `mytechin.model` | empty | Chat model identifier |
| `mytechin.ollama.endpoint` | `http://127.0.0.1:11434` | Ollama endpoint |
| `mytechin.ollama.embeddingModel` | `nomic-embed-text` | Ollama embedding model |
| `mytechin.approvalMode` | `askForRisky` | Approval strictness |
| `mytechin.autoApproveSafeTools` | `true` | Whether safe tools skip approval |
| `mytechin.maxToolIterations` | `24` | Per-task tool-call limit |
| `mytechin.maxContextTokens` | `32000` | Approximate context budget |
| `mytechin.maxFileReadBytes` | `262144` | Per-read file limit |
| `mytechin.enableWorkspaceIndex` | `true` | Workspace scanner/indexing |
| `mytechin.enableCheckpoints` | `true` | Pre-edit snapshots |
| `mytechin.verifyAfterEdit` | `true` | Diagnostic verification after edits |
| `mytechin.planBeforeExecute` | `false` | Require an editable plan first |
| `mytechin.excludePatterns` | `[]` | Additional search/index exclusions |
| `mytechin.terminalTimeout` | `120000` | Command timeout in milliseconds |
| `mytechin.warnOnSensitiveUpload` | `true` | Confirm sensitive cloud uploads |
| `mytechin.mcpConfigPath` | `.mytechin/mcp.json` | MCP server configuration |

## Operational limitations

The extension is deliberately best-effort in areas where VS Code or a provider
does not expose authoritative information:

- semantic quality depends on the embedding model;
- graph resolution is not type-aware;
- diagnostics depend on installed language extensions;
- targeted tests are suggested, not silently run;
- command execution is host execution, not a sandbox;
- MCP processes are trusted local processes;
- provider APIs and Puter's endpoint shape may change;
- token accounting is approximate.

