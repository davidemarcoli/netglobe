import dns from 'dns/promises';
import { DNS_TIMEOUT_MS, DNS_CACHE_MAX } from './config.js';

interface CacheEntry {
  hostname: string | null;
  expiresAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CONCURRENT = 10;

export class DnsResolver {
  private cache = new Map<string, CacheEntry>();

  /** Lookup a single IP, returns first reverse hostname or null */
  async lookup(ip: string): Promise<string | null> {
    // Check cache
    const cached = this.cache.get(ip);
    if (cached && cached.expiresAt > Date.now()) {
      // LRU refresh
      this.cache.delete(ip);
      this.cache.set(ip, cached);
      return cached.hostname;
    }

    let hostname: string | null = null;
    try {
      const result = await withTimeout(dns.reverse(ip), DNS_TIMEOUT_MS);
      if (result.length > 0) {
        hostname = result[0];
      }
    } catch {
      // ENOTFOUND, timeout, etc. — cache the negative result too
    }

    // Evict if full
    if (this.cache.size >= DNS_CACHE_MAX) {
      const oldest = this.cache.keys().next().value!;
      this.cache.delete(oldest);
    }

    this.cache.set(ip, { hostname, expiresAt: Date.now() + CACHE_TTL_MS });
    return hostname;
  }

  /** Batch resolve unique IPs with concurrency limit */
  async batchResolve(ips: string[]): Promise<Map<string, string | null>> {
    const unique = [...new Set(ips)];
    const results = new Map<string, string | null>();

    // Process in batches of MAX_CONCURRENT
    for (let i = 0; i < unique.length; i += MAX_CONCURRENT) {
      const batch = unique.slice(i, i + MAX_CONCURRENT);
      const resolved = await Promise.all(
        batch.map(async ip => {
          const hostname = await this.lookup(ip);
          return [ip, hostname] as const;
        })
      );
      for (const [ip, hostname] of resolved) {
        results.set(ip, hostname);
      }
    }

    return results;
  }

  get cacheSize(): number {
    return this.cache.size;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('DNS timeout')), ms);
    promise.then(
      val => { clearTimeout(timer); resolve(val); },
      err => { clearTimeout(timer); reject(err); }
    );
  });
}
