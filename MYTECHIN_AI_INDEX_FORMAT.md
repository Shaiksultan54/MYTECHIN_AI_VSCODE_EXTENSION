# MYTECHIN AI — Index Formats, Storage & Data Schemas

**Document Version:** 2.0.0  
**Classification:** Core Data Schema Specification  
**Author:** Principal Architect & Staff AI Engineer  

---

## 1. Overview & Storage Philosophy

To scale gracefully from small libraries to 100,000+ file enterprise repositories, MYTECHIN stores index data using **versioned, isolated, and incrementally-updated files** within the workspace `.mytechin/` directory.

### Storage Principles
1. **Zero Monolithic Bloat:** Files are indexed on demand; large repositories are never ingested wholesale into memory.
2. **Deterministic Invalidation:** Caches are keyed by file modification timestamps and SHA-256 hashes.
3. **Cross-Platform Portability:** Forward slashes and normalized paths are enforced across Windows and POSIX systems.

---

## 2. Directory Layout

```
<workspace-root>/
└── .mytechin/
    ├── metadata.json          # ProjectMetadata (Architecture, roots, entry points)
    ├── memory.json            # ProjectMemory (Architectural rules and constraints)
    ├── mcp.json               # Model Context Protocol server configurations
    └── index/
        ├── symbols.json       # SCIP-compatible symbol index and definitions
        ├── graph.json         # Dependency & call graph relationships
        └── vectors.json       # Optional semantic code and documentation embeddings
```

---

## 3. Index Schemas

### 3.1 Project Metadata (`metadata.json`)
```json
{
  "projectId": "d:/zip/localcode-ai-source",
  "workspaceRoot": "d:/zip/localcode-ai-source",
  "projectName": "localcode-ai-source",
  "detectedLanguages": ["TypeScript", "JavaScript"],
  "frameworks": ["React", "Node"],
  "packageManagers": ["npm"],
  "buildSystems": ["npm run build"],
  "projectType": "node-project",
  "sourceRoots": ["src"],
  "testRoots": ["src/test"],
  "generatedRoots": ["dist"],
  "excludedRoots": [],
  "configFiles": ["package.json", "tsconfig.json"],
  "entryPoints": ["src/extension.ts"],
  "services": ["core", "webview"],
  "packages": ["mytechin-ai"],
  "lastIndexedAt": 1758438120000,
  "indexVersion": "1.0.0"
}
```

### 3.2 SCIP-Compatible Symbol Index (`symbols.json`)
Symbols maintain stable, range-independent identifiers:
$$\text{Symbol ID} = \text{scheme} : \text{package} : \text{path} : \text{descriptor}$$

```json
{
  "version": "1.0.0",
  "symbols": [
    {
      "id": "mytechin:localcode-ai-source:src/core/workspace/FileWriter.ts#FileWriter#write()",
      "name": "write",
      "kind": "method",
      "path": "src/core/workspace/FileWriter.ts",
      "startLine": 29,
      "endLine": 61,
      "signature": "async write(resolved: ResolvedPath, content: string): Promise<WriteResult>",
      "container": "FileWriter",
      "docstring": "Writes file atomically via temp file staging and rename."
    }
  ]
}
```

### 3.3 Code Graph & Dependency Edges (`graph.json`)
Tracks import hierarchies, call chains, and impact radius:

```json
{
  "nodes": [
    { "id": "src/core/workspace/FileWriter.ts", "type": "file" },
    { "id": "src/core/workspace/PathSecurity.ts", "type": "file" },
    { "id": "FileWriter", "type": "class" },
    { "id": "write", "type": "method" }
  ],
  "edges": [
    { "from": "src/core/workspace/FileWriter.ts", "to": "src/core/workspace/WorkspaceManager.ts", "type": "imports" },
    { "from": "FileWriter", "to": "write", "type": "contains" },
    { "from": "write", "to": "readCurrent", "type": "calls" }
  ]
}
```

### 3.4 Optional Semantic Embeddings (`vectors.json`)
```json
{
  "version": "1.0.0",
  "model": "nomic-embed-text",
  "documents": [
    {
      "id": "chunk_fw_01",
      "uriPath": "src/core/workspace/FileWriter.ts",
      "startLine": 1,
      "endLine": 65,
      "hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "text": "export class FileWriter { ... }"
    }
  ],
  "vectors": {
    "chunk_fw_01": [0.0124, -0.0452, 0.0891, "..."]
  }
}
```

---

## 4. Cache Invalidation & Incremental Synchronization

1. **Watchers:** File system events (`onDidChange`, `onDidCreate`, `onDidDelete`) trigger incremental index updates.
2. **Selective Invalidation:** When `FileWriter.ts` changes, only its symbols, call graph edges, and associated vector chunks are invalidated.
3. **Stale Patch Guard:** If a file's disk hash changes between reading and applying a patch, the edit is aborted and re-read, preventing race condition corruptions.
