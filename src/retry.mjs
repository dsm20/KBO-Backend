const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 1000;

class RetryError extends Error {
  constructor(attempts, lastError) {
    super(`Failed after ${attempts} attempts: ${lastError.message}`);
    this.name = "RetryError";
    this.attempts = attempts;
    this.lastError = lastError;
  }
}

async function withRetry(fn, {
  maxRetries = DEFAULT_MAX_RETRIES,
  baseDelayMs = DEFAULT_BASE_DELAY_MS,
  shouldRetry = () => true,
  onRetry = () => {},
} = {}) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;

      if (attempt > maxRetries || !shouldRetry(err, attempt)) {
        throw new RetryError(attempt, err);
      }

      const jitter = Math.random() * 0.5 + 0.75;
      const delay = baseDelayMs * Math.pow(2, attempt - 1) * jitter;
      onRetry(err, attempt, delay);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw new RetryError(maxRetries + 1, lastError);
}

function isRetryable(err) {
  if (err.status && err.status >= 500) return true;
  if (err.code === "ECONNRESET" || err.code === "ETIMEDOUT") return true;
  return false;
}

export { withRetry, isRetryable, RetryError };
