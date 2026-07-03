# Phase 1 sidecar (Node, no npm dependencies).
# Build from the repo root: the image needs phase1/ plus the legacy assets served
# by the /legacy-assets/ route (login/chat backgrounds and stili.css).
FROM node:22-alpine

WORKDIR /app
COPY ["phase1", "/app/phase1"]
COPY ["sito Vampiripavia/CHAT/imgs", "/app/sito Vampiripavia/CHAT/imgs"]
COPY ["sito Vampiripavia/CHAT/images", "/app/sito Vampiripavia/CHAT/images"]
COPY ["sito Vampiripavia/CHAT/stili.css", "/app/sito Vampiripavia/CHAT/stili.css"]

WORKDIR /app/phase1
ENV PORT=8787
EXPOSE 8787
CMD ["node", "server.mjs"]
