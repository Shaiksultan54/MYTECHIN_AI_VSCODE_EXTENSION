# Development

## Prerequisites

- Node 18 or newer
- VS Code 1.90 or newer
- Ollama running locally, for the fastest feedback loop

## Setup

```bash
npm run install:all
```

This installs the extension dependencies and then the webview's own
dependencies under `webview-ui/`. The two are separate npm projects: the
extension host runs in Node and never imports React, and the webview runs in a
browser sandbox and never imports `vscode`.

## The loop

```bash
npm run watch:extension   # esbuild, rebuilds dist/extension.js
npm run watch:webview     # vite, rebuilds webview-ui/dist
```

Then press `F5` in VS Code to launch the Extension Development Host.

Changes to the webview need a reload of the webview only: run
**Developer: Reload Webviews** from the command palette. Changes to the
extension host need a full **Developer: Reload Window**.

## Verify

```bash
npm run verify    # typecheck → lint → test → build
```

Run this before packaging. The individual steps:

```bash
npm run typecheck   # tsc on both projects
npm run lint        # eslint on src/
npm run test        # vitest
npm run build       # webview bundle, then extension bundle
npm run package     # mytechin-ai.vsix
```

## Layout

```
src/
  extension.ts               Activation. Constructs the controller and registers everything.
  commands/                  The 17 contributed commands. No logic, just wiring.
  webview/                   WebviewViewProvider: CSP, nonce, message plumbing.
  shared/                    Types, protocol and constants shared with the webview.
    types.ts                 View models. Never imports `vscode`.
    messages/                Webview → extension. One discriminated union.
    events/                  Extension → webview. One discriminated union.
    schemas/tools.ts         Tool names, risk classification, destructive patterns.
  core/
    controller/              ExtensionController: the single wiring point.
    agent/                   AgentRuntime, AgentLoop, AgentState, ToolCallParser.
    providers/               Provider abstraction plus one folder per provider.
    tools/                   Registry, executor, and the tool handlers.
    context/                 Collection, ranking, budgeting, attachments.
    conversation/            Persistence and the three memory scopes.
    workspace/               Path safety, ignore rules, reading, writing, searching.
    approval/                Policy and the approval gate.
    checkpoints/             Snapshots and the diff editor.
    terminal/                Command execution with capture and timeout.
    prompt/                  System prompt assembly.
    storage/                 Settings and SecretStorage.
    logging/                 Output channel with redaction.
  test/                      Vitest specs plus the `vscode` stub.
webview-ui/
  src/
    App.tsx                  Shell: header, panel switching, composer.
    state/store.tsx          Reducer over ExtensionEvent. The only state container.
    components/              One folder per feature area.
    utils/markdown.tsx       Markdown → React elements. No innerHTML anywhere.
    styles.css               VS Code theme variables only.
```

## Rules the code follows

**The webview never touches the filesystem.** It has no `vscode` import, no
Node APIs, and a CSP that blocks every remote origin. Everything it knows
arrives as an `ExtensionEvent`; everything it wants happens by posting a
`WebviewMessage`.

**Paths are resolved once, centrally.** `PathSecurity.resolveWithinRoots` is the
only way a path becomes absolute, and `WorkspaceManager` is the only module that
calls it. A tool that wants to read a file asks the workspace, never `fs`.

**The agent never imports a provider.** `AgentLoop` depends on the `AIProvider`
interface. Adding a provider means adding a folder under `core/providers/` and
registering it in `ProviderManager` — nothing in the agent changes.

**Errors are values, not exceptions, at the tool boundary.** `ToolExecutor`
catches everything and returns a failed `ToolResult`, so the model gets told what
went wrong and can try something else instead of the task dying.

**No second version of anything.** One markdown renderer, one diff viewer, one
approval path, one settings store.

## Adding a provider

1. Create `src/core/providers/<name>/<Name>Provider.ts` extending `BaseProvider`.
2. Implement `listModels`, `stream` and `testConnection`. Use `request` and
   `readLines` from `../http.js` so timeouts, cancellation and error mapping
   behave like the others.
3. Register it in `ProviderManager`'s constructor and add the id to
   `ProviderId` in `shared/types.ts`.
4. Add the enum value and any settings to `package.json`.
5. Map its failures onto `ProviderError` kinds — `auth`, `model-not-found`,
   `rate-limit`, `context-too-large` and so on — so the UI can offer the right
   hint.

## Adding a tool

1. Write the definition in the right file under `core/tools/handlers/`.
2. Add its name and risk to `shared/schemas/tools.ts`.
3. Export it from `handlers/index.ts`.
4. If it changes a file, call `ctx.checkpoints.captureBeforeChange` first and
   provide a `preview` that returns a diff. The approval gate does the rest.

## Testing

Unit tests cover the pure logic: path safety, the tool-call parser, the context
budget, approval policy, ignore rules, provider stream parsing, diff generation.
They run in Node against a small `vscode` stub in `src/test/vscode-stub.ts`.

Anything needing real editor behaviour — decorations, the diff editor, the
webview lifecycle — belongs in an integration test run inside VS Code, which is
not part of this suite.

## Manual smoke test

1. Open a project with authentication code in it.
2. Select Ollama and a tool-capable model.
3. Ask: *Find where authentication is implemented.* The agent should search,
   read a few files, and answer with file references — without prompting you,
   because reads are Safe.
4. Ask: *Change the access token expiration to 60 minutes.* The agent should
   locate the setting, propose a diff, and wait.
5. Approve. The file is written, and a checkpoint appears in History.
6. Restore the checkpoint and confirm the file returns to its previous state.
