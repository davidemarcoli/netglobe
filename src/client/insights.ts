import type { Snapshot, CacheItem } from './types.js';
import { esc, formatBytes } from './modal.js';

interface BreakdownEntry {
  label: string;
  count: number;
  percent: number;
}

function breakdown(items: CacheItem[], keyFn: (i: CacheItem) => string | null, limit = 10): BreakdownEntry[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (total === 0) return [];

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, count]) => ({
      label,
      count,
      percent: Math.round((count / total) * 100),
    }));
}

function renderBarChart(title: string, entries: BreakdownEntry[], emptyMsg: string): string {
  if (entries.length === 0) {
    return `<h3>${title}</h3><p class="empty-message">${emptyMsg}</p>`;
  }

  const maxCount = entries[0].count;
  const bars = entries.map(e => {
    const width = Math.max(2, (e.count / maxCount) * 100);
    return `
      <div class="bar-row">
        <span class="bar-label" title="${esc(e.label)}">${esc(e.label)}</span>
        <div class="bar-track">
          <div class="bar-fill" style="width: ${width}%"></div>
        </div>
        <span class="bar-value">${e.count} <span class="bar-pct">(${e.percent}%)</span></span>
      </div>`;
  }).join('');

  return `<h3>${title}</h3><div class="bar-chart">${bars}</div>`;
}

interface ProcessEntry {
  process: string;
  connections: number;
  uniqueIps: number;
  totalQueue: number;
}

function getTopProcesses(items: CacheItem[], limit = 10): ProcessEntry[] {
  const map = new Map<string, { connections: number; ips: Set<string>; queue: number }>();

  for (const item of items) {
    const key = item.processLabel;
    const existing = map.get(key);
    if (existing) {
      existing.connections++;
      existing.ips.add(item.ip);
      existing.queue += item.txQueue + item.rxQueue;
    } else {
      map.set(key, {
        connections: 1,
        ips: new Set([item.ip]),
        queue: item.txQueue + item.rxQueue,
      });
    }
  }

  return [...map.entries()]
    .sort((a, b) => b[1].connections - a[1].connections)
    .slice(0, limit)
    .map(([process, data]) => ({
      process,
      connections: data.connections,
      uniqueIps: data.ips.size,
      totalQueue: data.queue,
    }));
}

function getTopByQueue(items: CacheItem[], limit = 10): { ip: string; hostname: string | null; port: number; process: string; queue: number }[] {
  return [...items]
    .filter(i => i.txQueue + i.rxQueue > 0)
    .sort((a, b) => (b.txQueue + b.rxQueue) - (a.txQueue + a.rxQueue))
    .slice(0, limit)
    .map(i => ({
      ip: i.ip,
      hostname: i.hostname,
      port: i.port,
      process: i.processLabel,
      queue: i.txQueue + i.rxQueue,
    }));
}

export function renderInsights(snapshot: Snapshot): string {
  const publicItems = snapshot.cacheItems.filter(i => i.scope === 'PUBLIC');
  const allItems = snapshot.cacheItems;

  // Country breakdown
  const countries = breakdown(publicItems, i => i.country);

  // Organization breakdown
  const orgs = breakdown(publicItems, i => i.asnOrg);

  // Protocol mix
  const protos = breakdown(allItems, i => i.proto);

  // Top processes
  const processes = getTopProcesses(allItems);
  const processRows = processes.map(p => `
    <tr>
      <td title="${esc(p.process)}">${esc(p.process)}</td>
      <td>${p.connections}</td>
      <td>${p.uniqueIps}</td>
      <td>${formatBytes(p.totalQueue)}</td>
    </tr>
  `).join('');

  // Top by queue
  const queueTop = getTopByQueue(allItems);
  let queueSection = '';
  if (queueTop.length > 0) {
    const queueRows = queueTop.map(q => `
      <tr>
        <td title="${esc(q.ip)}">${esc(q.hostname || q.ip)}</td>
        <td>${q.port}</td>
        <td title="${esc(q.process)}">${esc(q.process)}</td>
        <td>${formatBytes(q.queue)}</td>
      </tr>
    `).join('');

    queueSection = `
      <h3>TOP BY QUEUE SIZE</h3>
      <table>
        <thead><tr><th>Host</th><th>Port</th><th>Process</th><th>Queue</th></tr></thead>
        <tbody>${queueRows}</tbody>
      </table>
    `;
  }

  // Summary stats
  const totalPublic = publicItems.length;
  const geolocated = publicItems.filter(i => i.lat !== null).length;
  const uniqueCountries = new Set(publicItems.filter(i => i.country).map(i => i.country)).size;
  const uniqueOrgs = new Set(publicItems.filter(i => i.asnOrg).map(i => i.asnOrg)).size;

  return `
    <h2>INSIGHTS</h2>
    <div class="insights-summary">
      <span class="stat">${totalPublic} public</span>
      <span class="stat-sep">·</span>
      <span class="stat">${geolocated} geolocated</span>
      <span class="stat-sep">·</span>
      <span class="stat">${uniqueCountries} countries</span>
      <span class="stat-sep">·</span>
      <span class="stat">${uniqueOrgs} organizations</span>
    </div>

    ${renderBarChart('CONNECTIONS BY COUNTRY', countries, 'No country data (GeoIP required)')}
    ${renderBarChart('CONNECTIONS BY ORGANIZATION', orgs, 'No organization data (GeoIP ASN required)')}
    ${renderBarChart('PROTOCOL MIX', protos, 'No connections')}

    <h3>TOP PROCESSES</h3>
    ${processes.length > 0 ? `
      <table>
        <thead><tr><th>Process</th><th>Connections</th><th>Unique IPs</th><th>Queue</th></tr></thead>
        <tbody>${processRows}</tbody>
      </table>
    ` : '<p class="empty-message">No process data</p>'}

    ${queueSection}
  `;
}
