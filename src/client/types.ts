export interface MapCandidate {
  ip: string;
  port: number;
  proto: string;
  lat: number;
  lon: number;
  city: string | null;
  country: string | null;
  asn: number | null;
  asnOrg: string | null;
  processLabel: string;
  pid: number | null;
  hostname: string | null;
  queueBytes: number;
}

export interface CacheItem {
  ip: string;
  port: number;
  proto: string;
  scope: string;
  serviceName: string;
  processLabel: string;
  pid: number | null;
  processName: string | null;
  processExe: string | null;
  lat: number | null;
  lon: number | null;
  city: string | null;
  country: string | null;
  asn: number | null;
  asnOrg: string | null;
  hostname: string | null;
  txQueue: number;
  rxQueue: number;
}

export interface OpenPort {
  proto: string;
  bindIp: string;
  port: number;
  bindScope: string;
  serviceName: string;
  processLabel: string;
  pid: number | null;
  processName: string | null;
  processExe: string | null;
}

export interface SnapshotStats {
  tcpEstablished: number;
  tcpListening: number;
  udpRemote: number;
  udpBound: number;
  totalSockets: number;
}

export interface Snapshot {
  online: boolean;
  geoEnabled: boolean;
  timestamp: string;
  cacheItems: CacheItem[];
  mapCandidates: MapCandidate[];
  openPorts: OpenPort[];
  stats: SnapshotStats;
}

export interface ConfigMessage {
  type: 'config';
  myLocation: {
    lon: number;
    lat: number;
    ip: string | null;
    city: string | null;
    country: string | null;
    mode: string;
  } | null;
  geoEnabled: boolean;
  geoDataDir: string;
}

export interface SnapshotMessage {
  type: 'snapshot';
  data: Snapshot;
}

export interface FlashMessage {
  type: 'flash';
  message: string;
}

export interface ClearCacheMessage {
  type: 'clear_cache';
}

export type ServerMessage = ConfigMessage | SnapshotMessage | FlashMessage | ClearCacheMessage;
