import { homedir } from 'os';
import { join } from 'path';

export const APP_NAME = 'NetGlobe';
export const APP_VERSION = '1.0.0';

export const POLL_INTERVAL_MS = 5_000;
export const COORD_PRECISION = 3;
export const ZOOM_NEAR_KM = 25.0;
export const GEO_CACHE_MAX = 10_000;

export const SERVER_HOST = '127.0.0.1';
export const SERVER_PORT = 8050;

export const DNS_TIMEOUT_MS = 1_500;
export const DNS_CACHE_MAX = 5_000;

/** Location mode: "auto" detects via public IP, "none" disables, or [lon, lat] tuple */
export type LocationMode = 'auto' | 'none' | [number, number];
export const MY_LOCATION: LocationMode = 'auto';

/** GeoIP database directory: $XDG_DATA_HOME/NetGlobe or ~/.local/share/NetGlobe */
export function geoDataDir(): string {
  const xdg = process.env.XDG_DATA_HOME;
  const base = xdg || join(homedir(), '.local', 'share');
  return join(base, APP_NAME);
}
