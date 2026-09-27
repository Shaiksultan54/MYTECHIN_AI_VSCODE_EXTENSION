# Mytechin AI — Index and Workspace Storage

**Document version:** 3.0.0
**Status:** Current implementation
**Scope:** `.mytechin/` workspace data, semantic vectors, and invalidation
## 1. Storage principles

Mytechin keeps workspace state local to the workspace and separates durable
user data from generated indexes:

- settings and credentials stay in VS Code configuration and SecretStorage;
- project memory is human-managed data;
- indexes are disposable caches and may be rebuilt;
- paths are normalized for cross-platform comparison;
- source changes are invalidated incrementally where possible.

The extension does not currently write a SCIP symbol database or a serialized
full call graph. Language-server providers remain the authority for exact
symbol relationships.

## 2. Directory layout

```text
<workspace-root>/
└── .mytechin/
    ├── memory.json                 # Project rules and approved memories
    ├── mcp.json                    # Optional stdio MCP server configuration
    └── index/
        └── vectors/
            ├── <path-hash>-0.json  # Bounded semantic-vector shard
            └── <path-hash>-1.json  # Additional shard when needed
```

`metadata.json`, `symbols.json`, and `graph.json` are not required outputs of
the current implementation. Workspace metadata and the dependency graph are
rebuilt or held by their owning services rather than being presented as a
stable public file format.

## 3. Vector shard format

Each shard is JSON with the following shape:

```json
{
  "documents": [
    {
      "id": "chunk-123",
      "uriPath": "src/core/example.ts",
      "text": "export function example() {}",
      "startLine": 1,
      "endLine": 1,
      "hash": "sha256-of-source-or-chunk"
    }
  ],
  "vectors": {
    "chunk-123": [0.0124, -0.0452, 0.0891]
  }
}
```

The filename is derived from a SHA-256 hash of `uriPath`. A source path is
assigned to a stable path shard, and a shard is capped at 500 chunks. The
bounded format prevents one repository-wide JSON file from being parsed and
rewritten for every index operation.

The current store loads shard contents into memory for similarity search and
rewrites the grouped shard files during `save()`. This bounds individual file
size but does not yet provide an ANN index or fully out-of-core querying.

## 4. Legacy migration

Older installations may contain:

```text
.mytechin/index/vectors.json
```

On load, the store imports that file into the shard layout, saves the shards,
and removes the legacy file after a successful migration. A failed migration
is logged and does not delete the legacy data.

## 5. Invalidation

`WorkspaceWatcher` observes source and project-marker changes:

1. source create/save/delete events update the changed graph entry and notify
   search/index services;
2. project-marker changes invalidate scanner and graph state because roots,
   languages, and ignore rules may have changed;
3. semantic chunks are compared using document hashes so unchanged content can
   be retained;
4. deleting a source removes its vector documents and stale shard data on the
   next save.

## 6. WorkspaceGraph data model

`WorkspaceGraph` is an in-memory, file-level approximation. An edge contains:

```text
importer: src/app.ts
target:   src/lib.ts
symbols:  ["greet"]
```

It recognizes common relative TypeScript/JavaScript imports and `require`
calls, Python `from ... import ...` forms, and common Go/C# `using` patterns.
Resolution uses workspace files and common extensions/index candidates.

The graph intentionally does not claim compiler-level correctness. Dynamic
imports, aliases, generated code, package exports, and language-specific
module resolution can be unresolved. Use `find_definition` and
`find_references` for exact symbol-level answers.

## 7. Security and privacy

`.mytechin/` may contain project rules and generated index data. It should be
excluded from source control unless a team explicitly wants to share it.
Sensitive files are excluded from indexing by the normal workspace ignore and
sensitive-file rules. Cloud upload confirmation is controlled by
`mytechin.warnOnSensitiveUpload`.
