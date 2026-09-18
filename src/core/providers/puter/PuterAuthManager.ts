import { joinUrl, request } from '../http.js';
import { ProviderError } from '../ProviderTypes.js';
import { PuterErrorMapper } from './PuterErrorMapper.js';

/**
 * Holds the Puter bearer token. If no manual token is provided, automatically
 * creates a free temporary guest token from Puter's signup endpoint.
 * The token is never handed to the webview, and never logged.
 */
export class PuterAuthManager {
  private token: string | undefined;
  private baseUrl = 'https://api.puter.com';
  private verified = false;
  private autoTokenPromise: Promise<string> | undefined;

  configure(baseUrl: string | undefined, token: string | undefined): void {
    const nextBase = (baseUrl?.trim() || 'https://api.puter.com').replace(/\/+$/, '');
    if (nextBase !== this.baseUrl || token !== this.token) {
      this.verified = false;
      this.autoTokenPromise = undefined;
    }
    this.baseUrl = nextBase;
    this.token = token?.trim() || undefined;
  }

  get apiBase(): string {
    return this.baseUrl;
  }

  get hasToken(): boolean {
    return Boolean(this.token);
  }

  /** Returns true if we have a token OR can auto-generate one. */
  get canAuthenticate(): boolean {
    return true; // We can always auto-generate a guest token
  }

  async ensureToken(): Promise<string> {
    if (this.token) {
      return this.token;
    }
    // Auto-create a temporary guest token from Puter
    if (!this.autoTokenPromise) {
      this.autoTokenPromise = this.createGuestToken();
    }
    try {
      const autoToken = await this.autoTokenPromise;
      this.token = autoToken;
      return autoToken;
    } catch {
      this.autoTokenPromise = undefined;
      throw new ProviderError(
        'not-configured',
        'Could not auto-create a Puter session.',
        'Create a free Puter account at https://puter.com and add the token in provider settings, or check your internet connection.'
      );
    }
  }

  authHeaders(): Record<string, string> {
    if (!this.token) {
      throw new ProviderError(
        'not-configured',
        'Puter has no API token.',
        'Click "Test connection" to auto-create a free session, or add a Puter token manually.'
      );
    }
    return { Authorization: `Bearer ${this.token}` };
  }

  async authHeadersAsync(): Promise<Record<string, string>> {
    const token = await this.ensureToken();
    return { Authorization: `Bearer ${token}` };
  }

  /** Confirms the token is live. Cached so it runs once per configuration. */
  async verify(force = false): Promise<{ username?: string }> {
    if (this.verified && !force) {
      return {};
    }
    await this.ensureToken();
    try {
      const response = await request(joinUrl(this.baseUrl, '/whoami'), {
        headers: this.authHeaders(),
        timeoutMs: 8000
      });
      const data = (await response.json()) as { username?: string };
      this.verified = true;
      return data;
    } catch (error) {
      this.verified = false;
      throw PuterErrorMapper.map(error);
    }
  }

  /**
   * Creates a free temporary guest token by calling Puter's signup endpoint.
   * This is the same mechanism puter.js uses in the browser.
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
