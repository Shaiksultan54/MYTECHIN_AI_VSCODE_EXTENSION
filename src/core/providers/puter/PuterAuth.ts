import { joinUrl, request } from '../http.js';
import { ProviderError } from '../ProviderTypes.js';
import { PuterErrorMapper } from './PuterErrorMapper.js';

export interface PuterAuthStatus {
  authType: 'account' | 'temporary' | 'none';
  username?: string;
  connected: boolean;
}

/**
 * Manages the Puter bearer token for the extension host.
 *
 * Two authentication paths:
 *   1. **Account token** — the user creates a token at puter.com/dashboard and
 *      pastes it into VS Code SecretStorage. This is the recommended path.
 *   2. **Temporary guest** — if no token is stored the extension calls Puter's
 *      /signup endpoint with `is_temp: true` to bootstrap a free session. This
 *      is an onboarding convenience, NOT a quota-bypass mechanism.
 *
 * The token is **never** logged, sent to the webview, or written to
 * settings.json. It lives only in extension-host memory and SecretStorage.
 */
export class PuterAuth {
  private token: string | undefined;
  private baseUrl = 'https://api.puter.com';
  private verified = false;
  private authType: 'account' | 'temporary' | 'none' = 'none';
  private username: string | undefined;
  private guestPromise: Promise<string> | undefined;

  // ─── Configuration ────────────────────────────────────────────────

  configure(baseUrl: string | undefined, token: string | undefined): void {
    const nextBase = (baseUrl?.trim() || 'https://api.puter.com').replace(/\/+$/, '');
    const nextToken = token?.trim() || undefined;

    if (nextBase !== this.baseUrl || nextToken !== this.token) {
      this.verified = false;
      this.guestPromise = undefined;
      this.username = undefined;
    }
    this.baseUrl = nextBase;
    this.token = nextToken;
    this.authType = nextToken ? 'account' : 'none';
  }

  // ─── Public accessors ─────────────────────────────────────────────

  get apiBase(): string {
    return this.baseUrl;
  }

  /** Base URL for the OpenAI-compatible chat endpoint. */
  get openaiBase(): string {
    return joinUrl(this.baseUrl, '/puterai/openai/v1');
  }

  get hasToken(): boolean {
    return Boolean(this.token);
  }

  getStatus(): PuterAuthStatus {
    return {
      authType: this.authType,
      username: this.username,
      connected: this.verified
    };
  }

  // ─── Token management ─────────────────────────────────────────────

  /**
   * Returns a valid bearer token. If none is configured, creates a free
   * temporary guest session via Puter's documented signup endpoint.
   */
  async ensureToken(): Promise<string> {
    if (this.token) {
      return this.token;
    }

    // Auto-create a temporary guest token (one concurrent attempt only)
    if (!this.guestPromise) {
      this.guestPromise = this.createGuestToken();
    }
    try {
      const guestToken = await this.guestPromise;
      this.token = guestToken;
      this.authType = 'temporary';
      return guestToken;
    } catch {
      this.guestPromise = undefined;
      throw new ProviderError(
        'not-configured',
        'Could not create a Puter session.',
        'Create a free Puter account at https://puter.com and add the token in provider settings, or check your internet connection.'
      );
    }
  }

  /** Returns `Authorization` headers. Throws if no token is available. */
  authHeaders(): Record<string, string> {
    if (!this.token) {
      throw new ProviderError(
        'not-configured',
        'Puter has no API token.',
        'Click "Test Connection" to auto-create a free session, or add a Puter token manually.'
      );
    }
    return { Authorization: `Bearer ${this.token}` };
  }

  /** Async version that ensures a token exists first. */
  async authHeadersAsync(): Promise<Record<string, string>> {
    await this.ensureToken();
    return this.authHeaders();
  }

  // ─── Verification ─────────────────────────────────────────────────

  /** Confirms the token is live. Cached until configuration changes. */
  async verify(force = false): Promise<PuterAuthStatus> {
    if (this.verified && !force) {
      return this.getStatus();
    }

    await this.ensureToken();

    try {
      const response = await request(joinUrl(this.baseUrl, '/whoami'), {
        headers: this.authHeaders(),
        timeoutMs: 8000
      });
      const data = (await response.json()) as { username?: string; is_temp?: boolean };

      this.verified = true;
      this.username = data.username;

      // Refine auth type based on server response
      if (data.is_temp) {
        this.authType = 'temporary';
      } else if (this.authType !== 'account') {
        this.authType = data.username ? 'account' : 'temporary';
      }

      return this.getStatus();
    } catch (error) {
      this.verified = false;
      throw PuterErrorMapper.map(error);
    }
  }

  /** Clears the current token and verification state. */
  disconnect(): void {
    this.token = undefined;
    this.verified = false;
    this.authType = 'none';
    this.username = undefined;
    this.guestPromise = undefined;
  }

  // ─── Private ──────────────────────────────────────────────────────

  /**
   * Creates a free temporary guest token via Puter's signup endpoint.
   * This is the same mechanism puter.js uses in the browser for anonymous
   * users. It is NOT used to evade quotas or rotate identities.
   */
  private async createGuestToken(): Promise<string> {
    const response = await request(joinUrl(this.baseUrl, '/signup'), {
      method: 'POST',
      body: { is_temp: true },
      timeoutMs: 15000
    });
    const data = (await response.json()) as { token?: string; proceed?: boolean };
    if (!data.token) {
      throw new Error('Puter signup did not return a token.');
    }
    return data.token;
  }
}
