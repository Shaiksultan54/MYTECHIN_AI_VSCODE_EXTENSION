# MYTECHIN AI — Model Abstraction & Provider Architecture

**Document Version:** 2.0.0  
**Classification:** Core Subsystem Architecture  
**Author:** Principal Architect & Staff AI Engineer  

---

## 1. Executive Summary & Independence Axiom

MYTECHIN AI is built on a **model-independent architecture**. The runtime, tool execution engine, checkpoint manager, and workspace intelligence layers have zero compile-time dependencies on vendor-specific SDKs.

Any capable model—whether running locally via **Ollama**, routed dynamically through **OmniRoute**, or accessed via **Anthropic**, **OpenAI**, **Gemini**, or **OpenAI-compatible endpoints**—can drive MYTECHIN without architectural changes.

---

## 2. Core Abstractions & Interfaces

### 2.1 The Provider Seam (`AIProvider`)
All models integrate through `AIProvider` (`src/core/providers/AIProvider.ts`):

```typescript
export interface AIProvider {
  readonly id: ProviderId;
  readonly name: string;
  readonly isCloud: boolean;
  readonly requiresSecret: boolean;

  configure(config: ProviderConfig): void;
  listModels(): Promise<ModelInfo[]>;
  chat(request: AIRequest): Promise<AIResponse>;
  stream(request: AIRequest, onEvent: (event: AIStreamEvent) => void): Promise<void>;
  testConnection(): Promise<ProviderStatus>;

  supportsTools(): boolean;
  supportsVision(): boolean;
  supportsReasoning(): boolean;
}
```

### 2.2 Provider Adapters Matrix
| Provider Adapter | Target Infrastructure | Secret Required | Default Endpoint |
| :--- | :--- | :--- | :--- |
| `OllamaProvider` | Local hardware (GPU/CPU) | ❌ No | `http://127.0.0.1:11434` |
| `OmniRouteProvider` | OmniRoute Gateway (Auto/Free-First) | ❌ Optional | `http://127.0.0.1:8000/v1` |
| `OpenAICompatibleProvider` | vLLM, LM Studio, Together, Groq | ⚠️ Depends | User-configured |
| `AnthropicProvider` | Claude 3.5 Sonnet / Claude 3 Opus | ✅ Yes | `https://api.anthropic.com` |
| `GeminiProvider` | Google Gemini 1.5 Pro / Flash | ✅ Yes | Google AI Studio |
| `OpenAIProvider` | GPT-4o, o1, Codex | ✅ Yes | `https://api.openai.com/v1` |
| `PuterProvider` | Serverless browser-backed cloud AI | ❌ No | `https://api.puter.com` |

---

## 3. Provider-Aligned Model Profiles

Models interpret tool schemas and instructions differently. Forcing Claude, GPT, and local Llama to use an identical tool-calling schema degrades performance.

MYTECHIN introduces `ModelProfileRegistry` (`src/core/providers/ModelProfile.ts`):

```
┌─────────────────────────────────────────────────────────────┐
│                    MODEL PROFILE REGISTRY                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  openai-codex       Dialect: native-openai                  │
│                     Preferred Edit: unified-patch           │
│                     Context: 128k, Output: 4k               │
│                                                             │
│  anthropic-claude   Dialect: native-anthropic               │
│                     Preferred Edit: find-replace-block      │
│                     Context: 200k, Output: 8k               │
│                                                             │
│  google-gemini      Dialect: native-gemini                  │
│                     Preferred Edit: unified-patch           │
│                     Context: 1,000k, Output: 8k             │
│                                                             │
│  local-ollama       Dialect: xml-tags                       │
│                     Preferred Edit: find-replace-block      │
│                     Context: 32k, Output: 4k                │
│                                                             │
│  omniroute-routed   Dialect: native-openai                  │
│                     Preferred Edit: find-replace-block      │
│                     Context: 128k, Output: 4k               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. OmniRoute Integration & Fallback Strategy

The `OmniRouteProvider` (`src/core/providers/omniroute/OmniRouteProvider.ts`) connects MYTECHIN to OmniRoute's routing engine:

1. **Quota-Aware Routing:** Distributes requests based on token limits and provider health.
2. **FREE_FIRST Policy:** Prefers zero-cost local models (e.g. Qwen 2.5 Coder, Llama 3) before escalating to cloud-based options.
3. **Resilient Auto-Fallback:** If a primary model encounters HTTP 429 (rate limit) or 503 (unavailable), the adapter automatically redirects the in-flight request to `omniroute/auto` without aborting the developer's task.
