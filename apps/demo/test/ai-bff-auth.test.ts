import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createBffTokenProvider, resolveBffBaseUrl } from '../src/ai-bff-auth';

describe('resolveBffBaseUrl', () => {
  it('defaults to http://localhost:3001 when VITE_BFF_URL is not set', () => {
    expect(resolveBffBaseUrl()).toBe('http://localhost:3001');
  });
});

describe('createBffTokenProvider', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('POSTs to <baseUrl>/api/auth/session and returns the issued token', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'jwt_from_bff', expiresInSeconds: 3600 }),
    }) as any;

    const tokenProvider = createBffTokenProvider({ baseUrl: 'https://bff.example' });
    const result = await tokenProvider();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = (global.fetch as any).mock.calls[0];
    expect(url).toBe('https://bff.example/api/auth/session');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toHaveProperty('deviceId');
    expect(result).toEqual({ token: 'jwt_from_bff', expiresInSeconds: 3600 });
  });

  it('never sends a provider API key — only a deviceId — to the BFF', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'jwt_from_bff', expiresInSeconds: 3600 }),
    }) as any;

    const tokenProvider = createBffTokenProvider({ baseUrl: 'https://bff.example' });
    await tokenProvider();

    const [, options] = (global.fetch as any).mock.calls[0];
    const body = JSON.parse(options.body);
    expect(Object.keys(body)).toEqual(['deviceId']);
    expect(JSON.stringify(body)).not.toMatch(/key/i);
  });

  it('throws a descriptive error when the BFF session endpoint responds with a non-2xx status', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    }) as any;

    const tokenProvider = createBffTokenProvider({ baseUrl: 'https://bff.example' });

    await expect(tokenProvider()).rejects.toThrow('503');
  });

  it('propagates a network failure (BFF unreachable) as a rejected promise', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('fetch failed'));

    const tokenProvider = createBffTokenProvider({ baseUrl: 'https://bff.example' });

    await expect(tokenProvider()).rejects.toThrow('fetch failed');
  });

  it('generates a distinct deviceId per provider instance instead of a shared constant', async () => {
    // apps/bff-server rate-limits per JWT `sub`, and the BFF mints that
    // `sub` straight from `deviceId` — a hardcoded constant here would put
    // every demo tab/player behind the same rate-limit bucket server-side
    // (flagged in security review).
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'jwt_from_bff', expiresInSeconds: 3600 }),
    }) as any;

    const providerA = createBffTokenProvider({ baseUrl: 'https://bff.example' });
    const providerB = createBffTokenProvider({ baseUrl: 'https://bff.example' });
    await providerA();
    await providerB();

    const [, optionsA] = (global.fetch as any).mock.calls[0];
    const [, optionsB] = (global.fetch as any).mock.calls[1];
    const deviceIdA = JSON.parse(optionsA.body).deviceId;
    const deviceIdB = JSON.parse(optionsB.body).deviceId;

    expect(deviceIdA).not.toBe(deviceIdB);
  });

  it('reuses the same deviceId across repeated calls on one provider (stable rate-limit identity, not one bucket per request)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'jwt_from_bff', expiresInSeconds: 3600 }),
    }) as any;

    const tokenProvider = createBffTokenProvider({ baseUrl: 'https://bff.example' });
    await tokenProvider();
    await tokenProvider();

    const [, firstOptions] = (global.fetch as any).mock.calls[0];
    const [, secondOptions] = (global.fetch as any).mock.calls[1];

    expect(JSON.parse(firstOptions.body).deviceId).toBe(JSON.parse(secondOptions.body).deviceId);
  });
});
