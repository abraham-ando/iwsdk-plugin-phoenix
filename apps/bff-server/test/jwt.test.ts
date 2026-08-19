import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JWTService } from '../src/jwt';

// Regression coverage for the default JWT secret fallback: verify.valid JWT
// checks are the ONLY gate in front of /api/v1/cardinal/chat (and therefore
// the real provider key + budget behind it). Falling back silently to the
// hardcoded default outside development would let anyone who has read this
// repo forge valid session tokens. See security review of TS-A2.
describe('JWTService default secret fallback', () => {
  const ENV_KEYS = ['CARDINAL_JWT_SECRET', 'NODE_ENV', 'ALLOW_DEFAULT_JWT_SECRET'] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    vi.restoreAllMocks();
  });

  it('refuses to construct without CARDINAL_JWT_SECRET when NODE_ENV=production', () => {
    process.env.NODE_ENV = 'production';

    expect(() => new JWTService()).toThrow(/CARDINAL_JWT_SECRET/);
  });

  it('falls back to the default secret with a console warning outside production', () => {
    process.env.NODE_ENV = 'development';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const jwt = new JWTService();
    const token = jwt.sign('quest_device_001', 3600);
    const result = jwt.verify(token);

    expect(result.valid).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/CARDINAL_JWT_SECRET/);
  });

  it('starts normally, without warning, when a secret is explicitly provided even in production', () => {
    process.env.NODE_ENV = 'production';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => new JWTService('an_explicit_secret')).not.toThrow();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('starts normally, without warning, when CARDINAL_JWT_SECRET is set even in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.CARDINAL_JWT_SECRET = 'env_provided_secret';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => new JWTService()).not.toThrow();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('allows the default secret in production when ALLOW_DEFAULT_JWT_SECRET=true is set explicitly', () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_DEFAULT_JWT_SECRET = 'true';
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => new JWTService()).not.toThrow();
  });
});
