import { afterEach, describe, expect, it, vi } from 'vitest';
import { OmniRouteProvider } from '../core/providers/omniroute/OmniRouteProvider.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OmniRouteProvider availability', () => {
  it('does not invent models when the gateway is offline', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('connect ECONNREFUSED');
    }));

    const provider = new OmniRouteProvider();
    await expect(provider.listModels()).rejects.toMatchObject({ retryable: true });
    await expect(provider.testConnection()).resolves.toMatchObject({ state: 'error' });
  });

  it('reports an empty model response as unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })));

    const provider = new OmniRouteProvider();
    await expect(provider.testConnection()).resolves.toMatchObject({
      state: 'error',
      message: expect.stringContaining('returned no models')
    });
  });

  it('requests the alias catalog and hides non-chat models', async () => {
    let requestedUrl = '';
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      requestedUrl = String(input);
      return new Response(
        JSON.stringify({
          data: [
            { id: 'auto', type: 'chat', supports_tools: true },
            { id: 'embed-model', type: 'embedding' },
            { id: 'vision-model', type: 'chat', supports_vision: true, context_window: 128000 }
          ]
        }),
        { status: 200 }
      );
    }));

    const provider = new OmniRouteProvider();
    const models = await provider.listModels();

    expect(requestedUrl).toContain('/v1/models?prefix=alias');
    expect(models.map((model) => model.id)).toEqual(['auto', 'vision-model']);
    expect(models[1]).toMatchObject({ supportsVision: true, contextWindow: 128000 });
  });
});