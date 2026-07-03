# Phase 1 Validation Report

Validated on 2026-06-27 against local Synapse, Element Web, and the Phase 1 sidecar.

## Executive Summary

Overall completion: 100% of Phase 1 functional scope implemented and validated for the RPG overlay roster and real Matrix room-event integration.

Architecture status: implemented. Synapse and Element run locally through Docker Compose, the sidecar serves the Element-compatible overlay, Matrix users and rooms are provisioned by `setup-matrix.mjs`, and Matrix `m.room.message` events are consumed through `/sync`.

Validation status: passed for the complete Obfuscate, Auspex, staff-log, and public-message-break flow using real local Matrix users, real Matrix rooms, real access tokens, and a real Synapse message event. Three full Element browser sessions were not fully automated because the available headless browser capture produced a blank Element login screenshot; manual Element steps are listed below.

Remaining work: production hardening only. No Phase 1 behavior is intentionally left unimplemented.

Important boundary: Obfuscate hides the RPG overlay roster, not Matrix-native room membership. Element's native member list remains visible by design for this Phase 1 legacy-behavior port.

## Validation Matrix

| Test | Expected | Actual | Pass/Fail |
|---|---|---|---|
| Synapse starts | Local homeserver available on `localhost:8008` | Docker reports `matrix-synapse-1` healthy on port 8008 | Pass |
| Element starts | Element Web available on `localhost:8080` | Docker reports `matrix-element-1` healthy on port 8080 | Pass |
| User provisioning | `@a:local`, `@b:local`, `@c:local`, `@staff:local` exist | `setup-matrix.mjs` provisioned all four with valid Matrix tokens | Pass |
| Room provisioning | Required Matrix room(s) exist and are joined | `elysium` and `strada` have real Matrix room IDs; all four users joined | Pass |
| Sidecar starts | Overlay API available on `localhost:8787` | `/health` returns OK and sidecar process is listening | Pass |
| Matrix watcher | `/sync` watcher running against Synapse | `/matrix/status` reports `configured: true`, `running: true`, and no error | Pass |
| Demo HTTP message hook removed | Public message break comes from Matrix events | No `/messages/public` route; watcher handles `m.room.message` | Pass |
| Scenario 1: A activates Obfuscate | A hidden from other overlay rosters | B/C roster becomes `["b","c"]`; A still sees self | Pass |
| Scenario 1: A receives room messages | A remains a Matrix room member | No Matrix membership changes occur; A token remains valid and joined | Pass |
| Scenario 1: A sends messages | A can send public Matrix message while hidden | `test-matrix-flow.mjs` sends a real Matrix message as A | Pass |
| Scenario 1: staff notification | Staff sees Obfuscate event | Staff event log records `obfuscate_on` | Pass |
| Scenario 2: B joins/observes | B cannot see hidden A | B roster excludes A before Auspex | Pass |
| Scenario 3: B activates Auspex | B sees A only for B | B roster includes A with `revealed_by_auspex`; C still sees `["b","c"]` | Pass |
| Scenario 4: A sends public message | Obfuscate breaks automatically | Matrix watcher records `message_broke_obfuscate` with Matrix event ID | Pass |
| Scenario 4: everyone sees A | A visible after public message | A/B/C rosters all become `["a","b","c"]` | Pass |
| Scenario 5: observer-specific visibility | Auspex reveal does not corrupt C roster | Reveal state is keyed by observer, hidden character, and room; C remains blind | Pass |
| Duplicate events | Same Matrix event not processed twice | `matrix-events.mjs` dedupes by event ID and event log | Pass |
| Non-hidden public messages | Visible speaker does not clear reveal state | `appearForPublicMessage()` now no-ops unless the actor is hidden | Pass |
| Staff access control | Staff log is staff-only | `/staff/events` returns 403 for non-staff actor | Pass |
| Console/server crashes | Validation scripts complete without server crash | All listed Node self-tests and live Matrix flow passed | Pass |
| Matrix sync failures | No sync failure during validation | `/matrix/status` reports `error: null` | Pass |
| Element UI visual check | Login and room visible in Element browser | Element service is healthy; automated screenshot was blank in headless capture | Manual check required |

## Evidence

Commands run successfully:

```powershell
node .\phase1\obfuscate.mjs
node .\phase1\matrix-client.mjs
node .\phase1\matrix-events.mjs
node .\phase1\setup-matrix.mjs --self-test
node .\phase1\server.mjs --self-test
node .\phase1\test.mjs
node .\phase1\test-matrix-flow.mjs
```

Live services:

```text
matrix-synapse-1   healthy   localhost:8008
matrix-element-1   healthy   localhost:8080
sidecar            running   localhost:8787
```

Current real Matrix mappings:

```text
@a:local
@b:local
@c:local
@staff:local
elysium -> !CCDMVgJSGwtpYDeqAA:local
strada  -> !lUUUSTIPQlDMAXAxZW:local
```

The runtime state contains access tokens and Synapse secrets exist under `phase1/matrix/synapse-data`; those values are intentionally not included in this report.

## Screenshots

Usable overlay validation screenshots:

- `phase1/screenshots/overlay-a-initial.png`: A initial roster.
- `phase1/screenshots/overlay-b-initial.png`: B initial roster and Auspex control.
- `phase1/screenshots/staff-hidden.png`: staff visibility and staff event log while A is hidden.
- `phase1/screenshots/auspex-b-reveal.png`: B sees A after Auspex.
- `phase1/screenshots/auspex-c-blind.png`: C still cannot see A.
- `phase1/screenshots/message-break-c-visible.png`: C sees A after the public Matrix message breaks Obfuscate.
- `phase1/screenshots/staff-notifications.png`: staff log includes Obfuscate, Auspex, and message-break events.

Do not use:

- `phase1/screenshots/element-login.png`: blank headless capture.
- `phase1/screenshots/overlay-a.png` and `phase1/screenshots/overlay-b.png`: older cropped captures.

Manual Element screenshot steps:

1. Open `http://localhost:8080`.
2. Log in as `@a:local` with the local validation password.
3. Join `#elysium:local`.
4. Add or open the overlay URL as a custom widget or side panel.
5. Repeat in separate browser profiles for `@b:local`, `@c:local`, and `@staff:local`.
6. Capture Element login, Element room chat, widget/overlay, and staff log screenshots.

## Architecture

Matrix:

Synapse is the local Matrix homeserver. It stores users, rooms, membership, and chat events. Element Web connects to Synapse for real Matrix login and room chat.

Sidecar:

`server.mjs` exposes the local overlay API, serves `overlay.html`, maintains Phase 1 JSON state, and starts the Matrix sync watcher. It does not replace Matrix chat.

Overlay:

`overlay.html` is a widget-compatible iframe/side panel. It sends the active Matrix user id to the sidecar and renders the RPG roster, powers, and staff log.

Event flow:

1. A sends a public Matrix message in the mapped Matrix room.
2. `matrix-events.mjs` polls Synapse `/sync`.
3. The watcher filters mapped rooms and public `m.room.message` events.
4. If the sender maps to an obfuscated Phase 1 character in that room, `appearForPublicMessage()` breaks Obfuscate.
5. The sidecar persists the new visibility state and logs `message_broke_obfuscate` for staff.

## Production Readiness

Implemented:

- Local Synapse and Element Docker stack.
- Matrix provisioning for A, B, C, staff, Elysium, and Strada.
- Real Matrix IDs and room IDs in runtime state after setup.
- Element-compatible overlay URL.
- Obfuscate activation and Appear.
- Auspex reveal scoped to observer and room.
- Staff event log.
- Matrix `/sync` event watcher.
- Public Matrix message auto-break for Obfuscate.
- Duplicate Matrix event protection.
- Automated local and real Matrix validation.

Partially implemented:

- Element widget registration is documented as a manual custom-widget/side-panel step. There is no automated Element account-setting injection.
- Browser-session validation is manual. Automated validation uses real Matrix Client-Server APIs plus the sidecar API.
- Staff notifications are sidecar staff-log entries, not Matrix-native push or DM notifications.

Not implemented, production scope only:

- Matrix token validation for sidecar API calls.
- Production database persistence.
- Monitoring, alerting, and structured logs.
- Recovery/replay strategy for watcher downtime.
- Deployment manifests beyond local Docker Compose.
- Security review, rate limiting, and secret management.
- Performance and load testing.
- Matrix-native membership hiding, which is outside Phase 1 scope.

## Commands Required To Run

```powershell
cd .\phase1\matrix
docker compose run --rm synapse generate
docker compose up -d

cd ..\..
$secretLine = Select-String -Path .\phase1\matrix\synapse-data\homeserver.yaml -Pattern '^registration_shared_secret:' | Select-Object -First 1
$secret = ($secretLine.Line -replace '^registration_shared_secret:\s*','').Trim().Trim('"')
$env:SYNAPSE_REGISTRATION_SHARED_SECRET=$secret
$env:MATRIX_PASSWORD='vp-demo-password'
node .\phase1\setup-matrix.mjs

$env:MATRIX_BASE_URL='http://localhost:8008'
$env:MATRIX_SYNC_POLL_MS='500'
node .\phase1\server.mjs
```

## Demo Steps

1. Open Element at `http://localhost:8080`.
2. Log in as `@a:local`, join `#elysium:local`, and open `http://localhost:8787/overlay.html?matrix_user_id=@a:local&room_id=elysium`.
3. Repeat in separate browser profiles for `@b:local`, `@c:local`, and `@staff:local`.
4. In A overlay, click `Obfuscate`.
5. Confirm B and C no longer see A in the overlay roster.
6. Confirm staff sees A with hidden state and an `obfuscate_on` event.
7. In B overlay, click `Auspex`.
8. Confirm B sees A with the Auspex tag and C still cannot see A.
9. Send a public message from A in the Element room.
10. Confirm A is visible again to A, B, and C.
11. Confirm staff log includes `message_broke_obfuscate`.

## Final Directory Tree

```text
phase1/
  README.md
  REAL-INTEGRATION.md
  VALIDATION-REPORT.md
  auspex.mjs
  data.json
  element-widget.md
  matrix-client.mjs
  matrix-events.mjs
  obfuscate.mjs
  overlay.html
  roster.mjs
  seed.json
  server-integration-notes.md
  server.mjs
  setup-matrix.mjs
  store.mjs
  test-matrix-flow.mjs
  test.mjs
  matrix/
    README.md
    docker-compose.yml
    element-config.json
    synapse-data/
  screenshots/
    auspex-b-reveal.png
    auspex-c-blind.png
    element-login.png
    message-break-c-visible.png
    obfuscate-b-roster.png
    overlay-a-initial.png
    overlay-a.png
    overlay-b-initial.png
    overlay-b.png
    staff-hidden.png
    staff-notifications.png
```

`data.json` and `matrix/synapse-data/` are generated local runtime artifacts and contain secrets or tokens.
