# NetGlobe

A real-time network connection visualizer for Linux. See where your computer connects on a live, interactive world map.

## What it does

NetGlobe monitors your active network connections and plots remote endpoints on a dark-themed map. It polls every 5 seconds using `ss` and enriches public IPs with geolocation data from MaxMind's GeoLite2 databases.

**Features:**
- Live map with connection markers and lines from your location
- Cluster highlighting for nearby endpoints (within 25km)
- Open ports monitor (TCP LISTEN / UDP bound)
- Unmapped and LAN/local connection views
- Three selectable themes: Amber (retro CRT), Cyberpunk (blue), Threat Intel (red)
- Keyboard shortcuts for quick navigation
- All data stays local — nothing is sent externally

## Requirements

- **Node.js** 18+
- **pnpm**
- **iproute2** (`ss` command — preinstalled on most Linux distros)
- **GeoLite2 databases** (optional but recommended):
  - `GeoLite2-City.mmdb` — required for IP geolocation
  - `GeoLite2-ASN.mmdb` — optional, for network org info
  - Free download from [MaxMind](https://dev.maxmind.com/geoip/geolite2-free-geolocation-data) (requires account)
  - Place in `~/.local/share/NetGlobe/`

## Setup

```bash
git clone https://github.com/davidemarcoli/netglobe.git && cd netglobe
pnpm install
```

## Running

**Development** (with hot reload):
```bash
pnpm dev
```
Opens at `http://localhost:5173`.

**Production:**
```bash
pnpm build
pnpm start
```
Opens at `http://127.0.0.1:8050`.

## Keyboard Shortcuts

| Key   | Action                        |
|-------|-------------------------------|
| `U`   | Unmapped services             |
| `L`   | LAN / local connections       |
| `O`   | Open ports                    |
| `T`   | Dump cache to terminal        |
| `C`   | Clear cache                   |
| `R`   | Recheck GeoIP databases       |
| `H`   | Help                          |
| `A`   | About                         |
| `Esc` | Close modal / menu            |
