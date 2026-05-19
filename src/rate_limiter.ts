/**
 * rate_limiter.ts — Token bucket rate limiter for HTTP requests.
 *
 * Limits the number of outbound HTTP requests to prevent resource exhaustion
 * and reduce the risk of being blocked by target servers.
 */

export interface RateLimiterConfig {
  maxRequests: number;
  windowMs: number;
}

const DEFAULT_CONFIG: RateLimiterConfig = {
  maxRequests: 30,
  windowMs: 60_000,
};

export class RateLimiter {
  tokens: number;
  lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRate: number;

  constructor(config: Partial<RateLimiterConfig> = {}) {
    const { maxRequests, windowMs } = { ...DEFAULT_CONFIG, ...config };
    this.maxTokens = maxRequests;
    this.tokens = maxRequests;
    this.lastRefill = Date.now();
    this.refillRate = maxRequests / windowMs;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const newTokens = elapsed * this.refillRate;
    this.tokens = Math.min(this.maxTokens, this.tokens + newTokens);
    this.lastRefill = now;
  }

  tryAcquire(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  get waitMs(): number {
    this.refill();
    if (this.tokens >= 1) return 0;
    return Math.ceil((1 - this.tokens) / this.refillRate);
  }
}

export const globalRateLimiter = new RateLimiter();

/** Reset the global rate limiter — useful for testing. */
export function resetGlobalRateLimiter(): void {
  globalRateLimiter.tokens = globalRateLimiter.maxTokens;
  globalRateLimiter.lastRefill = Date.now();
}
