import { afterEach, describe, expect, it, vi } from 'vitest';
import { request } from '../core/providers/http.js';
import { ProviderError } from '../core/providers/ProviderTypes.js';

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('request retry behavior', () => {
  it('retries a 500 and succeeds once the server recovers', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls++;
        return calls < 3 ? json({ error: 'boom' }, 500) : json({ ok: true });
      })
    );

    const response = await request('https://example.test/thing', { retries: 3 });
    expect(await response.json()).toEqual({ ok: true });
    expect(calls).toBe(3);
  });

  it('gives up after exhausting retries and surfaces the retryable error', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls++;
        return json({ error: 'boom' }, 500);
      })
    );

    await expect(request('https://example.test/thing', { retries: 2 })).rejects.toMatchObject({
      retryable: true
    });
    expect(calls).toBe(3); // initial attempt + 2 retries
  });

  it('never retries a non-retryable error like 404', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls++;
        return json({ error: 'missing' }, 404);
      })
    );

    await expect(request('https://example.test/thing', { retries: 3 })).rejects.toMatchObject({
      kind: 'model-not-found'
    });
    expect(calls).toBe(1);
  });

  it('does not retry at all when retries is 0', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls++;
        return json({ error: 'boom' }, 500);
      })
    );

    await expect(request('https://example.test/thing', { retries: 0 })).rejects.toMatchObject({
      retryable: true
    });
    expect(calls).toBe(1);
  });

  it('stops retrying immediately once the caller aborts', async () => {
    const controller = new AbortController();
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls++;
        controller.abort();
        return json({ error: 'boom' }, 500);
      })
    );

    await expect(
      request('https://example.test/thing', { retries: 3, signal: controller.signal })
    ).rejects.toBeInstanceOf(ProviderError);
    expect(calls).toBe(1);
  });

  it('reports each retry through onRetry with a positive backoff delay', async () => {
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls++;
        return calls < 2 ? json({ error: 'boom' }, 500) : json({ ok: true });
      })
    );

    const attempts: number[] = [];
    await request('https://example.test/thing', {
      retries: 2,
      onRetry: (attempt, delayMs) => {
        attempts.push(attempt);
        expect(delayMs).toBeGreaterThan(0);
      }
    });

    expect(attempts).toEqual([1]);
  });

  it('honours a signal that was already aborted, without calling fetch', async () => {
    const fetchMock = vi.fn(async () => json({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    controller.abort();

    await expect(request('https://example.test/thing', { signal: controller.signal })).rejects.toMatchObject({
      kind: 'aborted'
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
