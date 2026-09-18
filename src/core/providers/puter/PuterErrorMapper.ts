import { ProviderError, type ProviderErrorKind } from '../ProviderTypes.js';

/** Turns Puter driver errors into the shapes the UI knows how to explain. */
export class PuterErrorMapper {
  static map(error: unknown): ProviderError {
    if (error instanceof ProviderError) {
      return error;
    }

    const payload = error as { code?: string; message?: string; error?: { code?: string; message?: string } };
    const code = payload?.code ?? payload?.error?.code ?? '';
    const message = payload?.message ?? payload?.error?.message ?? String(error);

    const table: Record<string, [ProviderErrorKind, string, string]> = {
      token_missing: ['auth', 'Puter is not signed in.', 'Add a Puter API token in provider settings.'],
      invalid_token: ['auth', 'The Puter token was rejected.', 'The token may have expired. Add a new one in provider settings.'],
      permission_denied: ['auth', 'Puter refused the request.', 'The token may not have AI permissions.'],
      insufficient_funds: ['rate-limit', 'The Puter account is out of credit.', 'Top up the account or switch to a local Ollama model.'],
      rate_limit_exceeded: ['rate-limit', 'Puter rate limit reached.', 'Wait a moment and retry.'],
      no_implementation_available: ['model-not-found', 'Puter has no backend for that model.', 'Refresh the model list and pick another model.'],
      error_400_from_delegate: ['bad-response', 'The upstream model rejected the request.', 'Try a smaller context or a different model.']
    };

    const hit = table[code];
    if (hit) {
      return new ProviderError(hit[0], hit[1], hit[2], hit[0] === 'rate-limit');
    }

    if (/context|too (long|large)|max.*tokens/i.test(message)) {
      return new ProviderError(
        'context-too-large',
        'The request was too large for that model.',
        'Attach fewer files or lower the context budget in settings.'
      );
    }

    return new ProviderError('unknown', message || 'Puter returned an unexpected error.');
  }
}
