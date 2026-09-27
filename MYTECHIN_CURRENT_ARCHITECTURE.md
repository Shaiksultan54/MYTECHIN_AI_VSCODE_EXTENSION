# Mytechin AI — Current Architecture

**Document version:** 3.0.0
**Audit date:** 2026-09-27
**Status:** Current implementation baseline

This document describes the architecture that exists in the repository today.
The user-facing behavior is explained in [docs/FEATURE_GUIDE.md](docs/FEATURE_GUIDE.md).

## 1. System boundary

```text
VS Code extension host
  ├─ ExtensionController
  ├─ AgentRuntime / AgentOrchestrator
  ├─ Context, workspace, search, memory, checkpoint services
  ├─ ToolRegistry / ToolExecutor / approval policy
  └─ Provider and terminal adapters
             │ typed postMessage bridge
             ▼
React webview
  ├─ Chat and streaming messages
  ├─ Context, history, memory, settings
  ├─ Approval, plan, diff, and error cards
  └─ VS Code theme-safe presentation
```

The webview is untrusted presentation code. Filesystem, credentials, terminal
processes, provider requests, and VS Code APIs remain in the extension host.

## 2. Core modules

| Area | Implementation | Responsibility |
| --- | --- | --- |
| Lifecycle | `AgentRuntime`, `AgentState` | Cancellation, phases, one active task, stop behavior |
| Reasoning loop | `AgentOrchestrator` | Context, provider streaming, tool loop, repair guidance |
| Tools | `ToolRegistry`, `ToolExecutor`, `handlers/*` | Schema validation, risk classification, previews, execution |
| Approval | `ApprovalPolicy`, `ApprovalManager` | Safe/ask/strong decisions and per-task approvals |
| Context | `ContextManager`, `ContextCollector`, `ContextBudget` | Ranked repository context under a token budget |
| Workspace | `WorkspaceManager`, `WorkspaceScanner`, `WorkspaceWatcher` | Roots, ignore rules, project markers, change events |
| Graph | `WorkspaceGraph`, `graphTools` | Best-effort file dependency impact |
| Search | `SemanticSearchService`, `HybridRanker`, `VectorStore` | Lexical/semantic retrieval and local shard persistence |
| Providers | `ProviderManager`, provider adapters | Ollama, cloud, Puter, and compatible endpoints |
| Files | `FileReader`, `FileWriter`, `PathSecurity` | Bounded reads and atomic safe writes |
| Recovery | `CheckpointManager`, `DiffManager` | Pre-edit snapshots, compare, restore |
| Verification | `VerificationLoop` | Diagnostic diffing, test discovery, bounded repair messages |
| Persistence | `ConversationStore`, `SettingsStore`, `SecretStore` | Conversations, settings, credentials |
| Integrations | MCP and browser services | Optional external tools and web retrieval |

## 3. End-to-end execution

1. A command, context menu action, or webview message reaches
   `ExtensionController`.
2. `AgentRuntime.submit()` creates a cancellation token and starts one
   orchestrator task.
3. Optional plan-before-execute approval occurs before the model turn.
4. `ContextManager.build()` assembles explicit and inferred context.
5. `SystemPromptBuilder` describes tools and safety rules to the provider.
6. The provider streams text or native tool calls.
7. `ToolCallParser` handles the fallback protocol when native calls are absent.
8. `ToolExecutor` validates, classifies, previews, approves, and executes.
9. Results become tool messages for the next model iteration.
10. Edit tools trigger checkpointing, atomic writes, graph/index invalidation,
    and post-edit verification.
11. The task ends on a final answer, cancellation, a loop guard, or an error.

Hard bounds include `maxToolIterations`, duplicate-call detection, command
timeouts, file-read limits, context budgets, and a maximum of two verification
self-repair attempts.

## 4. Safety architecture

### Filesystem

`PathSecurity` rejects workspace escapes before I/O. `FileWriter` writes to a
sibling temporary file, attempts `fsync`, atomically renames over the target,
and cleans up on failure. Checkpoints are captured before the write sequence.

### Commands

`CommandPolicy` tokenizes shell input before allow/ask/block matching. It blocks
command substitution, encoded shell payloads, and chained-command allowlist
bypasses. Destructive operations remain behind `run_command` rather than being
given reassuring dedicated tools.

### Data

Credentials use VS Code SecretStorage. Sensitive files are excluded from
automatic context and cloud upload requires confirmation when configured.
The webview has a restrictive content security policy and no direct filesystem
or network access.

## 5. Repository intelligence

The workspace scanner detects project markers and language/framework signals.
The watcher updates source-dependent services incrementally. The graph parses
common import forms for TypeScript/JavaScript, Python, Go, and C# and exposes
`get_impact`.

The LSP tool group delegates exact symbol work to installed VS Code language
servers. This separation is intentional: the graph is cheap and resilient,
while LSP is more precise but depends on language-server availability.

## 6. Search and semantic indexing

Lexical search works without a model. When Ollama is active, embeddings default
to the configured local `nomic-embed-text` model. Missing models are detected
through `/api/tags` and the UI offers a pull command. Vectors are stored in
bounded path-hashed shards under `.mytechin/index/vectors/`.

The current similarity query scans loaded vectors linearly. Sharding solves
monolithic persistence and file-size pressure; it is not a replacement for an
ANN database at very large scale.

## 7. Current limitations and deliberate boundaries

- Graph resolution is best-effort and not type-aware.
- Exact symbol results depend on installed language extensions.
- Diagnostics and targeted-test discovery are provider/tooling dependent.
- Suggested tests are not silently executed; execution follows command approval.
- Host commands and MCP servers are not sandboxed.
- Cloud provider APIs and Puter's endpoint may change.
- Token counts are estimates.
- Non-Ollama semantic search requires an explicitly available embedding path;
  lexical search remains the fallback.

These are documented product boundaries, not hidden behavior. Future work
should improve them without weakening the approval and filesystem guarantees.
