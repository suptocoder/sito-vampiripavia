# Phase 1 Matrix/Element RPG Overlay

Local Matrix/Element proof of concept for RPG roster visibility. Matrix owns chat, auth, room membership, and message delivery. The sidecar owns the RPG roster, Obfuscate, Auspex, staff log, and Element widget iframe.

## Run From A Clean Checkout

Start Synapse and Element:

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

Open the legacy-look front-end (this is the entry now):

- `http://localhost:8787/` — legacy login → legacy room page (`chat.html`).

The room page reuses the legacy `stili.css` + image assets and the original frameset
geometry. Synapse is still the engine: the browser logs in to Synapse directly, sends and
polls `m.room.message` events, and the sidecar serves the RPG roster / Obfuscate / Auspex.
Element Web (`http://localhost:8080`) and the older `overlay.html` still run but are no
longer the front-end.

## Validation

```powershell
node .\phase1\server.mjs --self-test
node .\phase1\matrix-client.mjs
node .\phase1\matrix-events.mjs
node .\phase1\setup-matrix.mjs --self-test
node .\phase1\test.mjs
node .\phase1\test-matrix-flow.mjs
```

`test-matrix-flow.mjs` requires the local Synapse stack and provisioned users. It sends a real Matrix room message and verifies that the Matrix sync watcher breaks Obfuscate.

## Users

- `@a:local` / A: `obf2`, 5 mental points.
- `@b:local` / B: `aus2`, 5 mental points.
- `@c:local` / C: observer, 5 mental points.
- `@staff:local` / Staff: staff event viewer.

## Rooms

`setup-matrix.mjs` creates or resolves the seeded rooms and writes real Matrix room IDs to `phase1/data.json`:

- `elysium`
- `strada`

## Element Widget URL

Use this URL as a custom widget or side panel:

```text
http://localhost:8787/overlay.html?matrix_user_id=$matrix_user_id&room_id=elysium
```

If Element does not expand variables in the local build, use literal Matrix IDs during validation:

```text
http://localhost:8787/overlay.html?matrix_user_id=@a:local&room_id=elysium
```

## API

- `GET /health`
- `POST /seed`
- `GET /me`
- `POST /rooms/:room_id/presence`
- `GET /rooms/:room_id/visible-characters`
- `POST /obfuscate`
- `POST /appear`
- `POST /auspex`
- `GET /staff/events`
- `GET /matrix/status`

Local authentication is the Matrix user id passed as `x-matrix-user-id` or `?matrix_user_id=@a:local`. Production token validation is out of scope for Phase 1.

## Flow

1. A, B, and C enter Elysium; all appear in the overlay roster.
2. A uses Obfuscate.
3. B and C no longer see A in the overlay roster.
4. A remains in the Matrix room and can read/send chat.
5. B uses Auspex; A appears only to B as revealed.
6. C still cannot see A.
7. A sends a public message in Element.
8. The Matrix sync watcher sees the `m.room.message` event and A becomes visible to everyone.
9. Staff sees Obfuscate, Auspex, and message-break events in the staff log.

## Limits

- Inside this Element build, obfuscated PCs are hidden everywhere: the vampiric `.vp-roster` panel hides them per-observer, and Element's native member list / facepile are hidden outright (`element-vp.css`, `.vp-room` rules). A player cannot reveal a hidden PC by opening the member list.
- Residual, protocol-level leak: Matrix room membership is shared state. A *different* Matrix client or the raw Client-Server API pointed at the same homeserver still sees who is joined. Hiding that would require patching Synapse (a fork), which is out of scope and not possible with stock Matrix.
- Staff notifications are Phase 1 staff-log entries, not Matrix push notifications.
- Runtime state is JSON-backed in `phase1/data.json`; production persistence is remaining work.
