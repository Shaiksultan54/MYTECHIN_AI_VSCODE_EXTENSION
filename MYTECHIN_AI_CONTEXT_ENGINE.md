# MYTECHIN AI — Context Engine & Token Budgeting Architecture

**Document Version:** 2.0.0  
**Classification:** Core Subsystem Architecture  
**Author:** Principal Architect & Staff AI Engineer  

---

## 1. Overview & Core Philosophy

Large language models degrade rapidly when flooded with irrelevant context. The primary duty of the **MYTECHIN Context Engine** (`src/core/context/ContextManager.ts`, `ContextBudget.ts`, `ContextCollector.ts`) is to assemble a dynamic, high-density **Context Bundle** that supplies maximum relevance per token consumed.

### Golden Rules of Context Assembly
1. **Never exhaust the context window:** Always maintain an explicit safety margin for model reasoning and tool output.
2. **Prioritize precise symbols over entire files:** A 20-line method definition is 50x cheaper and 10x more accurate than a 1,000-line source file.
3. **Preserve human constraints:** Active editor selections, user attachments, and compiler errors are inviolable and never dropped during compaction.

---

## 2. The 7-Level Context Hierarchy

Context is structured into 7 distinct tiers, ranked by strict priority:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       MYTECHIN CONTEXT TIER HIERARCHY                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  LEVEL 0: WORKSPACE METADATA                                                │
│  - Architecture stack, languages, package managers, root directories        │
│                                                                             │
│  LEVEL 1: REPOSITORY MAP                                                    │
│  - Entry points, core services, folder topology (~300 tokens)               │
│                                                                             │
│  LEVEL 2: EXPLICIT USER CONTEXT                                             │
│  - Active editor selections, attached files, pinned snippets, screenshots   │
│                                                                             │
│  LEVEL 3: ACTIVE EDITOR & PROBLEMS                                          │
│  - Currently visible document lines, compiler/linter diagnostics errors     │
│                                                                             │
│  LEVEL 4: EXPLICIT @MENTIONS                                                │
│  - @file, @folder, @problems, @terminal resolutions                         │
│                                                                             │
│  LEVEL 5: CODE INTELLIGENCE & SYMBOLS                                       │
│  - LSP symbols, function signatures, interface contracts, hover types       │
│                                                                             │
│  LEVEL 6: RELEVANT SEARCH & RETRIEVAL                                       │
│  - Keyword ripgrep matches, semantic vector chunks, project memory rules    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Dynamic Context Budgeting & Compaction Algorithm

The `ContextBudget` engine (`src/core/context/ContextBudget.ts`) manages strict token budgets before any request reaches the model provider.

### Budget Partitioning
For a configured context budget of $B$ tokens (default: 32,000 tokens):
- **Safety Margin:** $\max(1000, \lfloor B \times 0.15 \rfloor)$ reserved for system prompt, tool definitions, and model generation.
- **Effective Context Budget ($E$):** $B - \text{Margin}$.

### Compaction Execution
When candidate context exceeds $E$:
1. **Sort:** Order candidate pieces by `SOURCE_PRIORITY[source] - relevanceScore`.
2. **Greedy Fitting:** Accumulate items until remaining budget is below 64 tokens.
3. **Targeted Compaction:**
   - Pieces in Tier 6 (Search/Semantic) are pruned or dropped first.
   - Large files are truncated with explicit notice markers (`… truncated to fit context budget …`).
   - If remaining allowance is below 200 tokens, low-priority items are cleanly dropped rather than leaving a useless 3-line fragment.
4. **Immutability of Critical Anchors:** Active selections, compiler diagnostics, and workspace overviews are never discarded.

---

## 4. Progressive Context Disclosure

MYTECHIN enforces a step-by-step progressive disclosure workflow during multi-turn agent tasks:

```
[TURN 1: DISCOVERY]
Prompt -> Read Repository Map -> Find Symbol Location
Tokens Consumed: ~1,500

[TURN 2: INSPECTION]
Read precise symbol range (e.g. lines 45–95 of InvoiceService.cs)
Tokens Consumed: ~2,500

[TURN 3: DEPENDENCY CHECK]
Find references / callers of CalculateGST() via LSP
Tokens Consumed: ~3,200

[TURN 4: EDIT]
Apply targeted unified patch -> Verify diagnostics
Tokens Consumed: ~4,000
```

By expanding context only when necessary, MYTECHIN accomplishes complete refactoring tasks using **< 10% of the tokens** consumed by naive whole-file assistants.

## 5. Workspace dependency impact

`src/core/workspace/WorkspaceGraph.ts` maintains a cheap, file-level dependency
graph for TypeScript/JavaScript, C#, Python, and Go. It recognizes common
`import`, `require`, and `using` forms and records imported names when the
statement makes them apparent. `get_impact(file)` reports both the files the
target imports and the files that import the target.

The graph is built lazily and updated incrementally for source-file
create/save/delete events from `WorkspaceWatcher`; project-marker changes
invalidate the graph because they may alter workspace boundaries and ignore
rules. This is deliberately a **best-effort static approximation**, not a
type-aware resolver: aliases, package exports, generated code, dynamic imports,
and language-specific compiler semantics may be unresolved or omitted. Use
language-server definition/reference tools when exact symbol relationships are
required.

Before an edit tool runs, the context engine adds the target file's impact
summary so exported API changes can be reviewed with known dependents first.
