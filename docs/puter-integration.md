# Puter Integration Architecture

LocalCode AI integrates with the Puter AI Gateway via the official OpenAI-compatible endpoint (`https://api.puter.com/puterai/openai/v1/`).

## Why the OpenAI-Compatible Endpoint?
Puter officially provides the `@heyputer/puter.js` SDK. However, this SDK requires Node 24+, and relies on browser environments for authentication (`getAuthToken()`). Because VS Code extensions run in an Electron Node.js environment (typically Node 20–22) without a browser, we use the officially recommended fallback for backend systems: the OpenAI-compatible endpoint.

## Authentication and "User-Pays" Model
Puter operates on a "User-Pays" model. Developers can integrate Puter for free, and users authenticate with their own Puter accounts to cover usage costs (with a generous free tier).

LocalCode AI supports two authentication paths:
1. **Account Session (Recommended)**: The user creates an API token at `puter.com/dashboard` and saves it in LocalCode AI. The token is securely stored in VS Code `SecretStorage`.
2. **Temporary Guest Session**: If no token is provided, the extension calls Puter's `/signup` endpoint with `is_temp: true` to provision a free, temporary session. This is an onboarding convenience and not a mechanism to bypass quotas.

## Model Discovery
Models are fetched dynamically from `/puterai/openai/v1/models`. Because the Puter AI Gateway proxies multiple providers (Anthropic, OpenAI, Mistral, Google), all available models are treated as "Free via Puter" subject to Puter's account quotas.

We infer capabilities (tool support, vision support, upstream provider) from model IDs because the OpenAI `/models` response format is limited.

## Streaming and Tool Calling
The provider translates LocalCode AI requests into the standard OpenAI `chat/completions` format. It uses Server-Sent Events (SSE) to stream responses, extracting `text`, `reasoning_content` (for extended thinking models), and `tool_calls`. 

## Security and Privacy
- **Tokens are secure**: Puter tokens are stored in VS Code `SecretStorage` and never logged or exposed to the webview UI.
- **Cloud privacy**: Users are warned before attaching sensitive files (`.env`, private keys) to cloud providers like Puter.
- **No data harvesting**: The extension does not collect telemetry on prompts or AI responses.

## Fallback Behavior
If Puter experiences downtime or a rate limit is reached, users are presented with clear error messages mapping to specific scenarios (e.g., `rate-limit`, `auth`, `context-too-large`). The extension seamlessly supports falling back to local models via Ollama if cloud connectivity is lost.
