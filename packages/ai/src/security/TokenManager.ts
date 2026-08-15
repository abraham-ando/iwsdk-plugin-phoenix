/**
 * Session Token & JWT Manager for Secure Backend-For-Frontend (BFF) Communication.
 * Handles token storage, expiration checks, and token refreshing.
 */

export interface TokenProviderOptions {
  /** Static session token or JWT */
  token?: string;
  /** Async function to fetch/refresh a token from the application server */
  fetchToken?: () => Promise<{ token: string; expiresInSeconds?: number }>;
  /** Expiration timestamp in milliseconds */
  expiresAt?: number;
}

export class TokenManager {
  private currentToken: string | null = null;
  private expiresAt: number | null = null;
  private fetchTokenFn?: () => Promise<{ token: string; expiresInSeconds?: number }>;

  constructor(options: TokenProviderOptions = {}) {
    this.currentToken = options.token ?? null;
    this.expiresAt = options.expiresAt ?? null;
    this.fetchTokenFn = options.fetchToken;
  }

  /**
   * Set a session token with an optional TTL in seconds.
   */
  public setToken(token: string, expiresInSeconds?: number): void {
    this.currentToken = token;
    if (expiresInSeconds !== undefined) {
      this.expiresAt = Date.now() + expiresInSeconds * 1000;
    } else {
      this.expiresAt = null;
    }
  }

  /**
   * Check if the currently held token is expired or missing.
   */
  public isExpired(): boolean {
    if (!this.currentToken) return true;
    if (this.expiresAt === null) return false;
    // Add 10-second buffer before actual expiry
    return Date.now() >= this.expiresAt - 10000;
  }

  /**
   * Retrieve a valid session token, refreshing it if needed.
   */
  public async getValidToken(): Promise<string> {
    if (!this.isExpired() && this.currentToken) {
      return this.currentToken;
    }

    if (this.fetchTokenFn) {
      const result = await this.fetchTokenFn();
      this.setToken(result.token, result.expiresInSeconds);
      return result.token;
    }

    if (this.currentToken) {
      return this.currentToken;
    }

    throw new Error('[TokenManager] No valid session token available and no refresh handler defined');
  }

  /**
   * Clear the active session token.
   */
  public clear(): void {
    this.currentToken = null;
    this.expiresAt = null;
  }
}
