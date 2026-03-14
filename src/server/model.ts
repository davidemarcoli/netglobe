import { createConnection } from 'net';
import * as ipaddr from 'ipaddr.js';
import { getConnections } from './netinfo.js';
import { GeoInfo, GeoResult } from './geoinfo.js';
import { DnsResolver } from './dnsinfo.js';
import { readTcpQueues } from './bandwidth.js';
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
  private dns: DnsResolver;

  constructor(geo: GeoInfo, dns: DnsResolver) {
    this.geo = geo;
    this.dns = dns;
  }

  async snapshot(): Promise<Snapshot> {
    const [online, connections, queueMap] = await Promise.all([
      checkInternet(),
      getConnections(),
      readTcpQueues(),
    ]);

    const cacheItems: CacheItem[] = [];
    const mapCandidates: MapCandidate[] = [];
    const openPorts: OpenPort[] = [];
    let tcpEst = 0, tcpLst = 0, udpR = 0, udpB = 0;

    // Collect public IPs for batch DNS resolution
    const publicIps: string[] = [];

    // First pass: classify and build items (without DNS)
    interface PendingItem {
      item: CacheItem;
      mapCandidate: MapCandidate | null;
    }
    const pending: PendingItem[] = [];

    for (const conn of connections) {
      const isTcp = conn.proto === 'TCP';
      const isEstablished = conn.status === 'ESTABLISHED';
      const isListen = conn.status === 'LISTEN';
      const hasRemote = conn.raddrIp !== null && conn.raddrPort !== null;

      if ((isTcp && isEstablished && hasRemote) || (!isTcp && hasRemote)) {
        if (isTcp) tcpEst++; else udpR++;

        const ip = conn.raddrIp!;
        const port = conn.raddrPort!;
        const scope = classifyIp(ip);

        let geo: GeoResult = { lat: null, lon: null, city: null, country: null, asn: null, asnOrg: null };
        if (scope === 'PUBLIC' && this.geo.enabled) {
          geo = this.geo.lookup(ip);
        }

        // Queue metrics
        const qKey = `${ip}:${port}`;
        const queue = queueMap.get(qKey);

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
          hostname: null, // filled after DNS batch
          txQueue: queue?.txQueue ?? 0,
          rxQueue: queue?.rxQueue ?? 0,
        };
        cacheItems.push(item);

        let mc: MapCandidate | null = null;
        if (scope === 'PUBLIC' && geo.lat !== null && geo.lon !== null) {
          mc = {
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
            hostname: null,
            queueBytes: (queue?.txQueue ?? 0) + (queue?.rxQueue ?? 0),
          };
          mapCandidates.push(mc);
        }

        if (scope === 'PUBLIC') publicIps.push(ip);
        pending.push({ item, mapCandidate: mc });
      }
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

    // Batch DNS resolution for public IPs
    if (publicIps.length > 0) {
      const dnsResults = await this.dns.batchResolve(publicIps);
      for (const { item, mapCandidate } of pending) {
        const hostname = dnsResults.get(item.ip) ?? null;
        item.hostname = hostname;
        if (mapCandidate) mapCandidate.hostname = hostname;
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
