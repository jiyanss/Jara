/**
 * Simple in-memory TTL cache with LRU-style eviction.
 * Stored on globalThis so it survives Next.js HMR reloads in dev.
 */
export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class TTLCache<T> {
  private cache: Map<string, CacheEntry<T>>;

  constructor(
    private ttlMs: number,
    private maxEntries = 100
  ) {
    this.cache = new Map();
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    // Refresh insertion order for LRU behavior
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T): void {
    if (this.cache.size >= this.maxEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }
}

/** Get (or lazily create) a global singleton cache by name. */
export function globalCache<T>(name: string, ttlMs: number, maxEntries = 100): TTLCache<T> {
  const g = globalThis as unknown as Record<string, TTLCache<T> | undefined>;
  if (!g[name]) {
    g[name] = new TTLCache<T>(ttlMs, maxEntries);
  }
  return g[name] as TTLCache<T>;
}
