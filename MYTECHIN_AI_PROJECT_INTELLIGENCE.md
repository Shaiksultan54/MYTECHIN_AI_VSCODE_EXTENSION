# MYTECHIN AI — Project Intelligence & Repository Understanding

**Document Version:** 2.0.0  
**Classification:** Core Subsystem Architecture  
**Author:** Principal Architect & Staff AI Engineer  

---

## 1. Overview & Problem Definition

Traditional AI coding assistants rely on one of two flawed strategies:
1. **Blind File Ingestion:** Stuffing full files into context until the window overflows.
2. **Naive RAG / Vector Embedding:** Chunking arbitrary 500-token blocks of code without understanding imports, symbols, or compiler relationships.

**MYTECHIN AI replaces both with a first-class Project Intelligence Layer:**

$$\text{Codebase} \xrightarrow{\text{Watchers}} \text{Metadata} \xrightarrow{\text{LSP}} \text{Symbols \& Hierarchy} \xrightarrow{\text{Repository Map}} \text{Targeted Context}$$

The project intelligence layer allows MYTECHIN to reason about multi-project enterprise solutions (such as an Angular frontend communicating with a .NET backend, as seen in the BILLIT solution) without loading hundreds of megabytes of raw text into model context.

---

## 2. Project Metadata Engine

The `ProjectMetadataManager` (`src/core/workspace/ProjectMetadata.ts`) automatically discovers and persists workspace architecture without hardcoding assumptions:

### Metadata Structure
```typescript
export interface ProjectMetadata {
  projectId: string;              // Normalized workspace identifier
  workspaceRoot: string;          // Primary filesystem path
  projectName: string;            // Workspace or solution name
  detectedLanguages: string[];    // TypeScript, C#, Python, Go, Java, SQL, etc.
  frameworks: string[];           // Angular, React, .NET, NestJS, Express, Docker, etc.
  packageManagers: string[];      // npm, yarn, pnpm, nuget, pip, cargo, go modules
  buildSystems: string[];         // npm run build, dotnet build, maven, gradle
  projectType: string;            // e.g. 'fullstack-angular-dotnet', 'node-project'
  sourceRoots: string[];          // Detected source roots (src, app, lib, frontend, backend)
  testRoots: string[];            // Detected test roots (tests, spec, __tests__)
  generatedRoots: string[];       // Output roots (dist, build, bin, obj, target)
  excludedRoots: string[];        // Ignored roots
  configFiles: string[];          // Key configuration manifests found
  entryPoints: string[];          // Main application entry points
  services: string[];             // Microservices / backend modules
  packages: string[];             // Workspace packages
  lastIndexedAt: number;          // Timestamp
  indexVersion: string;           // Schema version
}
```

### Automatic Technology Detection
| Technology | Discovery Evidence |
| :--- | :--- |
| **Angular** | `@angular/core` in `package.json`, `angular.json` |
| **React / Next.js** | `react`, `react-dom`, `next` in `package.json` |
| **.NET / C#** | `*.csproj`, `*.sln`, `.cs` files, `Properties/launchSettings.json` |
| **NestJS / Express** | `@nestjs/core`, `express` in `package.json` |
| **Python** | `requirements.txt`, `pyproject.toml`, `Pipfile` |
| **Go** | `go.mod` |
| **Rust** | `Cargo.toml` |
| **Infrastructure** | `Dockerfile`, `docker-compose.yml`, `*.tf` |

---

## 3. Language Server Protocol (LSP) Code Intelligence

Rather than relying on inaccurate regex heuristics or heavy external parsers, MYTECHIN leverages the **native Language Server Protocol (LSP)** through VS Code's extension host:

```
┌─────────────────────────────────────────────────────────────┐
│                 MYTECHIN LSP INTELLIGENCE TOOLS             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  get_document_symbols ──> Classes, Methods, Interfaces,     │
│                           Functions & exact line ranges     │
│                                                             │
│  get_workspace_symbols ─> Global symbol index search across │
│                           the entire project                │
│                                                             │
│  get_definition ────────> Precise jump-to-declaration        │
│                           (File + Line + Column)            │
│                                                             │
│  get_references ────────> Find all usage call sites         │
│                           across frontend & backend         │
│                                                             │
│  get_hover ─────────────> Type signatures, docstrings, and  │
│                           inferred parameter constraints    │
└─────────────────────────────────────────────────────────────┘
```

### Symbol Hierarchy Normalization
LSP returns symbols as either hierarchical `vscode.DocumentSymbol` or flat `vscode.SymbolInformation`. MYTECHIN normalizes both into a unified, human-readable structure:
- **Symbol Kinds:** `class`, `interface`, `method`, `function`, `property`, `enum`, `constructor`, `variable`.
- **Precise Ranges:** 1-based `startLine` and `endLine` for targeted symbol extraction.

---

## 4. Smart Exclusion & Ignore Rules

To prevent indexing generated output or credential leaks:
1. **Default Ignore Patterns:** `.git`, `node_modules`, `bin`, `obj`, `dist`, `build`, `coverage`, `.angular`, `.next`, `vendor`.
2. **Sensitive Credential Protection:** `.env*`, `*secret*`, `*credentials*`, `*.pem`, `*.key`, `*.pfx`, `id_rsa`.
3. **Workspace `.gitignore` Ingestion:** Automatically compiles `.gitignore` files across all workspace folders.
4. **Dynamic Update:** File watchers detect changes to `.gitignore` and instantly invalidate cached matches.

---

## 5. Concise Repository Map Generation

The `ProjectIntelligenceService` (`src/core/workspace/ProjectIntelligenceService.ts`) synthesizes a high-density, low-token **Repository Map**:

```markdown
# Repository Map: BILLIT
- Type: fullstack-angular-dotnet
- Languages: TypeScript, C#, HTML, CSS, SQL
- Frameworks: Angular, .NET
- Package Managers: npm, nuget
- Build Systems: npm run build, dotnet build
- Source Roots: BILLITUI, BILLITAPI
- Test Roots: BILLITAPI.Tests, BILLITUI.Spec
- Services: InvoiceService, StockService, TaxService, AuthService
- Key Entry Points: BILLITUI/src/main.ts, BILLITAPI/Program.cs

## Structure Overview:
📁 BILLITUI/src/app/invoice
📁 BILLITUI/src/app/inventory
📁 BILLITAPI/Controllers
📁 BILLITAPI/Services
📁 BILLITAPI/Models
```

This map requires only **~300 tokens** and gives the LLM complete architectural awareness before any code is read.
