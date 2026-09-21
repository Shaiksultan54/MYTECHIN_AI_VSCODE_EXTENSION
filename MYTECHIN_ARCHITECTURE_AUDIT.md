# MYTECHIN AI Architecture Audit

## 1. Current Architecture Overview

The MYTECHIN AI extension currently implements a robust baseline structure for an AI coding assistant. The architecture is modular and separates concerns reasonably well:
- **Core Loop (`AgentLoop.ts`)**: Manages the interaction between the LLM provider, context gathering, tool execution, and the UI. It includes streaming and basic cancellation.
- **State Management (`AgentState.ts`)**: Tracks the current phase (`idle`, `streaming`, `running-tool`, etc.), tool iterations, and prevents exact duplicate tool calls.
- **Tool System (`ToolRegistry.ts`, `ToolExecutor.ts`)**: Uses a definition schema with `preview` and `execute` methods. Supports file operations (read, write, apply patch) and terminal commands.
- **Workspace Security (`FileWriter.ts`, `PathSecurity.ts`)**: Some path resolution exists, but validation is naive.
- **Approval System (`ApprovalManager.ts`, `ApprovalPolicy.ts`)**: Turns risk levels into interactive webview prompts for user approval.
- **Provider Abstractions (`AIProvider.ts`)**: Supports multiple providers (Ollama, Anthropic, Gemini, OpenAI, Puter, etc.).

## 2. Strengths

- **Modular Design**: Providers, tools, and the agent loop are well-separated.
- **Extensive Provider Support**: The codebase already has stubs/implementations for many LLM providers, including a decent local `OllamaProvider.ts` implementation.
- **Streaming UI**: The agent loop streams responses and supports cancellation via `AbortController` and `CancellationToken`.
- **Tool Call Deduplication**: The agent state keeps a 40-item signature history to prevent the model from getting stuck in exact repeat loops.
- **Basic Tool Previews**: Tools have `preview()` functions to show the user what will happen before execution.

## 3. Weaknesses & Risk Areas

- **Agent State**: `AgentState.ts` lacks the rich structured state described in the new requirements (taskId, plan, structured token usage, cost, diagnostics, etc.).
- **Terminal Security**: `commandTools.ts` relies on a regex blacklist (`DESTRUCTIVE_COMMAND_PATTERNS`) rather than a strict ALLOW/ASK/BLOCK policy framework.
- **File Editing Risks**: `FileWriter.ts` relies on VS Code's `fs.writeFile` to replace entire files. While `applyPatchTool` exists, fallback mechanisms to ensure syntax correctness, unique-matches (beyond simple `indexOf`), and atomic rollbacks are immature.
- **Context Management**: There is no sophisticated context tiers/compaction. `AgentLoop.ts` pushes all tools and conversation history; if the model context limit is hit, it will likely crash or truncate unexpectedly.
- **Missing Code Intelligence**: No active LSP integrations (diagnostics, symbol search, go to definition) are currently utilized in the toolset.
- **Missing OmniRoute Provider**: The gateway routing, fallback, and quota management (the `OmniRouteProvider`) is absent.
- **Missing Sub-Agents**: The architecture supports a single agent loop. There's no isolation for sub-agents (Planner, Reviewer).
- **RAG & MCP Implementation**: `VectorStore.ts` exists but full RAG semantic retrieval is under-developed. MCP is present in the codebase but lacks strict permission sandboxing.

## 4. Missing Components

1. **Structured Agent Runtime (`AgentOrchestrator`)**: Needs explicit phases (PLANNING, DISCOVERY, etc.).
2. **Advanced Workspace Intelligence**: Deep LSP integration and symbol indexing.
3. **OmniRoute Gateway Integration**: A dedicated provider for OmniRoute with fallback logic.
4. **Context Engine**: Tiered context (active task vs repo context vs history) with intelligent token trimming.
5. **Cost/Token Budget Enforcement**: Hard caps on task spend and session spend.
6. **Multi-Agent Orchestration**: Scoped sub-agents with constrained permissions.
7. **Automated Verification Loop**: Post-edit builds/tests and self-repair.

## 5. Recommended Migration Sequence

Following the objective outlined, the recommended migration is:
1. **Agent State & Runtime**: Upgrade `AgentState.ts` to include the explicit phases and structured metadata. Refactor `AgentLoop.ts` into a bounded orchestrator.
2. **Tool Registry & Code Intelligence**: Expand `ToolRegistry.ts` to include LSP tools (diagnostics, workspace symbols).
3. **Safe File Editing & Terminal Policy**: Harden `FileWriter.ts` with atomic writes/rollbacks and upgrade `commandTools.ts` to use strict ALLOW/ASK/BLOCK policies.
4. **Context Engine & Verification**: Implement context compaction logic in `ContextManager.ts` and add a verification phase after writes.
5. **Model Abstraction & OmniRoute**: Introduce `OmniRouteProvider.ts` and refine the Free-First model selection policy.
6. **Multi-Agent & Observability**: Introduce bounded sub-agents and structured event logging.
7. **Performance & Tests**: Optimize indexing and add end-to-end tests for the new architecture.

## 6. Files/Modules Status

- **Preserve**: `WebviewProvider.ts`, `ExtensionController.ts`, `Logger.ts`, most of the UI layer.
- **Refactor**: `AgentState.ts` (needs expansion), `AgentLoop.ts` (needs sub-agent support and verification), `commandTools.ts` (needs strict policies), `FileWriter.ts` (needs strict boundaries and rollbacks), `applyPatchTool` (needs stricter validation).
- **New Required**: `OmniRouteProvider.ts`, `ContextTierManager.ts`, `LspTools.ts` (for diagnostics and symbols), `AgentOrchestrator.ts` (for multi-agent), `BudgetManager.ts`.
