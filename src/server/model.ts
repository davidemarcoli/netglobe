import { createConnection } from 'net';
import * as ipaddr from 'ipaddr.js';
import { getConnections, ConnectionRecord } from './netinfo.js';
import { GeoInfo, GeoResult } from './geoinfo.js';
import { COORD_PRECISION } from './config.js';

export type Scope = 'PUBLIC' | 'LAN' | 'LOCAL';

export interface CacheItem {
  ip: string;
  port: number;
  proto: string;
  scope: Scope;
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
}

export interface Snapshot {
  online: boolean;
  geoEnabled: boolean;
  timestamp: string;
  cacheItems: CacheItem[];
  mapCandidates: MapCandidate[];
  openPorts: OpenPort[];
  stats: {
    tcpEstablished: number;
    tcpListening: number;
    udpRemote: number;
    udpBound: number;
    totalSockets: number;
  };
}

// Common port-to-service name map
const SERVICE_NAMES: Record<number, string> = {
  20: 'ftp-data', 21: 'ftp', 22: 'ssh', 23: 'telnet', 25: 'smtp',
  53: 'dns', 67: 'dhcp', 68: 'dhcp', 80: 'http', 110: 'pop3',
  119: 'nntp', 123: 'ntp', 143: 'imap', 161: 'snmp', 194: 'irc',
  443: 'https', 445: 'smb', 465: 'smtps', 514: 'syslog', 587: 'submission',
  631: 'ipp', 993: 'imaps', 995: 'pop3s', 1080: 'socks', 1433: 'mssql',
  1434: 'mssql', 3306: 'mysql', 3389: 'rdp', 5222: 'xmpp', 5432: 'postgres',
  5900: 'vnc', 6379: 'redis', 8080: 'http-alt', 8443: 'https-alt',
  8888: 'http-alt', 9090: 'http-alt', 27017: 'mongodb',
};

function serviceName(port: number): string {
  return SERVICE_NAMES[port] || '';
}

function classifyIp(ip: string): Scope {
  try {
    const parsed = ipaddr.parse(ip);
    const range = parsed.range();
    if (range === 'loopback') return 'LOCAL';
    if (range === 'private' || range === 'linkLocal' || range === 'uniqueLocal') return 'LAN';
    return 'PUBLIC';
  } catch {
    return 'PUBLIC';
  }
}

function classifyBindIp(ip: string): string {
  if (ip === '0.0.0.0' || ip === '::' || ip === '*') return 'ALL';
  return classifyIp(ip);
}

function roundCoord(v: number): number {
  return parseFloat(v.toFixed(COORD_PRECISION));
}

async function checkInternet(): Promise<boolean> {
  const hosts = ['1.1.1.1', '8.8.8.8'];
  for (const host of hosts) {
    try {
      await new Promise<void>((resolve, reject) => {
        const sock = createConnection({ host, port: 53, timeout: 600 }, () => {
          sock.destroy();
          resolve();
        });
        sock.on('error', reject);
        sock.on('timeout', () => { sock.destroy(); reject(new Error('timeout')); });
      });
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

export class Model {
  private geo: GeoInfo;

  constructor(geo: GeoInfo) {
    this.geo = geo;
  }

  async snapshot(): Promise<Snapshot> {
    const [online, connections] = await Promise.all([
      checkInternet(),
      getConnections(),
    ]);

    const cacheItems: CacheItem[] = [];
    const mapCandidates: MapCandidate[] = [];
    const openPorts: OpenPort[] = [];
    let tcpEst = 0, tcpLst = 0, udpR = 0, udpB = 0;

    for (const conn of connections) {
      const isTcp = conn.proto === 'TCP';
      const isEstablished = conn.status === 'ESTABLISHED';
      const isListen = conn.status === 'LISTEN';
      const hasRemote = conn.raddrIp !== null && conn.raddrPort !== null;

      // TCP ESTABLISHED or UDP with remote -> remote endpoint
      if ((isTcp && isEstablished && hasRemote) || (!isTcp && hasRemote)) {
        if (isTcp) tcpEst++; else udpR++;

        const ip = conn.raddrIp!;
        const port = conn.raddrPort!;
        const scope = classifyIp(ip);

        let geo: GeoResult = { lat: null, lon: null, city: null, country: null, asn: null, asnOrg: null };
        if (scope === 'PUBLIC' && this.geo.enabled) {
          geo = this.geo.lookup(ip);
        }

        const item: CacheItem = {
          ip, port,
          proto: conn.proto,
          scope,
          serviceName: serviceName(port),
          processLabel: conn.processLabel,
          pid: conn.pid,
          processName: conn.processName,
          processExe: conn.processExe,
          ...geo,
        };
        cacheItems.push(item);

        if (scope === 'PUBLIC' && geo.lat !== null && geo.lon !== null) {
          mapCandidates.push({
            ip, port,
            proto: conn.proto,
            lat: roundCoord(geo.lat),
            lon: roundCoord(geo.lon),
            city: geo.city,
            country: geo.country,
            asn: geo.asn,
            asnOrg: geo.asnOrg,
            processLabel: conn.processLabel,
            pid: conn.pid,
          });
        }
      }
      // TCP LISTEN or UDP without remote -> open port
      else if ((isTcp && isListen) || (!isTcp && !hasRemote)) {
        if (isTcp) tcpLst++; else udpB++;

        openPorts.push({
          proto: conn.proto,
          bindIp: conn.laddrIp,
          port: conn.laddrPort,
          bindScope: classifyBindIp(conn.laddrIp),
          serviceName: serviceName(conn.laddrPort),
          processLabel: conn.processLabel,
          pid: conn.pid,
          processName: conn.processName,
          processExe: conn.processExe,
        });
      } else {
        if (isTcp) tcpEst++; else udpR++;
      }
    }

    return {
      online,
      geoEnabled: this.geo.enabled,
      timestamp: new Date().toISOString(),
      cacheItems,
      mapCandidates,
      openPorts,
      stats: {
        tcpEstablished: tcpEst,
        tcpListening: tcpLst,
        udpRemote: udpR,
        udpBound: udpB,
        totalSockets: connections.length,
      },
    };
  }
}
