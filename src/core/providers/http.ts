import { ProviderError } from './ProviderTypes.js';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** `fetch` with a timeout, cancellation and provider-shaped errors. */
export async function request(url: string, options: RequestOptions = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 120_000);

  const onAbort = (): void => controller.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal
    });
    if (!response.ok) {
      throw await toProviderError(response, url);
    }
    return response;
  } catch (error) {
    if (error instanceof ProviderError) {
      throw error;
    }
    if (options.signal?.aborted) {
      throw new ProviderError('aborted', 'Request cancelled.');
    }
    if ((error as Error)?.name === 'AbortError') {
      throw new ProviderError('unavailable', 'The request timed out.', 'Check the endpoint is reachable, then retry.', true);
    }
    const message = (error as Error)?.message ?? String(error);
    throw new ProviderError(
      'unavailable',
      `Could not reach ${safeHost(url)}.`,
      /ECONNREFUSED|fetch failed/i.test(message)
        ? 'Nothing is listening on that address. Check the service is running and the URL is right.'
        : message,
      true
    );
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

async function toProviderError(response: Response, url: string): Promise<ProviderError> {
  let detail = '';
  try {
    detail = (await response.text()).slice(0, 600);
  } catch {
    // Body already consumed or unavailable.
  }
  const host = safeHost(url);
  switch (response.status) {
    case 401:
    case 403:
      return new ProviderError('auth', 'Authentication failed.', 'Check the API key saved for this provider, then try again.');
    case 404:
      return new ProviderError('model-not-found', `${host} returned 404.`, 'The model or endpoint path may be wrong. Refresh the model list.');
    case 429:
      return new ProviderError('rate-limit', 'Rate limit reached.', 'Wait a moment and retry, or switch to a local model.', true);
    case 413:
      return new ProviderError('context-too-large', 'The request was too large for this model.', 'Attach fewer files or lower the context budget in settings.');
    default:
      if (response.status >= 500) {
        return new ProviderError('unavailable', `${host} returned ${response.status}.`, 'The service had a problem. Retrying is safe.', true);
      }
      if (/context length|too many tokens|maximum context/i.test(detail)) {
        return new ProviderError('context-too-large', 'The request exceeded the model context window.', 'Attach fewer files or lower the context budget in settings.');
      }
      return new ProviderError('bad-response', `${host} returned ${response.status}.`, detail || undefined);
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'the provider';
  }
}

/** Reads a response body line by line. Used for NDJSON and SSE transports. */
export async function* readLines(response: Response, signal?: AbortSignal): AsyncGenerator<string> {
  const body = response.body;
  if (!body) {
    throw new ProviderError('bad-response', 'The provider returned an empty response body.');
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const onAbort = (): void => void reader.cancel().catch(() => undefined);
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let index = buffer.indexOf('\n');
      while (index >= 0) {
        yield buffer.slice(0, index).replace(/\r$/, '');
        buffer = buffer.slice(index + 1);
        index = buffer.indexOf('\n');
      }
    }
    if (buffer.trim().length > 0) {
      yield buffer;
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    reader.releaseLock?.();
  }
}

export function joinUrl(base: string, suffix: string): string {
  return `${base.replace(/\/+$/, '')}/${suffix.replace(/^\/+/, '')}`;
}
