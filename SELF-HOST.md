# Self-hosting Phase 1 on a private server

This is the deployment guide for running Vampiri Pavia Phase 1 on your own server (not
Railway — see `RAILWAY-DEPLOY.md` for that). Unlike the old PHP site, Phase 1 is **two
services**, not a folder you upload:

1. **Synapse** — the Matrix homeserver. Owns accounts, login, chat rooms, and message
   delivery.
2. **Sidecar** — a small Node app (no npm dependencies). Owns the RPG layer (roster,
   Obfuscate, Auspex, staff log) and serves the legacy-look chat UI. This is the link you
   give your players.

The browser talks to **both**: it logs in to Synapse directly and calls the sidecar for
the game state. So the deployment needs both services running and reachable.

There are two ways to run it. **Part A (Docker Compose)** is the recommended path and the
closest to "upload and it works". **Part B (bare metal)** is the fallback if the server
has no Docker.

---

## Before you start: define your cast (both paths need this)

The demo shipped with fixed `a` / `b` / `c` / `staff` characters. For a real game you list
your own players in **`phase1/roster.json`**. When that file exists it **replaces** the
demo cast; the game rooms/map still come from `seed.json`.

```bash
cp phase1/roster.example.json phase1/roster.json
# then edit phase1/roster.json
```

Each entry:

| field | required | meaning |
|---|---|---|
| `username` | yes | Matrix localpart (lowercase letters, digits, `. _ = - /`). The Matrix ID becomes `@<username>:<server-name>`. |
| `display_name` | no | Name shown in chat/roster. Defaults to `username`. |
| `password` | no | This player's login password. If omitted, the shared `MATRIX_DEMO_PASSWORD` is used. Prefer per-player passwords. |
| `is_staff` | no | `true` = Narratore/GM: sees hidden PCs, reads the staff log, owns room creation. **Give at least one character this.** |
| `powers` | no | Discipline codes owned: `obf1`/`obf2` (Oscurazione 1/2), `ott1`/`ott2` (Ottenebramento 1/2), `aus1`/`aus2` (Auspex 1/2). |
| `mental_points` | no | Starting mental pool (each power use costs 1; activation needs ≥2). Default 5. |

Any other sheet field (`clan`, `status`, `citta`, `natura`, `gen`, `umanita`, `fis`,
`soc`, `blood`, `will`, `abilita`, `disciplines`, `note`, `tempo_px`, …) can also be set
per character; anything you leave out falls back to a sane default sheet.

`roster.json` is gitignored and is **not** baked into the Docker image (it can hold
passwords) — the compose file mounts it into the container instead.

> Changing the roster later: edit `roster.json`, then re-run provisioning (add a new
> player's Matrix account) and reset RPG state. New usernames get created; existing
> accounts are reused. See "Resetting / updating" at the end.

---

## Part A — Docker Compose (recommended)

Requires Docker with the Compose plugin (`docker compose version`).

### 1. Configure secrets

```bash
cp .env.example .env
# edit .env
```

Set at minimum:

- `SYNAPSE_REGISTRATION_SHARED_SECRET` — any long random string.
- `MATRIX_DEMO_PASSWORD` — fallback password for roster entries without their own.
- `VP_ADMIN_SECRET` — lets you reset game state without the staff login.
- `MATRIX_SERVER_NAME` — user IDs become `@name:<this>`. `local` is fine for a closed
  server; **do not change it after players register.**
- `VP_PUBLIC_SYNAPSE_URL` — the **public https URL** where players' browsers reach
  Synapse (see step 3).

### 2. Build and start

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

On first boot the sidecar waits for Synapse, registers every roster user, creates and
joins the 65 game rooms, and writes the wiring to a persistent volume. Watch it:

```bash
docker compose -f docker-compose.prod.yml logs -f sidecar
# look for: auto-provisioned Matrix users and rooms   (the room burst takes a minute or two)
```

State lives in named volumes (`synapse-data`, `vp-data`), so restarts and redeploys keep
accounts, rooms, messages, and RPG state.

### 3. Put a reverse proxy + TLS in front

Players' browsers hit **both** the sidecar (the chat UI) and Synapse directly, so both
need public, preferably https, URLs. Terminate TLS at your proxy (nginx / Caddy /
Traefik) and route two hostnames:

| public hostname | proxy to | this is |
|---|---|---|
| e.g. `chat.yourdomain.tld` | sidecar `:8787` | the link you give players |
| e.g. `synapse.yourdomain.tld` | synapse `:8008` | must equal `VP_PUBLIC_SYNAPSE_URL` |

Minimal Caddy example (`Caddyfile`):

```
chat.yourdomain.tld {
    reverse_proxy localhost:8787
}
synapse.yourdomain.tld {
    reverse_proxy localhost:8008
}
```

Then set `VP_PUBLIC_SYNAPSE_URL=https://synapse.yourdomain.tld` in `.env` and
`docker compose -f docker-compose.prod.yml up -d` again to apply.

> Single-host / no domain yet? You can test over plain HTTP by setting
> `VP_PUBLIC_SYNAPSE_URL=http://<server-ip>:8008` and opening `http://<server-ip>:8787`.
> Fine for a first smoke test on a trusted network; use real TLS for actual play (Matrix
> logins send passwords).

### 4. Smoke test

Open `https://chat.yourdomain.tld/` and log in as one of your roster players with their
password. If you gave someone Obfuscate (`obf2`/`ott2`), tick **Oscurazione** at login and
confirm they vanish from other players' rosters; an Auspex player (`aus2`) can **Scruta**
to reveal them; the staff login sees everyone. See `RAILWAY-DEPLOY.md` §3 for the full
five-step visibility walkthrough — the mechanics are identical.

---

## Part B — Bare metal (no Docker)

Use this only if the server can't run Docker. It's more steps and more OS-specific.

### 1. Install Synapse

Follow the official Synapse install for your OS
(<https://element-hq.github.io/synapse/latest/setup/installation.html>) — e.g. on
Debian/Ubuntu via the matrix.org apt repo, or `pip install matrix-synapse` in a venv.

Generate the config once:

```bash
python -m synapse.app.homeserver \
  --server-name local \
  --config-path /etc/vp-synapse/homeserver.yaml \
  --generate-config --report-stats=no
```

Then edit `/etc/vp-synapse/homeserver.yaml` to match the demo homeserver: keep
`enable_registration: false`, set `registration_shared_secret` to your secret, and relax
the rate limits (provisioning creates 65 rooms in one burst and the group logs in from one
IP). Copy the `rc_*` overrides from `phase1/matrix/railway/start-railway.sh` — they are the
exact values used in the working deployment.

Run Synapse (ideally under systemd):

```ini
# /etc/systemd/system/vp-synapse.service
[Unit]
Description=VP Synapse
After=network.target

[Service]
ExecStart=/opt/vp-synapse/venv/bin/python -m synapse.app.homeserver -c /etc/vp-synapse/homeserver.yaml
Restart=on-failure
User=synapse

[Install]
WantedBy=multi-user.target
```

### 2. Install the sidecar

Needs Node.js 18+ (tested on 22/25). No `npm install` — there are zero dependencies.

```ini
# /etc/systemd/system/vp-sidecar.service
[Unit]
Description=VP Sidecar
After=network.target vp-synapse.service

[Service]
WorkingDirectory=/opt/vp/phase1
ExecStart=/usr/bin/node server.mjs
Restart=on-failure
Environment=PORT=8787
Environment=MATRIX_BASE_URL=http://127.0.0.1:8008
Environment=MATRIX_SERVER_NAME=local
Environment=VP_PUBLIC_SYNAPSE_URL=https://synapse.yourdomain.tld
Environment=VP_DATA_PATH=/var/lib/vp/data.json
Environment=VP_ROSTER_PATH=/opt/vp/phase1/roster.json
Environment=VP_REQUIRE_AUTH=1
Environment=VP_AUTO_PROVISION=1
Environment=SYNAPSE_REGISTRATION_SHARED_SECRET=your-shared-secret
Environment=MATRIX_DEMO_PASSWORD=your-shared-password
Environment=VP_ADMIN_SECRET=your-admin-secret

[Install]
WantedBy=multi-user.target
```

`VP_AUTO_PROVISION=1` makes the sidecar register the roster users and build the rooms on
first start (same as the compose path). Or run it once manually:

```bash
cd /opt/vp
SYNAPSE_REGISTRATION_SHARED_SECRET=your-shared-secret \
MATRIX_BASE_URL=http://127.0.0.1:8008 \
MATRIX_SERVER_NAME=local \
MATRIX_DEMO_PASSWORD=your-shared-password \
VP_ROSTER_PATH=/opt/vp/phase1/roster.json \
VP_DATA_PATH=/var/lib/vp/data.json \
node phase1/setup-matrix.mjs
```

### 3. Reverse proxy + TLS

Same as Part A step 3 — expose the sidecar (`:8787`) and Synapse (`:8008`) on two https
hostnames and point `VP_PUBLIC_SYNAPSE_URL` at the Synapse one.

---

## Environment variables (reference)

| variable | required | purpose |
|---|---|---|
| `SYNAPSE_REGISTRATION_SHARED_SECRET` | yes | Lets the sidecar register roster users. Same value on both services. |
| `MATRIX_BASE_URL` | yes | Sidecar → Synapse URL (internal; `http://synapse:8008` in compose). |
| `VP_PUBLIC_SYNAPSE_URL` | yes | Browser → Synapse URL (public https). |
| `MATRIX_SERVER_NAME` | rec. | Homeserver name → `@user:<this>`. Default `local`. Fixed once players exist. |
| `MATRIX_DEMO_PASSWORD` | rec. | Fallback password for roster entries without their own `password`. |
| `VP_REQUIRE_AUTH` | rec. | `1` = identity only via a real Matrix token (rejects impersonation). |
| `VP_AUTO_PROVISION` | rec. | `1` = register users + build rooms on boot. |
| `VP_DATA_PATH` | rec. | Where live state (`data.json`) is written. Point at a volume/persistent dir. |
| `VP_ROSTER_PATH` | no | Roster file location. Default `phase1/roster.json`. |
| `VP_ADMIN_SECRET` | no | Gates `POST /seed` (state reset) without the staff login. |
| `VP_AUSPEX_DICE` | no | `1` = legacy randomized Auspex contest instead of deterministic reveal. |
| `PORT` | no | Sidecar listen port. Default 8787. |

---

## Resetting / updating

**Reset RPG state** (mental points, visibility, reveals — keeps accounts, rooms, and
messages):

```bash
curl -X POST "https://chat.yourdomain.tld/seed?admin_secret=<VP_ADMIN_SECRET>"
```

Also available from the `staff` login in the UI.

**Add or change players:** edit `roster.json`, then restart the sidecar (compose:
`docker compose -f docker-compose.prod.yml up -d`). Auto-provisioning registers any new
usernames and reuses existing accounts. New characters won't get their RPG sheet until a
state reset (`POST /seed`), since the sheet is rebuilt from the roster on reseed.

> Note: removing a player from `roster.json` stops the sidecar from mapping their Matrix
> account to a character (they can't log into the game), but does not delete their Matrix
> account on Synapse. Deactivate accounts via the Synapse admin API if you need that.

---

## What does NOT carry over from the legacy PHP site

- No MySQL. State is JSON on disk (`VP_DATA_PATH`), plus Synapse's own database.
- Only the Phase-1 mechanics are ported: active character/room mapping, Obfuscate, Auspex,
  mental-point spend, the visible roster, and a staff event log. The full legacy feature
  set (combat, inventory economy, missives-at-scale, forum, etc.) is not in Phase 1.
- Invisibility is roster-level, the same trust model as the legacy site: a hidden PC is
  hidden from the game roster but still a member of the Matrix room. Don't hand players a
  stock Element client pointed at the homeserver — the native member list shows everyone.
  The provided chat UI is the intended (and only) client.
