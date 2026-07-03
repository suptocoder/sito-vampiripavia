# Deploying Phase 1 to Railway (private demo)

Two services from this repo: **synapse** (Matrix homeserver) and **sidecar** (Node RPG
engine + the chat UI). The sidecar's public URL is the link you send your client.
Everything below assumes the Railway dashboard; the CLI equivalents work the same.

## 0. Pick your secrets first

| Secret | Used for |
|---|---|
| `SYNAPSE_REGISTRATION_SHARED_SECRET` | lets the sidecar register the demo users (any long random string) |
| `MATRIX_DEMO_PASSWORD` | the password your client's testers will type (do NOT reuse `vp-demo-password` — it's public in this repo) |
| `VP_ADMIN_SECRET` | lets you reset the demo state without the staff login |

## 1. Service: synapse

- New service → Deploy from this GitHub repo.
- Settings → Build:
  - **Root directory:** `phase1/matrix/railway`
  - **Dockerfile path:** `Dockerfile.synapse`
- Settings → Volume: mount a volume at **`/data`** (Synapse DB, keys, config).
- Variables:
  - `SYNAPSE_REGISTRATION_SHARED_SECRET` = your secret
- Settings → Networking: generate a public domain, **target port 8008**.
- Deploy. Note the domain, e.g. `https://synapse-production-xxxx.up.railway.app`.

Config is generated on the first boot and persisted to the volume with registration
closed, the shared secret installed, and login rate limits relaxed (the whole test
group will log in from the same office IP). Server name stays `local` (user IDs are
`@a:local` etc.) — that's intentional; federation is not used.

## 2. Service: sidecar

- New service → same repo.
- Settings → Build:
  - **Root directory:** repo root
  - **Dockerfile path:** `Dockerfile`
- Settings → Volume: mount a volume at **`/vp-data`** (live game state).
- Variables (replace the synapse domain with yours):

```
MATRIX_BASE_URL=https://<synapse-domain>
VP_PUBLIC_SYNAPSE_URL=https://<synapse-domain>
VP_DATA_PATH=/vp-data/data.json
VP_REQUIRE_AUTH=1
VP_AUTO_PROVISION=1
SYNAPSE_REGISTRATION_SHARED_SECRET=<same secret as synapse>
MATRIX_DEMO_PASSWORD=<the password for testers>
VP_ADMIN_SECRET=<your admin secret>
```

  Optional: `VP_AUSPEX_DICE=1` for the legacy randomized Auspex contest instead of
  deterministic reveal.

- Settings → Networking: generate a public domain (any target port — the image reads
  Railway's `PORT`).
- Deploy. On first boot the sidecar waits for Synapse, registers `a`, `b`, `c`,
  `staff`, creates the 65 game rooms, and writes the wiring to the volume. Watch the
  logs for `auto-provisioned Matrix users and rooms` (the room creation burst takes a
  minute or two).

`MATRIX_BASE_URL` can instead point at Railway private networking
(`http://<synapse-service>.railway.internal:8008`) to keep sidecar↔synapse traffic
internal; the public URL is the zero-config option. `VP_PUBLIC_SYNAPSE_URL` must
always be the public one — browsers hit it directly for login and messages.

## 3. Smoke test, then send the link

Open `https://<sidecar-domain>/`:

1. Log in as `a` with your `MATRIX_DEMO_PASSWORD`, tick **Oscurazione** → A enters
   hidden (A has Obfuscate level 2).
2. Second browser/incognito: log in as `c` → C's roster does NOT list A.
3. Third: log in as `b` → open **Scheda** → **Scruta** (b has Auspex level 2) → A
   appears in b's roster (dark-styled); C still can't see A.
4. As `a`, say something in the room → everyone sees the message and A pops back
   into all rosters (speaking breaks Obfuscate).
5. `staff` login sees hidden characters at all times.

What to tell the testers:
- Use the sidecar link only (the chat UI). Identity is enforced by real Matrix
  logins — the API rejects impersonation (`VP_REQUIRE_AUTH=1`).
- Powers are on the **Scheda** popup: *Oscurati/Appari*, *Scruta* (Auspex).
- Mental points do NOT regenerate (known Phase-1 gap): each power use costs 1, and
  activation needs at least 2. When the demo runs dry, reset it:

```
curl -X POST "https://<sidecar-domain>/seed?admin_secret=<VP_ADMIN_SECRET>"
```

  This restores fresh RPG state (mental points, visibility) but keeps the Matrix
  wiring — no re-provisioning needed. It's also available to the `staff` login.

## Notes / limits

- The demo characters are fixed: `a` (Obfuscate 2), `b` (Auspex 2), `c` (no powers),
  `staff`. Multiple testers sharing a character will act as the same PC.
- Invisibility is roster-level, same trust model as the legacy site. Don't hand out
  the Synapse URL for use with a stock Element client — the native member list shows
  everyone. Registration on the homeserver is closed.
- `overlay.html` is a dev tool with an identity picker; under `VP_REQUIRE_AUTH=1` it
  is not usable — that's intentional.
- Redeploys are safe: state lives on the volumes; provisioning is skipped when the
  wiring already exists.
