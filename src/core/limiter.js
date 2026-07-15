/**
 * Rate Limiter Infrastructure with pluggable storage strategy.
 */

class MemoryStore {
  constructor(windowMs) {
    this.windowMs = windowMs;
    this.requests = new Map();
  }

  check(key, maxRequests) {
    const now = Date.now();
    const timestamps = this.requests.get(key) || [];
    const valid = timestamps.filter((ts) => now - ts < this.windowMs);
    if (valid.length >= maxRequests) {
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

class RateLimiter {
  constructor({ windowMs = 60_000, maxRequests = 60, store = null } = {}) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.store = store || new MemoryStore(windowMs);
  }

  get requests() {
    return this.store.requests;
  }

  check(ip) {
    const key = ip || 'unknown';
    return this.store.check(key, this.maxRequests);
  }

  cleanup() {
    if (typeof this.store.cleanup === 'function') {
      this.store.cleanup();
    }
  }
}

module.exports = { RateLimiter, MemoryStore };
