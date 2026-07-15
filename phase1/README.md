# Phase 1 — Sidecar & Chat UI (developer guide)

Matrix owns chat, auth, room membership, and message delivery. The sidecar
(`server.mjs`, plain Node, zero npm dependencies) owns the RPG layer: the visible
roster, Obfuscate/Auspex, challenges, character sheets, and the staff log — and serves
the legacy-look chat front-end.

**Deploying for real play? See [`../SELF-HOST.md`](../SELF-HOST.md).** This document
covers running and developing the stack locally.

## Characters

The cast comes from `roster.json` (see `roster.example.json`; docs in `SELF-HOST.md`).
Without a roster file, a built-in demo cast is used, handy for local development:

- `@a:local` / A: Ottenebramento 2 (`ott2`)
- `@b:local` / B: Auspex 2 (`aus2`)
- `@c:local` / C: no powers
- `@staff:local` / Staff: Narratore

## Run locally from a clean checkout

Start Synapse (and optionally Element) in Docker:

```powershell
cd .\phase1\matrix
docker compose run --rm synapse generate
docker compose up -d
```

Provision Matrix users and rooms from the repo root:

```powershell
cd ..\..
$secretLine = Select-String -Path .\phase1\matrix\synapse-data\homeserver.yaml -Pattern '^registration_shared_secret:' | Select-Object -First 1
$secret = ($secretLine.Line -replace '^registration_shared_secret:\s*','').Trim().Trim('"')
$env:SYNAPSE_REGISTRATION_SHARED_SECRET=$secret
$env:MATRIX_PASSWORD='vp-demo-password'
node .\phase1\setup-matrix.mjs
```

Start the sidecar:

```powershell
$env:MATRIX_BASE_URL='http://localhost:8008'
$env:MATRIX_SYNC_POLL_MS='500'
node .\phase1\server.mjs
```

Open `http://localhost:8787/` — legacy login → legacy room page (`chat.html`). The
browser logs in to Synapse directly, sends and polls `m.room.message` events, and the
sidecar serves the RPG roster / powers. Without `VP_REQUIRE_AUTH=1`, identity can also be
spoofed with `?as=@a:local` (used by the dev tools and tests); production deployments set
`VP_REQUIRE_AUTH=1` so identity comes only from a verified Matrix access token.

## Validation

Offline (no homeserver needed):

```powershell
node .\phase1\server.mjs --self-test
node .\phase1\test.mjs
node .\phase1\setup-matrix.mjs --self-test
node .\phase1\matrix-client.mjs
node .\phase1\matrix-events.mjs
node .\phase1\auspex.mjs
node .\phase1\obfuscate.mjs
node .\phase1\challenge.mjs
node .\phase1\extra.mjs
node .\phase1\roster.mjs
```

Against the local stack (requires Synapse + provisioning above):

```powershell
node .\phase1\test-matrix-flow.mjs
```

`test-matrix-flow.mjs` sends a real Matrix room message and verifies that the sync
watcher breaks Obfuscate.

## API

- `GET /health`, `GET /rooms`, `GET /matrix/status`
- `POST /matrix/login` — proxy login, maps the Matrix user to a character
- `GET /me`, `GET /characters/:id`
- `POST /rooms/:room_id/presence`, `GET /rooms/:room_id/visible-characters`, `POST /logout`
- `POST /obfuscate`, `POST /appear`, `POST /auspex`, `POST /auspex2`
- `POST /challenge`, `POST /buff`
- `POST /caccia`, `POST /guarisci`, `POST /volonta`, `POST /fva`, `POST /refill`, `POST /gainxp`
- `GET /banca`, `POST /banca/riscuoti`, `GET /inventario`, `GET|POST /missive`
- `GET /staff/events` (staff), `POST /seed` (staff or `VP_ADMIN_SECRET`)

## Behavior walkthrough

1. A, B, and C enter a room; all appear in each other's roster.
2. A activates Obfuscate → announced to the room, then A vanishes from B's and C's
   rosters (A still reads and can send chat).
3. B uses Auspex (*Scruta*) → A appears, dark-styled, only for B.
4. A speaks publicly → the sync watcher sees the `m.room.message`, A reappears for
   everyone, announced to the room.
5. Staff sees hidden characters at all times and every event in the staff log.

## Limits

- Invisibility is roster-level, the same trust model as the legacy site. Matrix room
  membership is protocol-level shared state: a stock Matrix client pointed at the
  homeserver shows everyone. Players must use the provided chat UI; keep homeserver
  registration closed (the provided config does).
- Runtime state is JSON on disk (`data.json`, or `VP_DATA_PATH`); Synapse has its own
  database.
- `overlay.html` is a development tool with an identity picker; it is intentionally
  unusable when `VP_REQUIRE_AUTH=1`.
