import { ProviderError, type ProviderErrorKind } from '../ProviderTypes.js';

/**
 * Turns Puter-specific errors into the shapes the UI knows how to explain.
 * Covers both the OpenAI-compatible endpoint and the /signup + /whoami
 * responses.
 */
export class PuterErrorMapper {
  static map(error: unknown): ProviderError {
    if (error instanceof ProviderError) {
      return error;
    }

    const payload = error as {
      code?: string;
      message?: string;
      status?: number;
      error?: { code?: string; message?: string; type?: string };
    };

    const code = payload?.code ?? payload?.error?.code ?? '';
    const type = payload?.error?.type ?? '';
    const message = payload?.message ?? payload?.error?.message ?? String(error);
    const status = payload?.status ?? 0;

    // ── Known Puter error codes ──────────────────────────────────

    const table: Record<string, [ProviderErrorKind, string, string, boolean]> = {
      // Auth errors
      token_missing: ['auth', 'Puter is not signed in.', 'Add a Puter API token in provider settings or click Test Connection.', false],
      invalid_token: ['auth', 'The Puter token was rejected.', 'The token may have expired. Create a new one at puter.com/dashboard.', false],
      permission_denied: ['auth', 'Puter refused the request.', 'The token may not have AI permissions. Check your Puter account.', false],

      // Rate limits and quotas
      insufficient_funds: ['rate-limit', 'Puter usage limit reached.', 'Wait a moment or switch to a local Ollama model.', true],
      rate_limit_exceeded: ['rate-limit', 'Puter rate limit reached.', 'Wait a moment and retry, or switch to Ollama.', true],

      // Model errors
      no_implementation_available: ['model-not-found', 'This model is not available on Puter.', 'Refresh the model list and pick another model.', false],
      model_not_found: ['model-not-found', 'The selected model was not found.', 'Refresh the model list — this model may have been removed.', false],

      // Request errors
      error_400_from_delegate: ['bad-response', 'The upstream model rejected the request.', 'Try a smaller context or a different model.', false]
    };

    const hit = table[code];
    if (hit) {
      return new ProviderError(hit[0], hit[1], hit[2], hit[3]);
    }

    // ── OpenAI-style error types ─────────────────────────────────

    if (type === 'invalid_api_key' || type === 'authentication_error') {
      return new ProviderError('auth', 'Puter authentication failed.', 'Check your Puter API token.');
    }

    // ── HTTP status fallbacks ────────────────────────────────────

    if (status === 401 || status === 403) {
      return new ProviderError('auth', 'Puter authentication failed.', 'The API token is invalid or expired. Create a new one at puter.com/dashboard.');
    }
    if (status === 429) {
      return new ProviderError('rate-limit', 'Puter rate limit reached.', 'Wait a moment and retry, or switch to Ollama.', true);
    }
    if (status === 404) {
      return new ProviderError('model-not-found', 'The Puter endpoint returned 404.', 'The model or endpoint may no longer exist. Refresh the model list.');
    }

    // ── Content pattern matching ─────────────────────────────────

    if (/context|too (long|large)|max.*tokens|maximum.*context/i.test(message)) {
      return new ProviderError(
        'context-too-large',
        'The request was too large for this model.',
        'Attach fewer files or lower the context budget in settings.'
      );
    }

    if (/timeout|timed out|ETIMEDOUT/i.test(message)) {
      return new ProviderError(
        'unavailable',
        'The Puter request timed out.',
        'Check your internet connection and retry.',
        true
      );
    }

    if (/ECONNREFUSED|ENOTFOUND|fetch failed|network/i.test(message)) {
      return new ProviderError(
        'unavailable',
        'Could not reach Puter.',
        'Check your internet connection or try again later.',
        true
      );
    }

    // ── Unknown ──────────────────────────────────────────────────

    return new ProviderError('unknown', message || 'Puter returned an unexpected error.');
  }
}
