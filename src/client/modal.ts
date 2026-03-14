import type { Snapshot, CacheItem, OpenPort, MapCandidate } from './types.js';

const overlay = () => document.getElementById('modal-overlay')!;
const body = () => document.getElementById('modal-body')!;

export function openModal(html: string) {
  body().innerHTML = html;
  overlay().classList.remove('hidden');
}

export function closeModal() {
  overlay().classList.add('hidden');
  body().innerHTML = '';
}

export function isModalOpen(): boolean {
  return !overlay().classList.contains('hidden');
}

export function showHelp() {
  openModal(`
    <h2>HELP — Keyboard Shortcuts</h2>
    <table>
      <thead><tr><th>Key</th><th>Action</th></tr></thead>
      <tbody>
        <tr><td><kbd>U</kbd></td><td>Unmapped services — public IPs without geolocation</td></tr>
        <tr><td><kbd>L</kbd></td><td>LAN / Local — private network and loopback connections</td></tr>
        <tr><td><kbd>O</kbd></td><td>Open ports — listening TCP and bound UDP sockets</td></tr>
        <tr><td><kbd>T</kbd></td><td>Dump connection cache to terminal (server console)</td></tr>
        <tr><td><kbd>C</kbd></td><td>Clear the connection cache and map markers</td></tr>
        <tr><td><kbd>R</kbd></td><td>Recheck GeoIP databases on disk</td></tr>
        <tr><td><kbd>H</kbd></td><td>Show this help</td></tr>
        <tr><td><kbd>A</kbd></td><td>About NetGlobe</td></tr>
        <tr><td><kbd>Esc</kbd></td><td>Close modal or menu</td></tr>
      </tbody>
    </table>
    <h3>Map Legend</h3>
    <p><span style="color:var(--marker-primary)">&#9679;</span> <strong>Primary</strong> — Remote connection endpoint</p>
    <p><span style="color:var(--marker-cluster)">&#9679;</span> <strong>Cluster</strong> — Endpoints within 25km of each other</p>
    <p><span style="color:var(--marker-me)">&#9679;</span> <strong>You</strong> — Your location</p>
    <h3>Privacy</h3>
    <p>All data is collected and processed locally. Nothing is sent externally except public IP detection (ipify.org) for the "auto" location mode.</p>
  `);
}

export function showAbout(config: { geoEnabled: boolean; geoDataDir: string }) {
  openModal(`
    <h2>ABOUT</h2>
    <table class="kv-table">
      <tr><td>Name</td><td>NetGlobe (TypeScript / Linux)</td></tr>
      <tr><td>Version</td><td>1.0.0</td></tr>
      <tr><td>Description</td><td>See where your computer connects on a live world map</td></tr>
      <tr><td>GeoIP enabled</td><td>${config.geoEnabled ? 'Yes' : 'No'}</td></tr>
      <tr><td>GeoIP data dir</td><td><code>${esc(config.geoDataDir)}</code></td></tr>
      <tr><td>Platform</td><td>Linux (Node.js)</td></tr>
      <tr><td>Network backend</td><td>ss (iproute2)</td></tr>
    </table>
    ${!config.geoEnabled ? `
      <h3>GeoIP Setup</h3>
      <p>Download the free <strong>GeoLite2-City.mmdb</strong> and optionally <strong>GeoLite2-ASN.mmdb</strong> from
      <a href="https://dev.maxmind.com/geoip/geolite2-free-geolocation-data" target="_blank" style="color:var(--green)">MaxMind</a>
      and place them in:<br><code>${esc(config.geoDataDir)}</code></p>
      <p>Then press <kbd>R</kbd> to reload.</p>
    ` : ''}
  `);
}

export function showUnmapped(snapshot: Snapshot | null) {
  if (!snapshot) return openModal('<h2>UNMAPPED SERVICES</h2><p class="empty-message">No data yet</p>');

  const unmapped = snapshot.cacheItems.filter(i => i.scope === 'PUBLIC' && i.lat === null);
  if (unmapped.length === 0) {
    return openModal('<h2>UNMAPPED SERVICES</h2><p class="empty-message">No unmapped public services</p>');
  }

  const rows = aggregateServices(unmapped).map(r => `
    <tr>
      <td title="${esc(r.scope)}">${esc(r.scope)}</td>
      <td title="${esc(r.ip)}">${esc(r.ip)}</td>
      <td>${r.port}</td>
      <td>${esc(r.proto)}</td>
      <td title="${esc(r.service)}">${esc(r.service)}</td>
      <td title="${esc(r.process)}">${esc(r.process)}</td>
      <td>${r.count > 1 ? r.count : ''}</td>
    </tr>
  `).join('');

  openModal(`
    <h2>UNMAPPED SERVICES</h2>
    <p>${unmapped.length} public service${unmapped.length > 1 ? 's' : ''} without geolocation data</p>
    <table>
      <thead><tr><th>Scope</th><th>IP</th><th>Port</th><th>Proto</th><th>Service</th><th>Process</th><th>#</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `);
}

export function showLanLocal(snapshot: Snapshot | null) {
  if (!snapshot) return openModal('<h2>LAN / LOCAL</h2><p class="empty-message">No data yet</p>');

  const items = snapshot.cacheItems.filter(i => i.scope === 'LAN' || i.scope === 'LOCAL');
  if (items.length === 0) {
    return openModal('<h2>LAN / LOCAL</h2><p class="empty-message">No LAN or local connections</p>');
  }

  const rows = aggregateServices(items).map(r => `
    <tr>
      <td title="${esc(r.scope)}">${esc(r.scope)}</td>
      <td title="${esc(r.ip)}">${esc(r.ip)}</td>
      <td>${r.port}</td>
      <td>${esc(r.proto)}</td>
      <td title="${esc(r.service)}">${esc(r.service)}</td>
      <td title="${esc(r.process)}">${esc(r.process)}</td>
      <td>${r.count > 1 ? r.count : ''}</td>
    </tr>
  `).join('');

  openModal(`
    <h2>LAN / LOCAL</h2>
    <p>${items.length} connection${items.length > 1 ? 's' : ''}</p>
    <table>
      <thead><tr><th>Scope</th><th>IP</th><th>Port</th><th>Proto</th><th>Service</th><th>Process</th><th>#</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `);
}

export function showOpenPorts(snapshot: Snapshot | null) {
  if (!snapshot) return openModal('<h2>OPEN PORTS</h2><p class="empty-message">No data yet</p>');

  const ports = snapshot.openPorts;
  if (ports.length === 0) {
    return openModal('<h2>OPEN PORTS</h2><p class="empty-message">No open ports detected</p>');
  }

  // Sort by scope, proto, port
  const sorted = [...ports].sort((a, b) => {
    const scopeOrder = (s: string) => s === 'ALL' ? 0 : s === 'PUBLIC' ? 1 : s === 'LAN' ? 2 : 3;
    return scopeOrder(a.bindScope) - scopeOrder(b.bindScope)
      || a.proto.localeCompare(b.proto)
      || a.port - b.port;
  });

  const rows = sorted.map(p => `
    <tr>
      <td>${esc(p.proto)}</td>
      <td title="${esc(p.bindIp)}">${prettyBindIp(p.bindIp)}</td>
      <td>${p.port}</td>
      <td>${esc(p.bindScope)}</td>
      <td title="${esc(p.serviceName)}">${esc(p.serviceName)}</td>
      <td title="${esc(p.processLabel)}">${esc(p.processLabel)}</td>
      <td>${p.pid || ''}</td>
    </tr>
  `).join('');

  openModal(`
    <h2>OPEN PORTS</h2>
    <p>${ports.length} listening socket${ports.length > 1 ? 's' : ''}</p>
    <table>
      <thead><tr><th>Proto</th><th>Bind</th><th>Port</th><th>Scope</th><th>Service</th><th>Process</th><th>PID</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `);
}

export function showMarkerDetail(key: string, items: MapCandidate[]) {
  if (items.length === 0) return;

  const first = items[0];
  const place = [first.city, first.country].filter(Boolean).join(', ') || 'Unknown location';
  const orgs = [...new Set(items.filter(i => i.asnOrg).map(i => i.asnOrg!))];

  const rows = items.map(i => `
    <tr>
      <td>${esc(i.proto)}</td>
      <td title="${esc(i.ip)}">${esc(i.ip)}</td>
      <td>${i.port}</td>
      <td title="${esc(i.asnOrg || '')}">${esc(i.asnOrg || 'N/A')}</td>
      <td title="${esc(i.processLabel)}">${esc(i.processLabel)}</td>
      <td>${i.pid || ''}</td>
    </tr>
  `).join('');

  openModal(`
    <h2>${esc(place)}</h2>
    ${orgs.length ? `<p>${orgs.map(o => esc(o)).join(', ')}</p>` : ''}
    <p>${items.length} service${items.length > 1 ? 's' : ''} at ${first.lat.toFixed(3)}, ${first.lon.toFixed(3)}</p>
    <table>
      <thead><tr><th>Proto</th><th>IP</th><th>Port</th><th>Organization</th><th>Process</th><th>PID</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `);
}

// Helpers

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function prettyBindIp(ip: string): string {
  if (ip === '0.0.0.0') return 'ALL (IPv4)';
  if (ip === '::') return 'ALL (IPv6)';
  return ip;
}

interface AggregatedRow {
  scope: string;
  ip: string;
  port: number;
  proto: string;
  service: string;
  process: string;
  count: number;
}

function aggregateServices(items: CacheItem[]): AggregatedRow[] {
  const map = new Map<string, AggregatedRow>();
  for (const item of items) {
    const key = `${item.scope}|${item.ip}|${item.port}|${item.proto}|${item.processLabel}`;
    const existing = map.get(key);
    if (existing) {
      existing.count++;
    } else {
      map.set(key, {
        scope: item.scope,
        ip: item.ip,
        port: item.port,
        proto: item.proto,
        service: item.serviceName || '',
        process: item.processLabel,
        count: 1,
      });
    }
  }
  return [...map.values()].sort((a, b) =>
    a.scope.localeCompare(b.scope) || a.ip.localeCompare(b.ip) || a.port - b.port
  );
}
