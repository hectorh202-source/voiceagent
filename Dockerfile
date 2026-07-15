# The React admin dashboard (client/) — built separately from the server,
# since it has its own package.json/deps (Vite, React) that have nothing to
# do with the server's runtime. Output lands in client/dist, served as
# static files by the server (see src/index.ts's "/app" mount).
FROM node:24-slim AS client-builder
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client ./
RUN npm run build

# node:24 has node:sqlite available without the experimental flag, matching
# what this app relies on for local storage (see src/db/index.ts).
FROM node:24-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# gosu drops from root to the unprivileged "node" user (already present in
# the base image) after docker-entrypoint.sh fixes up /data's ownership —
# the app process itself never runs as root. See docker-entrypoint.sh.
RUN apt-get update && apt-get install -y --no-install-recommends gosu && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=client-builder /app/client/dist ./client/dist
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
