FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY index.js iptv-bridge.js scraper.js ./
COPY lib ./lib
COPY scripts ./scripts
COPY public ./public

# Download channel images at build time so the container is self-contained.
# A failed download is not fatal: the scraper falls back to the remote logos.
RUN node scripts/download-images.js || echo "Logo download failed; using remote logos."

# Writable folder for the catalogue cache, owned by the unprivileged user.
RUN mkdir -p /data && chown node:node /data

USER node
ENV DATA_DIR=/data

# 7000 = Stremio addon, 7001 = IPTV bridge (run with: node iptv-bridge.js)
EXPOSE 7000 7001

CMD ["node", "index.js"]
