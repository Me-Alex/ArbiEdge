/**
 * Simple in-memory rate limiter.
 * Tracks requests per IP within a sliding window.
 */
class RateLimiter {
  constructor({ windowMs = 60_000, maxRequests = 60 } = {}) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.requests = new Map();
  }

  check(ip) {
    const now = Date.now();
    const key = ip || 'unknown';
    const timestamps = this.requests.get(key) || [];
    const valid = timestamps.filter((ts) => now - ts < this.windowMs);
    if (valid.length >= this.maxRequests) {
      const retryAfter = this.windowMs - (now - valid[0]);
      return { allowed: false, retryAfterMs: Math.max(1000, retryAfter) };
    }
    valid.push(now);
    this.requests.set(key, valid);
    return { allowed: true, retryAfterMs: 0 };
  }

  cleanup() {
    const now = Date.now();
    for (const [key, timestamps] of this.requests) {
      const valid = timestamps.filter((ts) => now - ts < this.windowMs);
      if (valid.length === 0) {
        this.requests.delete(key);
      } else {
        this.requests.set(key, valid);
      }
    }
  }
}

module.exports = { RateLimiter };
