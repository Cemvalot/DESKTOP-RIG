'use strict';

/**
 * Per-key in-memory sliding-window rate limiter per architecture-security.md §6.1.
 * Not shared across processes/Redis — acceptable per spec at this scale.
 */

class SlidingWindowLimiter {
  constructor({ limit, windowMs }) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.buckets = new Map(); // key -> timestamps[]
  }

  /** Returns { allowed: boolean, retryAfterSeconds: number } */
  check(key) {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    let timestamps = this.buckets.get(key);
    if (!timestamps) {
      timestamps = [];
      this.buckets.set(key, timestamps);
    }
    // Prune old entries.
    while (timestamps.length && timestamps[0] < windowStart) {
      timestamps.shift();
    }
    if (timestamps.length >= this.limit) {
      const retryAfterMs = timestamps[0] + this.windowMs - now;
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
    }
    timestamps.push(now);
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

/** Builds the named limiters from config/service.json rateLimits. */
function buildLimiters(rateLimits) {
  return {
    general: new SlidingWindowLimiter({ limit: rateLimits.generalPerMinute, windowMs: 60_000 }),
    dangerousExecute: new SlidingWindowLimiter({ limit: rateLimits.dangerousExecutePerMinute, windowMs: 60_000 }),
    confirm: new SlidingWindowLimiter({ limit: rateLimits.confirmPerMinute, windowMs: 60_000 }),
    pairingClaim: new SlidingWindowLimiter({ limit: rateLimits.pairingClaimPer5Min, windowMs: 5 * 60_000 }),
    wsReconnect: new SlidingWindowLimiter({ limit: rateLimits.wsReconnectPerMinute, windowMs: 60_000 }),
  };
}

/** Express middleware factory. keyFn(req) -> string. */
function rateLimitMiddleware(limiter, keyFn, logger) {
  return (req, res, next) => {
    const key = keyFn(req);
    const { allowed, retryAfterSeconds } = limiter.check(key);
    if (!allowed) {
      logger?.warn('rate limit exceeded', { key, path: req.path });
      res.set('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests, slow down.' } });
    }
    next();
  };
}

module.exports = { SlidingWindowLimiter, buildLimiters, rateLimitMiddleware };
