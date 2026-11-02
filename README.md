# BGTV Stremio + OwnTV Bridge

A Bulgarian live TV project combining a Stremio addon with an IPTV bridge for players such as OwnTV.

Maintained by [slawip](https://github.com/slawip).

## Features

### Stremio Addon
- Bulgarian live TV channel catalogue.
- Channel logos and thumbnails.
- Fresh HLS stream URLs when playback starts.
- No account or subscription required.

### OwnTV IPTV Bridge
- Dynamically generates an M3U playlist.
- Resolves live HLS streams.
- Proxies HLS playlists and media segments.
- Selects the highest-bandwidth HLS variant.
- Refreshes expired stream URLs after authentication failures.
- Includes protections against unsafe external URLs and redirects.

## Requirements

- Node.js 18 or newer
- npm

## Installation

```bash
git clone https://github.com/slawip/bgtv-stremio.git
cd bgtv-stremio
npm install
