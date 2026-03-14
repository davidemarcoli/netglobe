import maxmind, { CityResponse, AsnResponse, Reader } from 'maxmind';
import { join } from 'path';
import { existsSync } from 'fs';
import { GEO_CACHE_MAX } from './config.js';

export interface GeoResult {
  lat: number | null;
  lon: number | null;
  city: string | null;
  country: string | null;
  asn: number | null;
  asnOrg: string | null;
}

const EMPTY_GEO: GeoResult = { lat: null, lon: null, city: null, country: null, asn: null, asnOrg: null };

export class GeoInfo {
  private cityReader: Reader<CityResponse> | null = null;
  private asnReader: Reader<AsnResponse> | null = null;
  private cache = new Map<string, GeoResult>();
  private dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  get enabled(): boolean {
    return this.cityReader !== null;
  }

  async load(): Promise<boolean> {
    const cityPath = join(this.dataDir, 'GeoLite2-City.mmdb');
    const asnPath = join(this.dataDir, 'GeoLite2-ASN.mmdb');

    try {
      if (existsSync(cityPath)) {
        this.cityReader = await maxmind.open<CityResponse>(cityPath);
      }
    } catch (e) {
      console.error('Failed to load GeoLite2-City.mmdb:', e);
    }

    try {
      if (existsSync(asnPath)) {
        this.asnReader = await maxmind.open<AsnResponse>(asnPath);
      }
    } catch (e) {
      console.error('Failed to load GeoLite2-ASN.mmdb:', e);
    }

    return this.cityReader !== null;
  }

  async reload(): Promise<boolean> {
    this.cityReader = null;
    this.asnReader = null;
    this.cache.clear();
    return this.load();
  }

  lookup(ip: string): GeoResult {
    const cached = this.cache.get(ip);
    if (cached) {
      // Move to end (LRU refresh)
      this.cache.delete(ip);
      this.cache.set(ip, cached);
      return cached;
    }

    let lat: number | null = null;
    let lon: number | null = null;
    let city: string | null = null;
    let country: string | null = null;
    let asn: number | null = null;
    let asnOrg: string | null = null;

    if (this.cityReader) {
      try {
        const result = this.cityReader.get(ip);
        if (result) {
          lat = result.location?.latitude ?? null;
          lon = result.location?.longitude ?? null;
          city = result.city?.names?.en ?? null;
          country = result.country?.names?.en ?? null;
        }
      } catch { /* invalid IP, skip */ }
    }

    if (this.asnReader) {
      try {
        const result = this.asnReader.get(ip);
        if (result) {
          asn = result.autonomous_system_number ?? null;
          asnOrg = result.autonomous_system_organization ?? null;
        }
      } catch { /* ignore */ }
    }

    const geo: GeoResult = { lat, lon, city, country, asn, asnOrg };

    // Evict oldest if cache is full
    if (this.cache.size >= GEO_CACHE_MAX) {
      const oldest = this.cache.keys().next().value!;
      this.cache.delete(oldest);
    }
    this.cache.set(ip, geo);

    return geo;
  }

  get cacheSize(): number {
    return this.cache.size;
  }
}
