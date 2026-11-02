# BGTV Hub

Bulgarian live TV through Stremio and IPTV players, with an integrated OwnTV bridge.

## Features

### Stremio addon

- Bulgarian live TV channel catalogue
- Channel logos and thumbnails
- Fresh HLS stream URLs on playback
- Optional bridge stream for players that need the proxy
- No account or subscription required

### OwnTV IPTV bridge

- Dynamically generated M3U playlist
- HLS playlist and media segment proxying
- Highest-bandwidth HLS variant selection
- Automatic stream URL refresh after authentication failures
- Signed proxy links, so only URLs the bridge generated can be fetched
- Protection against unsafe external URLs, redirects and DNS rebinding

## Requirements

- Node.js 20 or newer and npm, **or** Docker with Docker Compose

## Quick start with Docker

```bash
git clone https://github.com/slawip/bgtv-hub.git
cd bgtv-hub
cp .env.example .env     # then edit the addresses to match your network
docker compose up -d --build
```

This starts two services from one image:

| Service | Port | Purpose |
|---------|------|---------|
| `addon` | 7000 | Stremio addon |
| `bridge` | 7001 | IPTV bridge |

## Quick start without Docker

```bash
git clone https://github.com/slawip/bgtv-hub.git
cd bgtv-hub
npm install
```

Start the Stremio addon:

```bash
npm start
```

Start the OwnTV IPTV bridge (in a second terminal):

```bash
npm run start:bridge
```

## Using it

- **Stremio:** open `http://YOUR-IP:7000/manifest.json` in Stremio, or paste it into the addon search box.
- **IPTV players:** add the playlist URL `http://YOUR-IP:7001/playlist.m3u`.

Replace `YOUR-IP` with the address of the machine running the services. For other devices on your network, use its LAN address rather than `localhost`.

## Configuration

All settings are environment variables, and all are optional.

| Variable | Default | Used by | Description |
|----------|---------|---------|-------------|
| `PORT` | `7000` | addon | Port of the Stremio addon. |
| `BRIDGE_PORT` | `7001` | bridge | Port of the IPTV bridge. |
| `SOURCE_URL` | `https://www.seirsanduk.online` | both | Website the channels and streams are read from. |
| `DATA_DIR` | project folder | both | Where the catalogue cache is stored. |
| `PUBLIC_BASE_URL` | taken from the request | both | Address clients use to reach that service. Set it when running behind a reverse proxy. |
| `ADDON_BASE_URL` | none | bridge | Address of the addon, used for channel logos in the playlist. Without it, local logos are left out. |
| `BRIDGE_URL` | none | addon | Address of the bridge. When set, Stremio also lists a bridge stream for each channel. |
| `PROXY_SECRET` | random on each start | bridge | Secret used to sign proxy links. |

## Security notes

- The bridge only fetches links it signed itself, so it cannot be used as a general-purpose relay. It refuses requests to private and local network addresses.
- Even so, do not expose either port to the internet without a reverse proxy and access control. Keep them on your home network.
- Set `PROXY_SECRET` if you want proxy links to stay valid across restarts.

## Development

```bash
npm test
```

Tests cover playlist rewriting, link signing, stream URL extraction and the address checks.

## Disclaimer

This project does not host or distribute any content. It only reads and relays streams that the source website serves publicly. You are responsible for following local laws and the terms of the source website.

## Credits

Based on the original [BGTV Stremio](https://github.com/hjelev/bgtv-stremio) project by its original author. This fork adds the OwnTV IPTV bridge and related improvements.
