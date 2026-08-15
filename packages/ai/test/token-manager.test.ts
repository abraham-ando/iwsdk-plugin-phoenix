import { describe, it, expect, vi } from 'vitest';
import { TokenManager } from '../src/security/TokenManager';

describe('TokenManager', () => {
  it('should store and return static session token', async () => {
    const manager = new TokenManager({ token: 'jwt_static_123' });
    expect(manager.isExpired()).toBe(false);
    const token = await manager.getValidToken();
    expect(token).toBe('jwt_static_123');
  });

  it('should handle token expiration and automatic refresh', async () => {
    let callCount = 0;
    const manager = new TokenManager({
      fetchToken: async () => {
        callCount++;
        return { token: `jwt_refreshed_${callCount}`, expiresInSeconds: 60 };
      },
    });

    expect(manager.isExpired()).toBe(true);
    const token1 = await manager.getValidToken();
    expect(token1).toBe('jwt_refreshed_1');
    expect(callCount).toBe(1);
    expect(manager.isExpired()).toBe(false);

    // Second call before expiry uses cached token
    const token2 = await manager.getValidToken();
    expect(token2).toBe('jwt_refreshed_1');
    expect(callCount).toBe(1);
  });

  it('should clear token properly', async () => {
    const manager = new TokenManager({ token: 'token_abc' });
    manager.clear();
    expect(manager.isExpired()).toBe(true);
    await expect(manager.getValidToken()).rejects.toThrow('No valid session token');
  });
});
