export interface RateLimiterOptions {
  windowMs: number;
  maxRequests: number;
}

export class RateLimiter {
  private requests = new Map<string, number[]>();
  private windowMs: number;
  private maxRequests: number;

  constructor(options: RateLimiterOptions = { windowMs: 60000, maxRequests: 60 }) {
    this.windowMs = options.windowMs;
    this.maxRequests = options.maxRequests;
  }

  public isAllowed(clientId: string): boolean {
    const now = Date.now();
    const timestamps = this.requests.get(clientId) || [];

    const activeTimestamps = timestamps.filter((t) => now - t < this.windowMs);

    if (activeTimestamps.length >= this.maxRequests) {
      this.requests.set(clientId, activeTimestamps);
      return false;
    }

    activeTimestamps.push(now);
    this.requests.set(clientId, activeTimestamps);
    return true;
  }

  public reset(): void {
    this.requests.clear();
  }
}
