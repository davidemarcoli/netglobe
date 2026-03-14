import type { Snapshot } from './types.js';
import type { ViewMode } from './map.js';

const statusEl = () => document.getElementById('status-text')!;

let flashMessage: string | null = null;
let flashUntil = 0;

export function setFlash(message: string, durationMs = 3000) {
  flashMessage = message;
  flashUntil = Date.now() + durationMs;
}

export function updateStatus(snapshot: Snapshot, markerCount: number, viewMode: ViewMode = 'markers') {
  const el = statusEl();

  // Check flash
  if (flashMessage && Date.now() < flashUntil) {
    el.textContent = flashMessage;
    el.className = 'flash-active';
    return;
  }
  flashMessage = null;

  const s = snapshot.stats;
  const status = snapshot.online ? 'ONLINE' : 'OFFLINE';
  const statusClass = snapshot.online ? 'status-online' : 'status-offline';

  const unmapped = snapshot.cacheItems.filter(i => i.scope === 'PUBLIC' && i.lat === null).length;
  const local = snapshot.cacheItems.filter(i => i.scope === 'LAN' || i.scope === 'LOCAL').length;

  const time = new Date(snapshot.timestamp).toLocaleTimeString();
  const modeTag = `<span class="mode-tag">${viewMode.toUpperCase()}</span>`;

  el.innerHTML = `<span class="${statusClass}">${status}</span>` +
    ` | TCP: ${s.tcpEstablished} est ${s.tcpListening} lst` +
    ` | UDP: ${s.udpRemote} rem ${s.udpBound} bnd` +
    ` | MAP: ${markerCount}` +
    ` | UNM: ${unmapped}` +
    ` | LOC: ${local}` +
    ` | ${modeTag}` +
    ` | ${time}`;
}
