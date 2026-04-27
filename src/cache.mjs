const DEFAULT_TTL_MS = 300_000;
const DEFAULT_MAX_ENTRIES = 1000;

class LRUCache {
  #map = new Map();
  #maxEntries;
  #ttlMs;

  constructor({ maxEntries = DEFAULT_MAX_ENTRIES, ttlMs = DEFAULT_TTL_MS } = {}) {
    this.#maxEntries = maxEntries;
    this.#ttlMs = ttlMs;
  }

  get(key) {
    const entry = this.#map.get(key);
    if (!entry) return undefined;

    if (Date.now() - entry.createdAt > this.#ttlMs) {
      this.#map.delete(key);
      return undefined;
    }

    this.#map.delete(key);
    this.#map.set(key, entry);
    return entry.value;
  }

  set(key, value) {
    this.#map.delete(key);
    this.#map.set(key, { value, createdAt: Date.now() });

    if (this.#map.size > this.#maxEntries) {
      const oldest = this.#map.keys().next().value;
      this.#map.delete(oldest);
    }
  }

  has(key) {
    return this.get(key) !== undefined;
  }

  delete(key) {
    return this.#map.delete(key);
  }

  clear() {
    this.#map.clear();
  }

  get size() {
    return this.#map.size;
  }
}

export function withCache(fn, { keyFn = JSON.stringify, ...opts } = {}) {
  const cache = new LRUCache(opts);

  return (...args) => {
    const key = keyFn(args);
    const cached = cache.get(key);
    if (cached !== undefined) return cached;

    const result = fn(...args);
    cache.set(key, result);
    return result;
  };
}

export { LRUCache };
