# MYTECHIN AI — Master Platform Architecture Specification

**Document Version:** 2.0.0  
**Status:** Approved Architectural Specification  
**Classification:** Core System Architecture  
**Author:** Principal Architect & Staff AI Engineer  

---

## 1. Executive Summary & Core Engineering Philosophy

The primary objective of **MYTECHIN AI** is to serve as a **model-independent, repository-aware software engineering agent platform**.

### The Fundamental Axiom
> **MYTECHIN AI MUST NOT DEPEND ON SENDING THE ENTIRE REPOSITORY INTO MODEL CONTEXT.**  
> **MYTECHIN MUST UNDERSTAND THE REPOSITORY FIRST; THE MODEL RECEIVES THE RIGHT INFORMATION AT THE RIGHT TIME.**

Modern enterprise codebases (such as multi-tier Angular + .NET solutions, microservices, and monorepos) easily exceed tens or hundreds of thousands of lines of code. Blindly dumping whole files into context windows causes catastrophic token bloat, high costs, degraded reasoning, lost-in-the-middle phenomena, and severe hallucinations.

Instead, MYTECHIN enforces an evidence-based pipeline:

$$\begin{aligned}
\text{REPOSITORY} &\longrightarrow \text{INDEX} \longrightarrow \text{STRUCTURE} \longrightarrow \text{SYMBOLS} \longrightarrow \text{RELATIONSHIPS} \\
&\longrightarrow \text{SEARCH} \longrightarrow \text{RETRIEVAL} \longrightarrow \text{CONTEXT ASSEMBLY} \longrightarrow \text{MODEL} \\
&\longrightarrow \text{TOOLS} \longrightarrow \text{PATCH} \longrightarrow \text{DIFF} \longrightarrow \text{APPROVAL} \\
&\longrightarrow \text{APPLY} \longrightarrow \text{BUILD} \longrightarrow \text{TEST} \longrightarrow \text{REVIEW} \longrightarrow \text{RESULT}
\end{aligned}$$

---

## 2. High-Level System Architecture

The MYTECHIN platform is implemented purely in **TypeScript/Node.js**, leveraging existing VS Code APIs, Language Server Protocol (LSP), local indexers, and non-destructive virtual document providers:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            VS CODE HOST ENVIRONMENT                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌───────────────────────┐          IPC Messages         ┌───────────────┐  │
│  │   React 18 Webview    │ <===========================> │   Extension   │  │
│  │      Sidebar UI       │                               │  Controller   │  │
│  └───────────────────────┘                               └───────┬───────┘  │
│                                                                  │          │
│  ┌───────────────────────────────────────────────────────────────┴───────┐  │
│  │                        AGENT ORCHESTRATOR                             │  │
│  │  - Phase State Machine (Planning, Discovery, Implementation, etc.)     │  │
│  │  - Iteration & Loop Bounding (Max Iterations, Repeat Deduplication)   │  │
│  │  - Checkpoint Turns & Task Lifecycle                                  │  │
│  └───────┬───────────────────────┬───────────────────────────────┬───────┘  │
│          │                       │                               │          │
│          ▼                       ▼                               ▼          │
│  ┌───────────────┐       ┌───────────────┐               ┌───────────────┐  │
│  │    PROJECT    │       │    CONTEXT    │               │  SAFE TOOLS   │  │
│  │ INTELLIGENCE  │       │    ENGINE     │               │   & ENGINE    │  │
│  ├───────────────┤       ├───────────────┤               ├───────────────┤  │
│  │ - Metadata    │       │ - Tiers 0–5   │               │ - Atomic Write│  │
│  │ - Repo Map    │       │ - Budgeting   │               │ - LSP Tools   │  │
│  │ - IgnoreRules │       │ - Compaction  │               │ - Cmd Policy  │  │
│  │ - Watchers    │       │ - Safety Cap  │               │ - Rollback    │  │
│  └───────┬───────┘       └───────┬───────┘               └───────┬───────┘  │
│          │                       │                               │          │
│          └───────────────────────┼───────────────────────────────┘          │
│                                  ▼                                          │
│                      ┌───────────────────────┐                              │
│                      │  MODEL ABSTRACTION    │                              │
│                      ├───────────────────────┤                              │
│                      │ - ProviderManager     │                              │
│                      │ - ModelProfileRegistry│                              │
│                      │ - OmniRoute / Ollama  │                              │
│                      │ - OpenAI / Anthropic  │                              │
│                      └───────────────────────┘                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Subsystem Breakdown & Component Matrix

| Subsystem | Key Components | Architectural Function |
| :--- | :--- | :--- |
| **Agent Orchestrator** | `AgentOrchestrator.ts`, `AgentState.ts`, `AgentRuntime.ts`, `ToolCallParser.ts` | Governs the outer lifecycle loop, state machine transitions, cancellation tokens, tool call chunk assembly, and iteration deduplication. |
| **Project Intelligence** | `ProjectIntelligenceService.ts`, `ProjectMetadata.ts`, `WorkspaceScanner.ts`, `IgnoreRules.ts` | Detects technology stacks (Angular, .NET, React, Python, Go), extracts entry points and services, maintains compact repository maps, and updates incrementally via file watchers. |
| **Context Engine** | `ContextManager.ts`, `ContextCollector.ts`, `ContextBudget.ts`, `ContextRanker.ts` | Multi-tiered context assembler that estimates tokens, enforces safety margins, ranks items by relevance score, and compacts lower-priority items. |
| **Tool Registry & LSP** | `ToolRegistry.ts`, `ToolExecutor.ts`, `lspTools.ts`, `writeTools.ts`, `readTools.ts` | Canonical tool definitions. Includes first-class Language Server Protocol tools: document symbols, workspace symbols, definitions, references, and hovers. |
| **Safe File Editing** | `FileWriter.ts`, `PathSecurity.ts`, `CheckpointManager.ts`, `DiffManager.ts` | Guarantees atomic writes via temporary file staging and overwrite renaming; maintains instantaneous rollback history; checks path traversal boundaries across OSes. |
| **Terminal Security** | `CommandPolicy.ts`, `commandTools.ts`, `TerminalManager.ts`, `ApprovalPolicy.ts` | Evaluates shell commands against an explicit `ALLOW / ASK / BLOCK` security engine; maps operations to action categories (`READ`, `WRITE`, `EXECUTE`, `GIT`, `DATABASE`, `SECRET`). |
| **Model Abstraction** | `ProviderManager.ts`, `ModelProfile.ts`, `OmniRouteProvider.ts`, `OllamaProvider.ts` | Decouples the core agent from specific LLM vendors; translates canonical tool schemas into provider-aligned dialects; provides intelligent fallback routing via OmniRoute. |
| **Verification & Sub-Agents** | `VerificationLoop.ts`, `SubAgent.ts` | Runs post-edit diagnostics and test selection; formulates structured repair prompts for self-healing; provisions scoped sub-agents with restricted permissions. |

---

## 4. Key Architectural Invariants

1. **Model Independence:** Core agent code never imports vendor SDKs (`@anthropic-ai/sdk`, `openai`, `@google/genai`). Communication flows strictly through `AIProvider` and `BaseProvider`.
2. **Read Before Write:** Mutating tools verify that files have been inspected in the active turn or task before applying modifications.
3. **Atomic File Safety:** All file modifications write to `.tmp` files first before renaming, preventing corrupt partial writes if an editor or disk process interrupts.
4. **Non-Destructive Diffs:** Diffs are rendered in-memory using VS Code's `mytechin-diff:` virtual document provider; no scratch files pollute the workspace.
5. **No Blind Full-Repository Scans:** Repository maps are compact, ranking entry points and architectural boundaries without exceeding token limits.
6. **Explicit Terminal Verification:** Destructive shell commands (e.g. disk formatting, root wipes, piped network scripts) are blocked at the engine level regardless of approval settings.
