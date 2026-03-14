import { readFile } from 'fs/promises';

export interface QueueMetrics {
  txQueue: number;
  rxQueue: number;
}

/**
 * Parse /proc/net/tcp and /proc/net/tcp6 to extract TX/RX queue sizes.
 * Returns a Map keyed by "remoteIp:remotePort" with queue byte counts.
 */
export async function readTcpQueues(): Promise<Map<string, QueueMetrics>> {
  const results = new Map<string, QueueMetrics>();

  const files = [
    { path: '/proc/net/tcp', ipv6: false },
    { path: '/proc/net/tcp6', ipv6: true },
  ];

  await Promise.all(files.map(async ({ path, ipv6 }) => {
    let content: string;
    try {
      content = await readFile(path, 'utf-8');
    } catch {
      return; // File not available
    }

    const lines = content.split('\n');
    // Skip header line
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      //   sl  local_address rem_address   st tx_queue:rx_queue ...
      const fields = line.split(/\s+/);
      if (fields.length < 5) continue;

      const remAddr = fields[2];    // hex_ip:hex_port
      const queues = fields[4];     // tx_queue:rx_queue (hex)

      const remote = parseHexAddress(remAddr, ipv6);
      if (!remote || remote.ip === '0.0.0.0' || remote.ip === '::') continue;

      const [txHex, rxHex] = queues.split(':');
      if (!txHex || !rxHex) continue;

      const txQueue = parseInt(txHex, 16);
      const rxQueue = parseInt(rxHex, 16);

      const key = `${remote.ip}:${remote.port}`;
      const existing = results.get(key);
      if (existing) {
        // Aggregate multiple connections to same remote
        existing.txQueue += txQueue;
        existing.rxQueue += rxQueue;
      } else {
        results.set(key, { txQueue, rxQueue });
      }
    }
  }));

  return results;
}

function parseHexAddress(hex: string, ipv6: boolean): { ip: string; port: number } | null {
  const [ipHex, portHex] = hex.split(':');
  if (!ipHex || !portHex) return null;

  const port = parseInt(portHex, 16);

  if (ipv6) {
    // IPv6: 32 hex chars, in groups of 8 (4 bytes each, little-endian per group)
    if (ipHex.length !== 32) return null;
    const groups: string[] = [];
    for (let i = 0; i < 32; i += 8) {
      const chunk = ipHex.substring(i, i + 8);
      // Each 8-char chunk is 4 bytes in little-endian
      const b0 = chunk.substring(6, 8);
      const b1 = chunk.substring(4, 6);
      const b2 = chunk.substring(2, 4);
      const b3 = chunk.substring(0, 2);
      groups.push(`${b0}${b1}`);
      groups.push(`${b2}${b3}`);
    }
    // Collapse to standard IPv6
    const ip = groups.map(g => g.replace(/^0+/, '') || '0').join(':');
    // Compress :: notation
    const compressed = compressIPv6(groups.map(g => g.toLowerCase()));
    return { ip: compressed, port };
  } else {
    // IPv4: 8 hex chars, little-endian
    if (ipHex.length !== 8) return null;
    const b0 = parseInt(ipHex.substring(6, 8), 16);
    const b1 = parseInt(ipHex.substring(4, 6), 16);
    const b2 = parseInt(ipHex.substring(2, 4), 16);
    const b3 = parseInt(ipHex.substring(0, 2), 16);
    return { ip: `${b0}.${b1}.${b2}.${b3}`, port };
  }
}

function compressIPv6(groups: string[]): string {
  const full = groups.map(g => g.padStart(4, '0')).join(':');
  // Simple compression: replace longest run of :0000 groups
  const expanded = full.split(':');
  let bestStart = -1, bestLen = 0, curStart = -1, curLen = 0;
  for (let i = 0; i < expanded.length; i++) {
    if (expanded[i] === '0000') {
      if (curStart === -1) curStart = i;
      curLen++;
      if (curLen > bestLen) { bestStart = curStart; bestLen = curLen; }
    } else {
      curStart = -1;
      curLen = 0;
    }
  }
  if (bestLen >= 2) {
    const before = expanded.slice(0, bestStart).map(g => g.replace(/^0+/, '') || '0');
    const after = expanded.slice(bestStart + bestLen).map(g => g.replace(/^0+/, '') || '0');
    if (before.length === 0 && after.length === 0) return '::';
    if (before.length === 0) return '::' + after.join(':');
    if (after.length === 0) return before.join(':') + '::';
    return before.join(':') + '::' + after.join(':');
  }
  return expanded.map(g => g.replace(/^0+/, '') || '0').join(':');
}
