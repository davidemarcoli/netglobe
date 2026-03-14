import type { MapCandidate } from './types.js';
import { getMarkerColors } from './theme.js';

declare const L: typeof import('leaflet');

const ZOOM_NEAR_KM = 25.0;

interface MarkerEntry {
  marker: L.CircleMarker;
  line: L.Polyline | null;
  data: MapCandidate;
}

export class NetGlobeMap {
  private map!: L.Map;
  private markers = new Map<string, MarkerEntry>();
  private myMarker: L.Marker | null = null;
  private myLocation: { lat: number; lon: number } | null = null;
  private myLocationInfo: { city?: string | null; country?: string | null } = {};
  private onMarkerClick: ((key: string, items: MapCandidate[]) => void) | null = null;

  init(container: string) {
    this.map = L.map(container, {
      center: [20, 0],
      zoom: 2,
      minZoom: 2,
      maxZoom: 18,
      zoomControl: false,
      attributionControl: true,
      worldCopyJump: true,
    });

    L.control.zoom({ position: 'bottomright' }).addTo(this.map);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(this.map);
  }

  setMyLocation(loc: { lat: number; lon: number; city?: string | null; country?: string | null } | null) {
    if (this.myMarker) {
      this.myMarker.remove();
      this.myMarker = null;
    }
    if (!loc) {
      this.myLocation = null;
      return;
    }

    this.myLocation = { lat: loc.lat, lon: loc.lon };
    this.myLocationInfo = { city: loc.city, country: loc.country };
    this._createMyMarker();
  }

  private _createMyMarker() {
    if (!this.myLocation) return;
    const colors = getMarkerColors();

    const icon = L.divIcon({
      className: 'my-location-marker',
      html: '',
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });
    const marker = L.marker([this.myLocation.lat, this.myLocation.lon], { icon, zIndexOffset: 1000 });
    marker.bindTooltip(
      `MY LOCATION\n${[this.myLocationInfo.city, this.myLocationInfo.country].filter(Boolean).join(', ') || 'Unknown'}`,
      { className: 'netglobe-tooltip', direction: 'top', offset: [0, -10] }
    );
    marker.addTo(this.map);
    this.myMarker = marker;

    const el = marker.getElement();
    if (el) {
      const inner = el.querySelector('.my-location-marker') as HTMLElement || el;
      inner.style.background = colors.me;
      inner.style.width = '14px';
      inner.style.height = '14px';
      inner.style.borderRadius = '50%';
      inner.style.border = 'none';
    }
  }

  setMarkerClickHandler(handler: (key: string, items: MapCandidate[]) => void) {
    this.onMarkerClick = handler;
  }

  /** Re-apply theme colors to all existing markers and lines */
  refreshColors() {
    const colors = getMarkerColors();

    // Rebuild my-location marker with new color
    if (this.myMarker) {
      this.myMarker.remove();
      this.myMarker = null;
      this._createMyMarker();
    }

    // Recompute cluster flags and recolor all markers
    const groups = new Map<string, MarkerEntry>();
    for (const [key, entry] of this.markers) {
      groups.set(key, entry);
    }

    const coords = [...groups.entries()].map(([key, entry]) => ({
      key,
      lat: entry.data.lat,
      lon: entry.data.lon,
    }));

    const nearFlags = new Set<string>();
    for (let i = 0; i < coords.length; i++) {
      for (let j = i + 1; j < coords.length; j++) {
        if (haversine(coords[i].lat, coords[i].lon, coords[j].lat, coords[j].lon) <= ZOOM_NEAR_KM) {
          nearFlags.add(coords[i].key);
          nearFlags.add(coords[j].key);
        }
      }
    }

    for (const [key, entry] of groups) {
      const color = nearFlags.has(key) ? colors.cluster : colors.primary;
      entry.marker.setStyle({ color, fillColor: color });
      if (entry.line) {
        entry.line.setStyle({ color, opacity: 0.3 });
      }
    }
  }

  update(candidates: MapCandidate[]) {
    const colors = getMarkerColors();

    // Group by rounded coordinates
    const groups = new Map<string, MapCandidate[]>();
    for (const c of candidates) {
      const key = `${c.lat},${c.lon}`;
      const arr = groups.get(key) || [];
      arr.push(c);
      groups.set(key, arr);
    }

    // Compute zoom-near flags
    const coords = [...groups.entries()].map(([key, items]) => ({
      key,
      lat: items[0].lat,
      lon: items[0].lon,
    }));

    const nearFlags = new Set<string>();
    for (let i = 0; i < coords.length; i++) {
      for (let j = i + 1; j < coords.length; j++) {
        if (haversine(coords[i].lat, coords[i].lon, coords[j].lat, coords[j].lon) <= ZOOM_NEAR_KM) {
          nearFlags.add(coords[i].key);
          nearFlags.add(coords[j].key);
        }
      }
    }

    const activeKeys = new Set<string>();

    for (const [key, items] of groups) {
      activeKeys.add(key);
      const isNear = nearFlags.has(key);
      const color = isNear ? colors.cluster : colors.primary;
      const lat = items[0].lat;
      const lon = items[0].lon;

      // Build tooltip
      const places = new Set(items.map(i => [i.city, i.country].filter(Boolean).join(', ')).filter(Boolean));
      const orgs = new Set(items.filter(i => i.asnOrg).map(i => i.asnOrg!));
      const services = items.map(i => `${i.proto} :${i.port} ${i.processLabel}`);

      let tip = '';
      if (places.size) tip += [...places].join(' / ') + '\n';
      if (orgs.size) tip += [...orgs].join(', ') + '\n';
      tip += `${items.length} service${items.length > 1 ? 's' : ''}\n`;
      tip += services.slice(0, 8).join('\n');
      if (services.length > 8) tip += `\n... +${services.length - 8} more`;

      const existing = this.markers.get(key);
      if (existing) {
        existing.marker.setStyle({ color, fillColor: color });
        existing.marker.setTooltipContent(tip);
        existing.data = items[0];

        if (this.myLocation && existing.line) {
          existing.line.setStyle({ color, opacity: 0.3 });
        }
      } else {
        const marker = L.circleMarker([lat, lon], {
          radius: 6,
          color,
          fillColor: color,
          fillOpacity: 0.8,
          weight: 1.5,
        });
        marker.bindTooltip(tip, {
          className: 'netglobe-tooltip',
          direction: 'top',
          offset: [0, -10],
        });
        marker.on('click', () => {
          if (this.onMarkerClick) this.onMarkerClick(key, items);
        });
        marker.addTo(this.map);

        let line: L.Polyline | null = null;
        if (this.myLocation) {
          line = L.polyline(
            [[this.myLocation.lat, this.myLocation.lon], [lat, lon]],
            { color, weight: 1, opacity: 0.25, dashArray: '4 6' }
          );
          line.addTo(this.map);
        }

        this.markers.set(key, { marker, line, data: items[0] });
      }
    }

    // Remove stale markers
    for (const [key, entry] of this.markers) {
      if (!activeKeys.has(key)) {
        entry.marker.remove();
        entry.line?.remove();
        this.markers.delete(key);
      }
    }
  }

  clearAll() {
    for (const [, entry] of this.markers) {
      entry.marker.remove();
      entry.line?.remove();
    }
    this.markers.clear();
  }

  get markerCount(): number {
    return this.markers.size;
  }
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}
