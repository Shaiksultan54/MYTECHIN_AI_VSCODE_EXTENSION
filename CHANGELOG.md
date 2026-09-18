# Changelog

All notable changes to LocalCode AI are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-09-18

First release.

### Added

- **Sidebar chat panel** with streaming replies, tool activity rows, inline
  approval cards, conversation history and a context inspector.
- **Provider abstraction** with five implementations: Ollama (local, default),
  OpenAI, Anthropic, any OpenAI-compatible endpoint, and Puter. Credentials are
  held in VS Code SecretStorage.
- **Agent loop** with bounded iterations, cancellation, repeated-call detection
  and structured error reporting.
- **Seventeen tools** spanning reading, searching, editing, deleting, running
  commands and asking the user, each classified Safe, Ask or Strong.
- **Universal tool-calling transport** — native function calling where the
  provider supports it, and an incremental `<tool name="…">` text parser where
  it does not.
- **Approval system** with four modes, unified diffs before every write, and
  destructive-command detection that escalates risk at runtime.
- **Checkpoints**: files are snapshotted before the agent changes them, with
  compare and restore from the History panel.
- **Context pipeline**: intent classification, attachments, `@` mentions,
  editor state, problems, repository search, priority ranking and a token
  budget that trims rather than truncating blindly.
- **Workspace intelligence**: project map across C#/.NET, Angular, React, Node,
  Python, Java, Go, Rust and PHP, with `.gitignore` and exclusion handling.
- **Path security**: every path resolved inside an open workspace folder, with
  traversal and sensitive-file protection.
- **17 commands**, editor and Explorer context menus, and keybindings.
- **106 unit tests** covering path safety, the tool-call parser, context
  budgeting, approval policy, ignore rules, Ollama streaming and diff output.

### Known limitations

- The Puter integration targets an API that is not formally versioned and is
  therefore best-effort.
- Retrieval is lexical; there is no embedding index yet.
- Token counts are estimated rather than tokenized.
