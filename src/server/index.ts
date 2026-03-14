import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { WebSocketServer, WebSocket } from 'ws';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';
import open from 'open';

import { SERVER_HOST, SERVER_PORT, POLL_INTERVAL_MS, MY_LOCATION, geoDataDir } from './config.js';
import { GeoInfo } from './geoinfo.js';
import { Model, Snapshot } from './model.js';
import { DnsResolver } from './dnsinfo.js';
import { detectPublicIp } from './public-ip.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isDev = !!process.env.NETGLOBE_DEV;

interface MyLocation {
  lon: number;
  lat: number;
  ip: string | null;
  city: string | null;
  country: string | null;
  mode: string;
}

async function resolveMyLocation(geo: GeoInfo): Promise<MyLocation | null> {
  if (MY_LOCATION === 'none') return null;

  if (Array.isArray(MY_LOCATION)) {
    return { lon: MY_LOCATION[0], lat: MY_LOCATION[1], ip: null, city: null, country: null, mode: 'fixed' };
  }

  // "auto" mode
  const ip = await detectPublicIp();
  if (!ip) {
    console.log('Could not detect public IP. "My location" marker disabled.');
    return null;
  }

  if (geo.enabled) {
    const result = geo.lookup(ip);
    if (result.lat !== null && result.lon !== null) {
      return {
        lon: result.lon, lat: result.lat,
        ip, city: result.city, country: result.country,
        mode: 'auto',
      };
    }
  }

  console.log(`Public IP ${ip} could not be geolocated. "My location" marker disabled.`);
  return null;
}

async function main() {
  // Ensure geo data dir exists
  const dataDir = geoDataDir();
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
    console.log(`Created data directory: ${dataDir}`);
  }

  // Initialize GeoIP
  const geo = new GeoInfo(dataDir);
  const geoLoaded = await geo.load();
  if (geoLoaded) {
    console.log('GeoIP databases loaded.');
  } else {
    console.log(`GeoIP databases not found in ${dataDir}`);
    console.log('Place GeoLite2-City.mmdb (and optionally GeoLite2-ASN.mmdb) there for geolocation.');
  }

  // Detect my location
  const myLocation = await resolveMyLocation(geo);
  if (myLocation) {
    const place = [myLocation.city, myLocation.country].filter(Boolean).join(', ');
    console.log(`My location: ${place || `${myLocation.lon}, ${myLocation.lat}`} (${myLocation.mode})`);
  }

  // Initialize model
  const dnsResolver = new DnsResolver();
  const model = new Model(geo, dnsResolver);

  // Setup Fastify
  const app = Fastify({ logger: false });

  // Serve static files (built client)
  const clientDir = join(__dirname, '..', 'client');
  if (existsSync(clientDir)) {
    await app.register(fastifyStatic, {
      root: clientDir,
      prefix: '/',
    });
  }

  // Start HTTP server
  await app.listen({ host: SERVER_HOST, port: SERVER_PORT });
  console.log(`NetGlobe running at http://${SERVER_HOST}:${SERVER_PORT}`);

  // Setup WebSocket server on the same port
  const wss = new WebSocketServer({ server: app.server });
  const clients = new Set<WebSocket>();

  wss.on('connection', (ws) => {
    clients.add(ws);

    // Send initial config
    ws.send(JSON.stringify({
      type: 'config',
      myLocation,
      geoEnabled: geo.enabled,
      geoDataDir: dataDir,
    }));

    // Send last snapshot immediately if available
    if (lastSnapshot) {
      ws.send(JSON.stringify({ type: 'snapshot', data: lastSnapshot }));
    }

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'command') {
          await handleCommand(msg.action, ws);
        }
      } catch { /* ignore malformed */ }
    });

    ws.on('close', () => clients.delete(ws));
  });

  let lastSnapshot: Snapshot | null = null;
  let uiCache = new Map<string, any>();

  function broadcast(msg: object) {
    const data = JSON.stringify(msg);
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  }

  async function handleCommand(action: string, ws: WebSocket) {
    switch (action) {
      case 'clear_cache':
        uiCache.clear();
        broadcast({ type: 'clear_cache' });
        broadcast({ type: 'flash', message: 'Cache cleared' });
        break;

      case 'recheck_geoip': {
        const loaded = await geo.reload();
        broadcast({
          type: 'config',
          myLocation,
          geoEnabled: geo.enabled,
          geoDataDir: dataDir,
        });
        broadcast({ type: 'flash', message: loaded ? 'GeoIP databases reloaded' : 'GeoIP databases not found' });
        break;
      }

      case 'cache_terminal':
        if (lastSnapshot) {
          console.log('\n=== NetGlobe Cache Dump ===');
          for (const item of lastSnapshot.cacheItems) {
            const place = [item.city, item.country].filter(Boolean).join(', ');
            console.log(`  ${item.proto} ${item.ip}:${item.port} [${item.scope}] ${place || 'N/A'} — ${item.processLabel}`);
          }
          console.log(`=== ${lastSnapshot.cacheItems.length} items ===\n`);
        }
        broadcast({ type: 'flash', message: 'Cache dumped to terminal' });
        break;
    }
  }

  // Polling loop
  async function poll() {
    try {
      const snapshot = await model.snapshot();
      lastSnapshot = snapshot;
      broadcast({ type: 'snapshot', data: snapshot });
    } catch (e) {
      console.error('Poll error:', e);
    }
  }

  // Initial poll
  await poll();

  // Recurring poll
  setInterval(poll, POLL_INTERVAL_MS);

  // Open browser (in production only — in dev, Vite opens it)
  if (!isDev) {
    setTimeout(() => {
      open(`http://${SERVER_HOST}:${SERVER_PORT}`).catch(() => {});
    }, 500);
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
