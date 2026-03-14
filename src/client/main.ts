import { NetGlobeMap } from './map.js';
import { initKeyboard, KeyAction } from './keyboard.js';
import { initMenu } from './menu.js';
import { initTheme } from './theme.js';
import { updateStatus, setFlash } from './status-bar.js';
import * as modal from './modal.js';
import type { Snapshot, ConfigMessage, ServerMessage, MapCandidate } from './types.js';

// State
let ws: WebSocket | null = null;
let lastSnapshot: Snapshot | null = null;
let config: { geoEnabled: boolean; geoDataDir: string } = { geoEnabled: false, geoDataDir: '' };

// Accumulated map candidates (persistent cache across snapshots)
const uiCache = new Map<string, MapCandidate>();

// Initialize map
const netglobe = new NetGlobeMap();
netglobe.init('map');

// Marker click handler
netglobe.setMarkerClickHandler((key, items) => {
  modal.showMarkerDetail(key, items);
});

// Send command to server
function sendCommand(action: string) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'command', action }));
  }
}

// Handle actions (from keyboard or menu)
function handleAction(action: string) {
  switch (action) {
    case 'escape':
      if (modal.isModalOpen()) modal.closeModal();
      else if (menu.isOpen()) menu.close();
      break;
    case 'unmapped':
      modal.showUnmapped(lastSnapshot);
      break;
    case 'lan_local':
      modal.showLanLocal(lastSnapshot);
      break;
    case 'open_ports':
      modal.showOpenPorts(lastSnapshot);
      break;
    case 'help':
      modal.showHelp();
      break;
    case 'about':
      modal.showAbout(config);
      break;
    case 'cache_terminal':
      sendCommand('cache_terminal');
      break;
    case 'clear_cache':
      sendCommand('clear_cache');
      break;
    case 'recheck_geoip':
      sendCommand('recheck_geoip');
      break;
  }
}

// Init keyboard
initKeyboard((action: KeyAction) => handleAction(action));

// Init menu
const menu = initMenu(handleAction);

// Init theme switcher (re-color markers on theme change)
initTheme(() => netglobe.refreshColors());

// Modal close button
document.getElementById('modal-close')!.addEventListener('click', modal.closeModal);
document.getElementById('modal-overlay')!.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) modal.closeModal();
});

// WebSocket connection
function connect() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${location.host}/ws`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    setFlash('Connected', 2000);
  };

  ws.onmessage = (event) => {
    try {
      const msg: ServerMessage = JSON.parse(event.data);
      handleMessage(msg);
    } catch { /* ignore */ }
  };

  ws.onclose = () => {
    setFlash('Disconnected — reconnecting...', 5000);
    setTimeout(connect, 2000);
  };

  ws.onerror = () => {
    ws?.close();
  };
}

function handleMessage(msg: ServerMessage) {
  switch (msg.type) {
    case 'config': {
      const cfg = msg as ConfigMessage;
      config = { geoEnabled: cfg.geoEnabled, geoDataDir: cfg.geoDataDir };
      if (cfg.myLocation) {
        netglobe.setMyLocation({
          lat: cfg.myLocation.lat,
          lon: cfg.myLocation.lon,
          city: cfg.myLocation.city,
          country: cfg.myLocation.country,
        });
      }
      break;
    }

    case 'snapshot': {
      lastSnapshot = msg.data;

      // Merge map candidates into persistent cache
      // Mark all as not-seen
      const seen = new Set<string>();

      for (const c of msg.data.mapCandidates) {
        const key = `${c.ip}|${c.port}`;
        uiCache.set(key, c);
        seen.add(key);
      }

      // Build candidates from cache for map display
      const candidates = [...uiCache.values()];
      netglobe.update(candidates);

      // Update status bar
      updateStatus(msg.data, netglobe.markerCount);
      break;
    }

    case 'flash':
      setFlash(msg.message);
      break;

    case 'clear_cache':
      uiCache.clear();
      netglobe.clearAll();
      break;
  }
}

// Start connection
connect();
