# BGTV Hub

Bulgarian live TV streaming through Stremio and IPTV players, with an integrated OwnTV bridge.

## Features

### Stremio addon
- Bulgarian live TV channel catalogue
- Channel logos and thumbnails
- Fresh HLS stream URLs on playback
- No account or subscription required

### OwnTV IPTV bridge
- Dynamically generated M3U playlist
- HLS playlist and media segment proxying
- Highest-bandwidth HLS variant selection
- Automatic stream URL refresh after authentication failures
- Protection against unsafe external URLs and redirects

## Requirements

- Node.js 18 or newer
- npm

## Installation

```bash
git clone https://github.com/slawip/bgtv-hub.git
cd bgtv-hub
npm install
```

## Usage

Start the Stremio addon:

```bash
npm start
```

Start the OwnTV IPTV bridge:

```bash
node iptv-bridge.js
```

By default, the bridge serves the playlist at `http://localhost:7001/playlist.m3u`.

## Configuration

The OwnTV bridge port is currently hardcoded and is not configurable through an environment variable.

| Setting | Default | Description |
|----------|---------|-------------|
| Port | `7001` | Port used by the OwnTV IPTV bridge |

## Docker

Docker Compose currently runs the Stremio addon only. It does not start the OwnTV IPTV bridge.

Build and start the Stremio addon:

```bash
docker compose up -d --build
```

The add-on will be available at `http://localhost:7000`.

## Disclaimer

This project does not host or distribute any content. It only proxies publicly available streams. Users are responsible for complying with local laws and the terms of the stream providers.

## Credits

Based on BGTV Stremio: https://github.com/hjelev/bgtv-stremio. This fork adds the OwnTV IPTV bridge and related improvements.
