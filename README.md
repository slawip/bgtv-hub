# BGTV Hub

Bulgarian live TV streaming through Stremio and IPTV players, with an integrated OwnTV bridge.



## Features

### Stremio
- Bulgarian live TV channel catalogue.
- Channel logos and thumbnails.
- Fresh HLS stream URLs on playback.
- No account or subscription required.

### OwnTV IPTV Bridge
- Dynamically generated M3U playlist.
- HLS playlist and media segment proxying.
- Highest-bandwidth HLS variant selection.
- Automatic stream URL refresh after authentication failures.
- Protection against unsafe external URLs and redirects.

## Requirements

- Node.js 18 or newer
- npm

## Installation

```bash
git clone https://github.com/slawip/bgtv-hub.git
cd bgtv-hub
npm install

## Running the services

Start the Stremio addon:

```bash
npm start
```

Start the OwnTV IPTV bridge:

```bash
node iptv-bridge.js
```

The bridge serves the playlist at `http://localhost:7001/playlist.m3u` by default.

## Configuration

The bridge can be configured using environment variables. Check `iptv-bridge.js` for the available options and defaults.

## Credits

Based on the original [BGTV Stremio](https://github.com/hjelev/bgtv-stremio) project by its original author. This fork adds the OwnTV IPTV bridge and related improvements.
