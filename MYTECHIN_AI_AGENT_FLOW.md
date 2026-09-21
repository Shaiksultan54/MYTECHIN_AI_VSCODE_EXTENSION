# MYTECHIN AI — Agent Orchestration, Verification & Lifecycle Flow

**Document Version:** 2.0.0  
**Classification:** Core Execution Architecture  
**Author:** Principal Architect & Staff AI Engineer  

---

## 1. The Autonomous Agent Lifecycle

MYTECHIN executes complex multi-step tasks using a deterministic, state-bounded state machine (`src/core/agent/AgentOrchestrator.ts`, `AgentState.ts`):

```
       USER TASK PROMPT
              │
              ▼
    ┌───────────────────┐
    │     PLANNING      │ ──> Analyze intent, select architecture strategy
    └─────────┬─────────┘
              │
              ▼
    ┌───────────────────┐
    │    DISCOVERY      │ ──> Read repository map, extract LSP symbols & types
    └─────────┬─────────┘
              │
              ▼
    ┌───────────────────┐
    │  IMPLEMENTATION   │ ──> Generate patch, validate uniqueness, preview diff
    └─────────┬─────────┘
              │
              ▼
    ┌───────────────────┐
    │    VALIDATION     │ ──> Check compiler diagnostics & execute targeted tests
    └─────────┬─────────┘
              │
         Errors Found?
        ┌─────┴─────┐
    Yes │           │ No
        ▼           ▼
  ┌───────────┐ ┌─────────┐
  │  REPAIR   │ │ REVIEW  │ ──> Summarize modifications, show final diff
  └─────┬─────┘ └────┬────┘
        │            │
        └────────────┼──> Verification Passed? ──> [COMPLETED]
                     │
              Repeated Failures / Max Retries ───> [FAILED]
```

---

## 2. Structured Agent State (`AgentStateData`)

Every active task maintains an auditable execution trace:

```typescript
export interface AgentStateData {
  taskId: string;               // Unique task UUID
  sessionId: string;            // Conversation session UUID
  workspaceRoot: string;        // Resolved workspace path
  phase: AgentPhase;            // Active lifecycle phase
  userRequest: string;          // Original human prompt
  plan?: string;                // Structured execution steps
  currentStep?: string;         // Current active step
  messages: any[];              // Multi-turn transcript
  toolCalls: any[];             // Executed tool calls
  toolResults: any[];           // Tool outputs
  changedFiles: string[];       // Modified files tracker (writeSet)
  diagnostics: any[];           // Compiler & linter diagnostics
  tests: any[];                 // Identified and executed tests
  buildResults: any[];          // Build execution logs
  retries: number;              // Repair attempts counter
  tokenUsage: TokenUsage;       // Prompt and completion tokens
  estimatedCost: number;        // Dollar spend tracking
  selectedModel: string;        // Active model ID
  provider: string;             // Active provider ID
  errors: string[];             // Accumulated error logs
  approvals: any[];             // User approvals record
  createdAt: number;            // Start timestamp
  updatedAt: number;            // Last update timestamp
}
```

---

## 3. Loop Detection & Repetition Bounding

To prevent runaway loops where a model repeatedly calls the same failing tool:
1. **Signature History:** `AgentState` hashes tool names and serialized arguments in a circular ring buffer (`signatures: string[]`).
2. **Deduplication Rejection:** If an identical tool call is attempted twice without intervening state changes, the orchestrator rejects the call and informs the model:
   > *"You already ran this exact tool call in this task and got a result. Use that result, or try something different. Do not repeat it again."*
3. **Hard Iteration Cap:** Tasks are bounded by `maxToolIterations` (default: 24 calls). If reached, the orchestrator halts safely and prompts the user.

---

## 4. Verification & Self-Repair Engine

Never trust an LLM's assertion that code works. The `VerificationLoop` (`src/core/agent/VerificationLoop.ts`) automatically validates the workspace:

1. **Diagnostics Inspection:** Queries `vscode.languages.getDiagnostics` across every file in `changedFiles`.
2. **Targeted Test Selection:** Matches changed files to unit test files (`*.test.ts`, `*Spec.cs`, `test_*.py`).
3. **Automated Repair Generation:** If compiler or lint errors exist, the verification engine constructs an explicit repair prompt:
   ```
   The recent file modifications introduced compilation/lint errors that must be resolved:
   - BILLITAPI/Services/InvoiceService.cs:84:15 [csharp]: The name 'TaxRate' does not exist in current context

   Please inspect the code at these locations and apply the necessary fixes.
   ```
4. **Bounded Retries:** The agent repairs within a strict retry budget (maximum 3 repair attempts) before escalating to the developer.

---

## 5. Non-Destructive Checkpoints & Rollbacks

Before mutating any file on disk:
1. `CheckpointManager` snapshots the original file state in extension storage.
2. `FileWriter` stages changes atomically via temporary files and rename operations.
3. If an edit fails verification or the developer rejects the change, the user can execute a **one-click rollback** directly from the chat UI without touching Git history.
