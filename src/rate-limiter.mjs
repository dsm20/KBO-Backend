const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS = 100;

class TokenBucketRateLimiter {
  #buckets = new Map();
  #windowMs;
  #maxRequests;

  constructor({ windowMs = DEFAULT_WINDOW_MS, maxRequests = DEFAULT_MAX_REQUESTS } = {}) {
    this.#windowMs = windowMs;
    this.#maxRequests = maxRequests;
  }

  tryConsume(clientId) {
    const now = Date.now();
    let bucket = this.#buckets.get(clientId);

    if (!bucket || now - bucket.windowStart >= this.#windowMs) {
      bucket = { tokens: this.#maxRequests - 1, windowStart: now };
      this.#buckets.set(clientId, bucket);
      return { allowed: true, remaining: bucket.tokens, retryAfterMs: 0 };
    }

    if (bucket.tokens <= 0) {
      const retryAfterMs = this.#windowMs - (now - bucket.windowStart);
      return { allowed: false, remaining: 0, retryAfterMs };
    }

    bucket.tokens--;
    return { allowed: true, remaining: bucket.tokens, retryAfterMs: 0 };
  }

  cleanup() {
    const now = Date.now();
    for (const [id, bucket] of this.#buckets) {
      if (now - bucket.windowStart >= this.#windowMs * 2) {
        this.#buckets.delete(id);
      }
    }
  }
}

export function createMiddleware(opts) {
  const limiter = new TokenBucketRateLimiter(opts);
  const cleanupInterval = setInterval(() => limiter.cleanup(), opts?.windowMs ?? DEFAULT_WINDOW_MS);
  cleanupInterval.unref?.();

  return (req, res, next) => {
    const clientId = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ?? req.socket.remoteAddress;
    const result = limiter.tryConsume(clientId);

    res.setHeader("X-RateLimit-Remaining", result.remaining);

    if (!result.allowed) {
      res.setHeader("Retry-After", Math.ceil(result.retryAfterMs / 1000));
      res.writeHead(429);
      res.end(JSON.stringify({ error: "Too many requests" }));
      return;
    }

    next();
  };
}

export { TokenBucketRateLimiter };
