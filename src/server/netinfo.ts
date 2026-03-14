import { execFile } from 'child_process';
import { readFile, readlink } from 'fs/promises';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface ConnectionRecord {
  pid: number | null;
  proto: string;
  status: string;
  laddrIp: string;
  laddrPort: number;
  raddrIp: string | null;
  raddrPort: number | null;
  processName: string | null;
  processExe: string | null;
  processCmdline: string[] | null;
  processLabel: string;
  processStatus: string;
}

const STATUS_MAP: Record<string, string> = {
  'ESTAB': 'ESTABLISHED',
  'SYN-SENT': 'SYN_SENT',
  'SYN-RECV': 'SYN_RECV',
  'FIN-WAIT-1': 'FIN_WAIT_1',
  'FIN-WAIT-2': 'FIN_WAIT_2',
  'TIME-WAIT': 'TIME_WAIT',
  'CLOSE-WAIT': 'CLOSE_WAIT',
  'LAST-ACK': 'LAST_ACK',
  'UNCONN': 'UNCONN',
};

const PID_RE = /users:\(\("(?<name>[^"]+)",pid=(?<pid>\d+),fd=\d+\)\)/;

interface ProcessInfo {
  name: string | null;
  exe: string | null;
  cmdline: string[] | null;
  label: string;
  status: string;
}

async function getProcessInfo(pid: number, cache: Map<number, ProcessInfo>): Promise<ProcessInfo> {
  const cached = cache.get(pid);
  if (cached) return cached;

  let name: string | null = null;
  let exe: string | null = null;
  let cmdline: string[] | null = null;
  let status = 'OK';

  try {
    name = (await readFile(`/proc/${pid}/comm`, 'utf-8')).trim() || null;
  } catch { /* ignore */ }

  try {
    exe = await readlink(`/proc/${pid}/exe`);
  } catch { /* ignore */ }

  try {
    const raw = await readFile(`/proc/${pid}/cmdline`, 'utf-8');
    if (raw) cmdline = raw.split('\0').filter(Boolean);
  } catch { /* ignore */ }

  if (!name && !exe && !cmdline) {
    status = 'Access denied';
  }

  const label = name || (exe ? exe.split('/').pop()! : `PID ${pid}`);
  const info: ProcessInfo = { name, exe, cmdline, label, status };
  cache.set(pid, info);
  return info;
}

function splitAddr(addr: string): [string, number] | [null, null] {
  if (!addr || addr === '*:*' || addr === '0.0.0.0:*' || addr === '[::]:*') {
    return [null, null];
  }

  // IPv6: [::1]:port
  const ipv6Match = addr.match(/^\[(.+)\]:(\d+)$/);
  if (ipv6Match) {
    let ip = ipv6Match[1];
    // Strip zone suffix like %wlp2s0
    const zoneIdx = ip.indexOf('%');
    if (zoneIdx !== -1) ip = ip.substring(0, zoneIdx);
    return [ip, parseInt(ipv6Match[2], 10)];
  }

  // IPv4: 1.2.3.4:port
  const lastColon = addr.lastIndexOf(':');
  if (lastColon === -1) return [null, null];

  const ip = addr.substring(0, lastColon);
  const port = parseInt(addr.substring(lastColon + 1), 10);
  return [ip || null, isNaN(port) ? null! : port] as [string, number];
}

function normalizePeerIp(ip: string | null): string | null {
  if (!ip || ip === '*' || ip === '0.0.0.0' || ip === '::') return null;
  return ip;
}

export async function getConnections(): Promise<ConnectionRecord[]> {
  let stdout: string;
  try {
    const result = await execFileAsync('ss', ['-H', '-n', '-t', '-u', '-a', '-p'], {
      timeout: 10_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    stdout = result.stdout;
  } catch {
    return [];
  }

  const lines = stdout.split('\n').filter(Boolean);
  const records: ConnectionRecord[] = [];
  const procCache = new Map<number, ProcessInfo>();

  const processPromises: Array<{ lineIdx: number; pid: number }> = [];
  const parsedLines: Array<{
    proto: string;
    status: string;
    laddrIp: string;
    laddrPort: number;
    raddrIp: string | null;
    raddrPort: number | null;
    pid: number | null;
    pidName: string | null;
  }> = [];

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) continue;

    const [netid, state, , , localAddr, peerAddr, ...rest] = parts;
    const proto = netid.toUpperCase();
    const status = STATUS_MAP[state] || state;

    const [laddrIp, laddrPort] = splitAddr(localAddr);
    if (laddrIp === null || laddrPort === null) continue;

    let [raddrIp, raddrPort] = splitAddr(peerAddr || '');
    raddrIp = normalizePeerIp(raddrIp);
    if (raddrIp === null) raddrPort = null;

    const processField = rest.join(' ');
    const pidMatch = processField.match(PID_RE);
    const pid = pidMatch ? parseInt(pidMatch.groups!.pid, 10) : null;
    const pidName = pidMatch ? pidMatch.groups!.name : null;

    const idx = parsedLines.length;
    parsedLines.push({ proto, status, laddrIp, laddrPort, raddrIp, raddrPort, pid, pidName });
    if (pid !== null) {
      processPromises.push({ lineIdx: idx, pid });
    }
  }

  // Batch resolve process info
  const resolvedProcs = new Map<number, ProcessInfo>();
  const uniquePids = [...new Set(processPromises.map(p => p.pid))];
  await Promise.all(uniquePids.map(async pid => {
    resolvedProcs.set(pid, await getProcessInfo(pid, procCache));
  }));

  for (const parsed of parsedLines) {
    let processName: string | null = null;
    let processExe: string | null = null;
    let processCmdline: string[] | null = null;
    let processLabel = parsed.pidName || 'Unknown';
    let processStatus = parsed.pid !== null ? 'OK' : 'No process';

    if (parsed.pid !== null) {
      const info = resolvedProcs.get(parsed.pid);
      if (info) {
        processName = info.name;
        processExe = info.exe;
        processCmdline = info.cmdline;
        processLabel = info.label;
        processStatus = info.status;
      }
    }

    records.push({
      pid: parsed.pid,
      proto: parsed.proto,
      status: parsed.status,
      laddrIp: parsed.laddrIp,
      laddrPort: parsed.laddrPort,
      raddrIp: parsed.raddrIp,
      raddrPort: parsed.raddrPort,
      processName,
      processExe,
      processCmdline,
      processLabel,
      processStatus,
    });
  }

  return records;
}
