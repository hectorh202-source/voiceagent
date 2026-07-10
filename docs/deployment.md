# Deployment

How this runs in production: Docker, Caddy, and the VPS setup around them.

## Why Docker

The app itself has no native dependencies (it uses Node's built-in `node:sqlite` instead of a compiled module — see [sqlite-storage.md](sqlite-storage.md)), so it doesn't strictly *need* containerization to run. Docker was chosen anyway because:
- It cleanly isolates this app from anything else on the same VPS (e.g. a game server already running there) — no port or dependency collisions as long as the exposed ports differ
- It bundles the exact Node version needed alongside the app, rather than depending on whatever Node happens to be installed on the host
- `docker compose up -d --build` is a simple, repeatable deploy/redeploy command

## The two containers

Defined in [`docker-compose.yml`](../docker-compose.yml):

```
┌─────────────────────────────────────────────┐
│ VPS                                          │
│                                               │
│  ┌─────────────┐        ┌─────────────────┐  │
│  │   caddy     │        │      app        │  │
│  │ ports 80/443│───────▶│  port 3000       │  │
│  │ (published  │  HTTP  │  (NOT published  │  │
│  │  to host)   │        │   to host)       │  │
│  └─────────────┘        └─────────────────┘  │
│        │                        │             │
│        ▼                        ▼             │
│  caddy-data / caddy-config   app-data volume  │
│  (TLS certs, managed          (SQLite DB +    │
│   by Caddy itself)             encryption key)│
└─────────────────────────────────────────────┘
```

### `app`

Built from the [`Dockerfile`](../Dockerfile) in this repo (`build: .`). Two-stage build:
```dockerfile
FROM node:24-slim AS builder   # npm ci, tsc build
FROM node:24-slim AS runtime   # npm ci --omit=dev, copy dist/, run node dist/index.js
```
`node:24` specifically because `node:sqlite` needs to work without the experimental flag (see [sqlite-storage.md](sqlite-storage.md)). No native build tools (`build-essential`, python, etc.) are needed in the image at all, since there are no compiled native dependencies anywhere in this project.

Configured via two environment variables (set in `docker-compose.yml`, not baked into the image):
```
PORT=3000
DATABASE_PATH=/data/app.db
```
Everything else (ElevenLabs/ServiceTitan credentials, etc.) is entered through `/settings` at runtime, not passed in as env vars — see [settings-app.md](settings-app.md).

The app's port is **not published to the host** — `expose: ["3000"]` rather than `ports:`. Only the `caddy` container can reach it, over the internal Docker Compose network (by service name — `reverse_proxy app:3000` in the Caddyfile resolves via Docker's built-in DNS). This means port 3000 is never reachable from the internet or even from the VPS's other processes directly; the only path in is through Caddy.

### `caddy`

Plain `caddy:2-alpine` image, no custom build. Its entire config is the one-file [`Caddyfile`](../Caddyfile):
```
voiceagent.laughslapper.com {
    reverse_proxy app:3000
}
```
That's the whole reverse proxy config. Caddy automatically requests and renews a Let's Encrypt HTTPS certificate for the domain listed, storing it in the `caddy-data`/`caddy-config` volumes — no manual `certbot` setup, no cert renewal cron job. This is why Caddy was chosen over nginx: HTTPS is zero-config as long as DNS is pointed correctly.

## Volumes (why they matter)

```yaml
volumes:
  app-data:      # /data inside the app container — the SQLite DB + its encryption key
  caddy-data:    # Caddy's internal storage — includes the TLS certificate + private key
  caddy-config:  # Caddy's autosave config state
```

All three are named Docker volumes, meaning they persist independently of the containers themselves. Rebuilding or recreating the containers (`docker compose up -d --build`) does **not** touch these — you'd only lose them by explicitly running `docker compose down -v` (the `-v` is what removes volumes; without it, `down`/`up` cycles are always safe). This is called out because losing `app-data` means losing every saved credential and the encryption key needed to ever decrypt them again — see [sqlite-storage.md](sqlite-storage.md#the-encryption-key-itself).

## DNS and domain setup

Caddy needs a real domain (not a bare IP) to get a trusted certificate. This project uses a subdomain (`voiceagent.laughslapper.com`) rather than the bare root domain, added as its own DNS **A record** pointing at the VPS's IP — chosen over reusing the root domain so the root stays free for other uses (e.g. a normal website) without interference.

## Getting code onto the VPS

This project is a public GitHub repo (`https://github.com/hectorh202-source/voiceagent`), so deploys are a straightforward pull:
```bash
cd ~/voice-agent
git pull
docker compose up -d --build
```
No CI/CD pipeline exists yet — deploys are manual. If this project grows, a natural next step would be a GitHub Actions workflow that SSHes in and runs the same two commands on push to `main`.

## Firewall

Only two ports need to be open to the internet:
```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```
Port 3000 doesn't need a firewall rule at all — since it's never published to the host (see above), there's nothing listening on it externally to block in the first place.

## Operational notes

- **Logs**: `docker compose logs app --tail 50` (or `--follow` to stream live). Every HTTP request is logged one line per request (method, path, status, duration) by [`middleware/requestLogger.ts`](../src/middleware/requestLogger.ts).
- **Restarting**: `docker compose restart app` (or `caddy`) restarts just one service without rebuilding. Sessions and settings survive this, since both live in the persisted `app-data` volume, not in the app's memory — see [sqlite-storage.md](sqlite-storage.md#sessions-why-they-needed-their-own-table) for why that specifically had to be fixed early on (the default in-memory session store did *not* survive restarts, logging every admin out on every deploy).
- **Inspecting the database from inside the container**: `docker compose exec app node -e "..."` — same snippets as in [sqlite-storage.md](sqlite-storage.md#inspecting-the-database-directly), just prefixed with `docker compose exec app`.
- **Coexisting with other services on the VPS** (e.g. a game server): safe by default, since this stack only claims ports 80 and 443. Any conflict would only arise if something else on the VPS already needs those two ports for its own HTTP/HTTPS traffic.
