# Vampiri Pavia — Phase 1

Rebuild of the Vampiri Pavia play-by-chat RPG on modern infrastructure. Matrix
([Synapse](https://element-hq.github.io/synapse/latest/)) provides accounts, chat rooms,
and message delivery; a lightweight Node sidecar provides the game layer — the visible
character roster, Obfuscate and Auspex disciplines, mental-point spending, challenges, and
the staff log — behind a faithful recreation of the original chat interface.

## Architecture

```
players' browsers
      │
      ├────────────► sidecar  (Node, phase1/server.mjs — chat UI + RPG API)
      │                  │
      └────────────► synapse (Matrix homeserver — login, rooms, messages)
                         ▲
                sidecar watches /sync (speaking breaks Obfuscate, ...)
```

Two services. The sidecar is the address players use; their browsers also talk to Synapse
directly for login and messages. Invisibility is roster-level (as in the original site):
a hidden character disappears from the game roster but remains in the room reading chat.

## Deploying on your own server

**Follow [`SELF-HOST.md`](SELF-HOST.md).** Summary:

1. Copy `phase1/roster.example.json` to `phase1/roster.json` and list your real
   characters (usernames, passwords, staff flag, disciplines).
2. Copy `.env.example` to `.env` and set your secrets.
3. `docker compose -f docker-compose.prod.yml up -d --build`
4. Put a reverse proxy with TLS in front of both services.

The stack auto-provisions on first boot: it registers every roster user on the homeserver
and creates the 65 game locations. All state persists in Docker volumes.

`RAILWAY-DEPLOY.md` documents the equivalent deployment on Railway (used for the demo).

## Game mechanics (Phase 1 scope)

| mechanic | behavior |
|---|---|
| **Oscurazione / Ottenebramento** (`obf1/2`, `ott1/2`) | Hide from the roster (level 2 works even with others present). Costs 1 mental point. Speaking, knocking, or attacking makes you reappear, announced to the room. |
| **Auspex** (`aus1/2`) | *Scruta* reveals hidden characters (level 2 sees level-2 hiding); *Aguzza l'udito* reads other characters' whispers. Costs 1 mental point per use. |
| **Challenges** | Physical/social/mental contests with room narration; attacking while hidden always breaks hiding. |
| **Staff** | Sees hidden characters at all times, receives all whispers, reads the event log, can reset game state. |
| Sheet, XP ankh, hunt/heal, willpower refills, bank, inventory, missive | Ported from the legacy `scheda`/`pannello` behavior. |

Characters and their disciplines are defined by the storyteller in `roster.json` — there
is no open registration.

## Repository layout

| path | contents |
|---|---|
| `phase1/` | The sidecar: server, game logic, chat UI, provisioning, tests |
| `phase1/matrix/` | Local-dev Matrix stack and the Synapse production image |
| `sito Vampiripavia/CHAT/` (partial) | Original site assets reused by the UI (images, CSS) |
| `SELF-HOST.md`, `docker-compose.prod.yml`, `.env.example` | Production deployment |
| `Dockerfile` | Sidecar image (build from the repo root) |

## Development

No dependencies to install — the sidecar is plain Node (18+). Offline test suite:

```bash
cd phase1
node server.mjs --self-test && node test.mjs && node setup-matrix.mjs --self-test
node auspex.mjs && node obfuscate.mjs && node challenge.mjs && node extra.mjs && node roster.mjs
```

`phase1/README.md` covers running the full local stack (Synapse in Docker + sidecar) and
the HTTP API.
