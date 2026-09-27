# Mytechin AI

[![CI](https://github.com/Shaiksultan54/MYTECHIN_AI_VSCODE_EXTENSION/actions/workflows/ci.yml/badge.svg)](https://github.com/Shaiksultan54/MYTECHIN_AI_VSCODE_EXTENSION/actions/workflows/ci.yml)

A local-first, project-aware AI coding agent that lives in the VS Code sidebar.
Bring your own model: a local Ollama server, Puter, OpenAI, Anthropic, or any
OpenAI-compatible endpoint. The default configuration sends nothing off your
machine.

It is a VS Code extension and nothing else — no CLI, no web app, no hosted
backend, no account.

## What it does

- **Answers questions about your codebase.** It searches and reads the project
  itself rather than waiting for you to paste files in.
- **Edits code with your approval.** Every change is shown as a diff before it
  is written, and every write is snapshotted so you can roll it back.
- **Runs commands when you say so.** Build, test, lint — with the command line
  shown to you first.
- **Works with any language.** C#/.NET, Angular, React, Node, TypeScript,
  JavaScript, Python, SQL, Java, Go, Rust, PHP, and mixed repositories.

For a complete explanation of the runtime, tools, safety boundaries, indexing,
providers, and settings, see the [Feature Guide](docs/FEATURE_GUIDE.md).

## Install

### From a packaged build

```bash
code --install-extension mytechin-ai.vsix
```

### From source

```bash
npm run install:all   # extension + webview dependencies
npm run build         # webview bundle, then the extension bundle
npm run package       # produces mytechin-ai.vsix
```

Open the Extension Development Host with `F5` to try it without packaging.
See [DEVELOPMENT.md](DEVELOPMENT.md) for the full loop.

## First run

1. Open a project folder.
2. Click the Mytechin AI icon in the activity bar, or press `Ctrl+Shift+L`
   (`Cmd+Shift+L` on macOS).
3. Pick a provider and a model next to the Send button.
4. Ask something.

### Ollama (default, fully local)

```bash
ollama serve
ollama pull qwen2.5-coder:7b
```

The extension talks to `http://127.0.0.1:11434` by default. Nothing leaves the
machine, there is no API key, and there is no rate limit.

Models with tool-calling support give the best results. `qwen2.5-coder`,
`llama3.1`, `mistral`, `devstral`, `codestral` and `firefunction` are detected
as tool-capable; others fall back to the text protocol described below, which
still works.

### Cloud providers

Open **Settings** in the panel, pick the provider, and click **Add credential**.
Keys go into VS Code's SecretStorage. They are never written to `settings.json`,
never logged, and never sent to the webview — the UI only ever learns whether a
credential exists.

| Provider | Needs a key | Notes |
| --- | --- | --- |
| Ollama | No | Local. The default. |
| OpenAI | Yes | `api.openai.com/v1`. |
| Anthropic | Yes | `api.anthropic.com/v1/messages`. |
| OpenAI-compatible | Usually | Set your own base URL, including `/v1`. Works with LM Studio, llama.cpp server, vLLM, Groq, Together, OpenRouter and similar. |
| Puter | Optional | Free cloud models. See below. |

### Using Puter (Free Cloud Models)

Puter provides access to powerful cloud models (like **Claude 3.5 Sonnet** and **GPT-4o**) completely **free of charge** under their User-Pays model.

By default, the extension will automatically create a temporary guest session to use these models for free without any configuration. However, if you want to link it to your actual Puter account (recommended to persist your limits and identity):
1. Log into [puter.com](https://puter.com).
2. Open your browser's Developer Tools (F12) and go to the **Console**.
3. Run this command to reveal your token: `puter.auth.getToken()`
4. Copy the output (without the quotes) and paste it into the extension's Settings by clicking **Add credential** under the Puter provider.

## Using it

### Context

The agent gathers context itself, but you can be explicit:

- **`@` mentions** — `@file src/auth.ts`, `@folder src/services`, `@workspace`,
  `@currentFile`, `@selection`, `@problems`, `@terminal`.
- **The `+` button** — attach files, a folder, the current file, your selection,
  the Problems panel, or the last command's output.
- **Drag and drop** files from the Explorer onto the composer.
- **Paste** a long block of code and it becomes an attachment instead of
  flooding the input box.

The **Context** button shows exactly what was sent to the model for the last
request — every file, its token cost, and why it was included. Nothing reaches
the model that is not listed there.

### Slash commands

`/explain`, `/fix`, `/review`, `/test`, `/refactor`, `/document`, `/search`.

### Editor and Explorer menus

Right-click a selection for Explain, Fix, Refactor, Generate Tests, or Add to
Chat. Right-click a file or folder in the Explorer for Explain, Review, or Add
to Chat.

### Keyboard

| Shortcut | Action |
| --- | --- |
| `Ctrl/Cmd+Shift+L` | Open the panel |
| `Ctrl/Cmd+Alt+L` | Add the selection to the chat |
| `Ctrl/Cmd+Alt+Escape` | Stop the agent |
| `Enter` | Send |
| `Shift+Enter` | Newline |
| `Escape` | Stop the agent while it is working |

## Safety

### Approval

Nothing that changes your project happens without you seeing it first.

| Mode | Reads | Edits | Commands & deletions |
| --- | --- | --- | --- |
| Always ask | Ask | Ask | Ask |
| **Ask for risky actions** (default) | Run | Ask | Ask |
| Auto-approve safe actions | Run | Run | Ask |
| Fully autonomous | Run | Run | Run |

Edits are presented as a unified diff before they are applied. Commands are
shown as the exact command line plus the working directory. Commands matching a
destructive pattern — `rm -rf`, `git reset --hard`, `DROP TABLE`, `curl … | sh`
and friends — are escalated to the strongest warning and can never be
auto-approved except in fully autonomous mode.

**A note on the default.** The specification asks for the safe option as the
default. `askForRisky` is that option, not `alwaysAsk`: the tool classification
in the same specification marks read-only tools as Safe, and the acceptance
scenario expects search-and-read to proceed without prompting. Nothing that
writes, deletes or executes is ever silent outside the opt-in autonomous mode.
Set `mytechin.approvalMode` to `alwaysAsk` if you would rather confirm reads
too.

### Checkpoints

Before the agent's first change in a turn, the affected files are snapshotted.
The History panel lists checkpoints with what changed; **Compare** opens a diff
against the current state and **Restore** rolls the files back after a modal
confirmation. Restores are never automatic.

### Boundaries

- Every path is resolved and verified to be inside an open workspace folder.
  `../` traversal, absolute paths outside the project and symlink escapes are
  refused before any I/O happens.
- `.gitignore`, `.ignore`, `files.exclude`, `search.exclude` and a built-in
  exclusion list are all honoured when indexing and searching.
- Files matching a sensitive pattern — `.env`, `*.pem`, `id_rsa`, `credentials.*`,
  `.npmrc`, `.aws/` — are never indexed or auto-included. You can attach one
  explicitly, and doing so triggers a modal confirmation before it reaches a
  cloud provider.
- The webview runs under a strict Content Security Policy: `default-src 'none'`,
  a nonce-gated script, no remote origins, and `connect-src 'none'`. It has no
  filesystem access and never receives a credential.

## Tools

The agent exposes read, search, editor, language-server, dependency-impact,
Git, browser, editing, and terminal tools. Risk drives the approval rules
above. The complete behavior is documented in the [Feature Guide](docs/FEATURE_GUIDE.md).

| Tool | Risk | What it does |
| --- | --- | --- |
| `read_file`, `read_files` | Safe | Read a file, or a line range |
| `search_code` | Safe | Text, filename or symbol search |
| `list_directory`, `get_file_metadata` | Safe | Inspect the tree |
| `get_current_file`, `get_selection` | Safe | What you are looking at |
| `get_problems` | Safe | Diagnostics from the Problems panel |
| `get_terminal_output` | Safe | Output of the last command it ran |
| `find_definition`, `find_references` | Safe | Language-server definition and call-site lookup |
| `workspace_symbols`, `document_symbols` | Safe | Language-server symbol lookup |
| `get_impact` | Safe | Approximate importers and dependencies for a file |
| `git_status`, `git_diff`, `git_log` | Safe | Read-only Git inspection |
| `git_commit`, `git_branch` | Ask | Approved Git mutation operations |
| `open_file`, `open_diff` | Safe | Show you something |
| `write_file`, `create_file`, `apply_patch` | Ask | Change a file |
| `delete_file` | Strong | Remove a file (to trash) |
| `run_command` | Strong | Run a shell command |
| `ask_user` | Ask | Ask you a question when the task is ambiguous |

### Tool calling on models without function calling

Providers with native tool calling are used natively. Everything else uses a
text protocol the agent parses out of the stream:

```
<tool name="read_file">{"path": "src/auth.ts"}</tool>
```

The parser is incremental, so a partial `<to` never flashes on screen, text that
merely looks like a tag (`<toolbar>`) is passed through untouched, and a block
truncated mid-stream is salvaged rather than lost. Malformed JSON gets one
repair attempt before the model is told what went wrong and asked to retry.

## Settings

All settings live under `mytechin.*` in VS Code settings. The most useful ones:

| Setting | Default | Meaning |
| --- | --- | --- |
| `provider` | `ollama` | Active provider |
| `model` | *(empty)* | Model id for that provider |
| `ollama.endpoint` | `http://127.0.0.1:11434` | Local Ollama server |
| `ollama.embeddingModel` | `nomic-embed-text` | Local model used for semantic-search embeddings |
| `approvalMode` | `askForRisky` | See the table above |
| `maxToolIterations` | `24` | Tool calls per task before the agent stops |
| `maxContextTokens` | `32000` | Approximate budget for everything sent |
| `maxFileReadBytes` | `262144` | Largest slice of one file per read |
| `enableCheckpoints` | `true` | Snapshot before editing |
| `excludePatterns` | `[]` | Extra globs on top of `.gitignore` |
| `terminalTimeout` | `120000` | Milliseconds before a command is cancelled |
| `warnOnSensitiveUpload` | `true` | Confirm before secrets reach the cloud |
| `enableWorkspaceIndex` | `true` | Maintain workspace metadata and dependency intelligence |
| `verifyAfterEdit` | `true` | Compare diagnostics after successful edits |
| `planBeforeExecute` | `false` | Require an editable plan before the agent starts |
| `mcpConfigPath` | `.mytechin/mcp.json` | MCP server configuration path |

## Known limitations

- **Puter** targets the `drivers/call` endpoint with the
  `puter-chat-completion` interface. That API is not formally versioned, so the
  integration is best-effort and may need adjusting if Puter changes it. The
  error messages will tell you when the response shape is not what was expected.
- **Semantic embeddings are local by default for Ollama.** The extension uses
  `nomic-embed-text` through Ollama when `provider` is `ollama`, and prompts you
  to pull the configured model when it is missing. Other providers remain
  lexical unless an embedding provider is explicitly configured.
- **Token counts are estimates.** Roughly 3.6 characters per token, which is
  close enough to keep a prompt from running away but is not a real tokenizer.
- **Providers cannot be exercised in CI.** The unit tests stub `fetch`; verifying
  against a live endpoint needs a real Ollama or a real key.

## Licence

MIT. See [LICENSE](LICENSE).
