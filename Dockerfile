# Cinévio : addon Nuvio / Stremio en français.
#   docker build -t cinevio .
#   docker run -d -p 7000:7000 -e TMDB_API_KEY=ta_cle -v cinevio-data:/data cinevio
FROM node:22-bookworm-slim

# Chromium : cartes des collections et lecture des classements FlixPatrol.
# Xvfb : écran virtuel, pour le mode « fenêtre » de Chromium quand FlixPatrol bloque le mode invisible.
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-dejavu-core xvfb ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=7000 \
    DATA_DIR=/data \
    BROWSER_PATH=/usr/bin/chromium \
    BROWSER_NO_SANDBOX=1

WORKDIR /app
# Aucune dépendance npm : on copie juste le code.
COPY package.json ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts

RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME /data
EXPOSE 7000

HEALTHCHECK --interval=60s --timeout=10s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||7000)+'/api/info').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["sh", "scripts/docker-start.sh"]
