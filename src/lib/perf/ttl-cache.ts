// Tiny per-process TTL cache for hot, read-mostly lookups on the request
// path (API-key verification, session revocation checks). On Vercel each
// warm function instance keeps its own copy, so an entry can outlive a
// change made on another instance by at most `ttlMs` — callers pick a TTL
// they can accept for that staleness and delete entries they invalidate
// locally.
export class TtlCache<V> {
  private readonly map = new Map<string, { value: V; expires: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 1000
  ) {}

  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expires <= Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: V, ttlMs = this.ttlMs) {
    if (this.map.size >= this.maxEntries) {
      // Maps iterate in insertion order: drop the oldest entry.
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { value, expires: Date.now() + ttlMs });
  }

  delete(key: string) {
    this.map.delete(key);
  }

  /** Remove every entry whose value matches (e.g. all cached rows for one id). */
  deleteWhere(match: (value: V) => boolean) {
    for (const [k, v] of this.map) if (match(v.value)) this.map.delete(k);
  }

  clear() {
    this.map.clear();
  }
}
