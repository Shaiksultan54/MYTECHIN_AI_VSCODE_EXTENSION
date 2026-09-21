# MYTECHIN AI — Security, Governance & Permission Boundaries

**Document Version:** 2.0.0  
**Classification:** Core Security Architecture  
**Author:** Principal Architect & Staff AI Engineer  

---

## 1. Security Axioms & Threat Model

An autonomous software engineering agent possesses the capability to execute commands, modify files, and communicate with external services. Without rigorous boundaries, an agent introduces severe risks:
1. **Destructive Execution:** Accidental data loss via `rm -rf`, disk wipes, or database drops.
2. **Directory Traversal:** Escaping workspace roots to modify system files (`/etc/passwd`, `C:\Windows`).
3. **Secret Exfiltration:** Sending `.env`, private keys, or credentials to remote LLM endpoints.
4. **Untrusted MCP Code Execution:** Unsandboxed external Model Context Protocol tools.

MYTECHIN enforces **defense-in-depth** across every layer:

```
MODEL PROPOSAL
      │
      ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. PATH RESOLUTION & SECURITY (PathSecurity.ts)             │
│    - Rejects NULL bytes, traversal outside open roots       │
│    - Filters credentials & private keys                     │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. TERMINAL COMMAND CLASSIFIER (CommandPolicy.ts)           │
│    - ALLOW (safe read-only queries)                         │
│    - ASK (mutations, builds, commits)                       │
│    - BLOCK (hardblocked wipes, format, fork bombs)          │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. HUMAN APPROVAL ENGINE (ApprovalPolicy.ts)                │
│    - Action category classification (READ, WRITE, EXECUTE)  │
│    - Visual Diff Preview before execution                   │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. ATOMIC EXECUTION & ROLLBACK (FileWriter.ts, Checkpoints) │
│    - Writes to .tmp staged file -> Atomic rename            │
│    - Rollback map enables instant one-click revert          │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Path Security & Root Boundary Enforcement

All path operations funnel exclusively through `PathSecurity.ts`:
- **Boundary Verification:** `resolveWithinRoots(roots, candidate)` normalizes paths and guarantees the target remains strictly within the active workspace roots.
- **Cross-Platform Normalization:** Resolves POSIX and Windows drive letters correctly without platform injection errors.
- **Credential Protection:** Files matching `SENSITIVE_PATTERNS` (`.env*`, `*secret*`, `*credentials*`, `*.pem`, `*.key`, `id_rsa`) are blocked from auto-indexing and writing.

---

## 3. Terminal Execution Security: ALLOW / ASK / BLOCK Engine

Rather than relying solely on naive regex filters, `CommandPolicy.ts` inspects command tokens and intent:

### 3.1 Hard-Blocked Commands (Always Denied)
These commands are terminated immediately with a security rejection:
- File system wipes: `rm -rf /`, `del /s /q C:\`, `Remove-Item -Recurse -Force /`
- Disk overwrite & formatting: `mkfs`, `dd if=`, `format C:`
- System state disruption: `shutdown`, `reboot`
- Fork bombs: `:(){ :|:& };:`
- Web script pipes: `curl ... | bash`, `wget ... | sh`
- Public publishing: `npm publish`

### 3.2 Safe Read-Only Commands (ALLOW)
Queries that do not modify state run without friction when permitted by policy:
- Git status / diff / log: `git status`, `git diff`, `git log`, `git show`
- Unit testing: `npm test`, `npx vitest`, `dotnet test`, `cargo test`, `pytest`
- Environment queries: `node -v`, `git --version`, `pwd`, `dir`, `ls`

### 3.3 Mutating Operations (ASK)
Commands that install dependencies, modify code, or trigger git commits require explicit approval.

---

## 4. Human-in-the-Loop Governance & Action Categories

Mutating actions are categorized into 8 explicit types:
- `READ`: Safe read-only inspections (auto-approved by default).
- `WRITE`: File modifications and creations (presents visual diff).
- `EXECUTE`: Shell executions (shows command, working directory, and risk).
- `NETWORK`: Web browsing and external HTTP queries.
- `GIT`: Branch switches, commits, resets.
- `DATABASE`: Migrations and SQL commands.
- `SECRET`: Protected credential files.
- `MCP`: External Model Context Protocol tools (evaluated as untrusted).

The user can choose from 4 approval modes:
1. `alwaysAsk`: Prompts for every operation, including reads.
2. `askForRisky`: Auto-approves safe reads; asks for file edits, executions, and deletions.
3. `autoApproveSafe`: Auto-approves reads and non-destructive edits; asks for executions and deletions.
4. `autonomous`: Autonomous execution (developer opt-in).
