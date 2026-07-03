# Phase 1 QA Audit — Obfuscate & Auspex vs. legacy (2026-07-03)

Independent verification of the Phase 1 deliverable against the legacy PHP source of truth
(`sito Vampiripavia/CHAT/`). Method: derived the intended behavior from the legacy files,
audited the phase1 modules line by line, ran every offline self-test plus the live
Synapse flow test, and fixed the bugs found (fixes listed in section 3).

**Verdict: the Phase 1 core meets the client brief.** Invisibility is roster-level hiding
(the hidden PC stays in the Matrix room and keeps reading), reveal is per-observer, level
gating and mental-point economics match the legacy, and the /sync watcher breaks obfuscate
when the hidden PC speaks — proven against a real Synapse. Four bugs were found and fixed,
the worst being the destructive self-tests that wiped `data.json`.

---

## 1. Rule-by-rule findings

### Obfuscate (legacy: `obfuscate_in.php`, `obfuscate_out.php`, `chat_command.php`)

| Legacy rule (evidence) | Phase 1 | Verdict |
|---|---|---|
| Per-user state; 0=visible, 1=hidden L1, 2=hidden L2 (`obfuscate_in.php:66`) | `room_presence[].obfuscate_level` (`obfuscate.mjs:58`) | ✅ |
| Powers 15/`obf1`, 17/`ott1` → L1; 16/`obf2`, 18/`ott2` → L2, higher wins (`obfuscate_in.php:34-35`, `Sql162932_4.sql:11590-11593`) | `obfuscateLevel()` checks L2 codes first (`obfuscate.mjs:18-23`) | ✅ |
| Requires mental > 1 (`obfuscate_in.php:59`) | reject if `<= 1` (`obfuscate.mjs:48`) | ✅ |
| Spends exactly 1 mental on success; rejected attempt spends nothing (`obfuscate_in.php:70`, spend inside success branch only) | spend after all guards (`obfuscate.mjs:59`); self-test asserts no spend on 409 | ✅ |
| L1 cannot activate if another visible PC is in the room; L2 can (`obfuscate_in.php:56-64`, `obfuscate=0 AND nome<>self AND stanza=current`) | `level === 1 && otherVisible` → 409 (`obfuscate.mjs:51-56`) | ✅ |
| Hidden PC stays in the room and keeps reading (legacy only filters the roster query) | roster-level only; no Matrix kick/leave anywhere in phase1; hidden PC's own roster still shows everyone (live test: "A roster while hidden") | ✅ |
| Flavor text: oscurazione → "non vi sembra più essere lì", ottenebramento → "inghiottito dalle ombre" (`obfuscate_in.php:78-85`) | `obfuscateMessage()` (`obfuscate.mjs:25-31`), ott wins when both — same as legacy | ✅ (but see gap G3: not broadcast) |
| Speaking publicly breaks obfuscate and clears auspex rows in both directions (`chat_command.php:38-42` → `clear_auspex`, `chat_lib.php:236-238`) | `/sync` watcher → `appearForPublicMessage` → `appear` → `clearAuspexReveals` both directions (`matrix-events.mjs:110`, `obfuscate.mjs:77-79`); proven live | ✅ |
| A visible speaker's message changes nothing (legacy clears only `if ($_SESSION['obfuscate'] != 0)`) | early return, `broke_obfuscate:false`, reveals untouched (`obfuscate.mjs:89-91`); self-test asserts | ✅ |
| Activation does NOT clear existing auspex reveals (`obfuscate_in.php` never touches the `auspex` table) | ❌ **was cleared both directions — FIXED** (bug B2) | ✅ after fix |
| Notice/edit messages don't count as speech | watcher skips `m.notice` and `m.replace` edits (`matrix-events.mjs:59-64`) | ✅ (reasonable Matrix mapping) |

### Auspex (legacy: `auspex1.php`, `auspex2.php`, `challenge_lib.php`, `lista_utenti.php`)

| Legacy rule (evidence) | Phase 1 | Verdict |
|---|---|---|
| Powers 35/`aus1` → L1, 36/`aus2` → L2 (`auspex1.php:35-36`, `Sql162932_4.sql:11610-11611`) | `AUSPEX_POWER_LEVELS` (`auspex.mjs:3-8`) | ✅ |
| Cannot be used while obfuscated (`auspex1.php:73`) | 409 before any spend (`auspex.mjs:139-141`) | ✅ |
| Requires mental > 1; rejected attempts spend nothing (`auspex1.php:73`) | guard at `auspex.mjs:143`; self-test asserts no spend | ✅ |
| Spends exactly 1 mental on any valid attempt — even when no shadows are present (`auspex1.php:77-79`, spend precedes the scan) | spend before target scan (`auspex.mjs:151`); self-test "failed scan spends mental" | ✅ |
| L1 reveals only hidden L1; L2 reveals L1 and L2 (`auspex1.php:49-55`) | `obfuscate_level > 0 && <= level` (`auspex.mjs:61-69`); self-test "level 1 cannot reveal level 2" | ✅ |
| Reveal is per-observer (`auspex` table `IDOsservatore`,`IDOmbra`; `lista_utenti.php:16-18` filters by observer) | `auspex_reveals` rows `{observer, hidden, room}`; roster filters by viewer (`roster.mjs:23-29`); live test: after B reveals A, C still can't see A | ✅ |
| Failure → private "Non noti nessuna presenza invisibile" to activator only (`auspex1.php:104-108`) | HTTP body to caller only: "No invisible presence noticed" (`auspex.mjs:156,185`) | ✅ |
| Per-shadow `mentale()` roll, chance = floor(men/(men+shadow_men)*100) (`auspex1.php:86-102`, `challenge_lib.php:73-85`) | ⚠️ deterministic by default (agreed Phase-1 shortcut); legacy roll now **wired in behind an opt-in** — `{ dice:true }` / `VP_AUSPEX_DICE=1` (`auspex.mjs:160-180`) | ⚠️ deliberate gap, opt-in available |

### Roster (legacy: `lista_utenti.php`, `listaUtenticomaster.php`)

| Legacy rule | Phase 1 | Verdict |
|---|---|---|
| Roster = visible (obfuscate=0) + self + Auspex-revealed, same room (`lista_utenti.php:12-18`) | `roster.mjs:31-58` (`!hidden || self || revealed_by_auspex || staff`) | ✅ |
| Staff sees all, hidden included (`listaUtenticomaster.php:17` selects everyone with the `obfuscate` flag) | `isStaff(viewer)` bypass (`roster.mjs:44`); hidden level exposed only to staff/self (`roster.mjs:54-55`) | ✅ |
| Hidden users styled differently for those who can see them (`lista_utenti.php:74-78` `utente_oscurato`) | `visible:false` / `revealed_by_auspex` flags; `chat.js:121` applies the styling | ✅ |

Tests (all pass after fixes): `obfuscate.mjs`, `auspex.mjs`, `roster.mjs`, `challenge.mjs`,
`extra.mjs`, `matrix-events.mjs`, `matrix-client.mjs`, `test.mjs`, `server.mjs --self-test`
(offline), and `test-matrix-flow.mjs` (LIVE against Synapse — real message from the hidden
PC broke obfuscate via the watcher). `data.json` checksum verified identical before/after
the full offline suite.

---

## 2. Bugs found and fixed

### B1 — `--self-test` and `test.mjs` wiped `data.json` (the known footgun, confirmed)
Reproduced: after `node server.mjs --self-test`, `data.json` went from 65 Matrix room
mappings + 4 access tokens to **0 and 0**. `node test.mjs` was worse: it left a single
*fake* mapping (`!elysium:local`) that the watcher would then try to sync.
Root cause: both called `resetSeed()` (write-through) and finished with `save(db)`.

Fix (`store.mjs`, `server.mjs`, `test.mjs`): new `seedState()` returns an in-memory
normalized copy of `seed.json` without writing; both tests now use it and no longer call
`save`. `resetSeed()` is unchanged but documented as destructive and reserved for explicit
re-provisioning (`setup-matrix.mjs`, `POST /seed`).
Proof: full suite re-run, `sha1sum data.json` identical before/after; mappings 65, tokens 4.

### B2 — Obfuscate activation cleared Auspex reveals (deviation from legacy)
`activateObfuscate` called `clearAuspexReveals(actor)` in both directions. Legacy
`obfuscate_in.php` never touches the `auspex` table on activation: a hidden PC who has been
revealed and re-casts (e.g. upgrades L1→L2) does **not** shake off the observer's reveal,
and an observer who obfuscates keeps their own reveals. Rows are only cleared when
obfuscation breaks (speaking / `obfuscate_out` → `clear_auspex`) or on movement.
Fix: removed the call (`obfuscate.mjs:58-62`); self-test updated to assert reveals survive
activation and are cleared when the obfuscation breaks.

### B3 — Watcher replayed room history on startup and could wrongly break obfuscate
The first `/sync` (no `since` cursor) returns recent timeline history. Dedup only
remembered events that *broke* obfuscate (`event_log.details.matrix_event_id`), so a
message sent while the PC was still **visible** was replayed after a server restart and
would break an obfuscation activated afterwards.
Fix (`matrix-events.mjs:163-170`): the first sync per token only primes the cursor and
processes nothing; incremental syncs behave as before. New async self-test covers
prime-then-process. Trade-off: a message sent while the sidecar was down no longer breaks
obfuscate retroactively — legacy had no such window (speak-and-clear was one request), and
staying hidden is the safer failure for the trust model.

### B4 — `normalize()` silently dropped unknown top-level keys on every save
`matrix-events.mjs` supports config in `db.matrix` (`matrixBaseUrl`/`matrixAccessTokens`
read `db.matrix?.base_url`, `db.matrix?.access_token`), but the `store.mjs` allowlist
stripped any such key on the first `save()`. Nothing in today's `data.json` was being lost
(all live state sits inside the 7 allowlisted tables), but the trap was armed.
Fix: `normalize()` now passes through unknown top-level keys and still forces the 7 tables
to arrays (`store.mjs:24-33`).

### Wired (opt-in): legacy `mentale()` dice roll for Auspex
Per the brief's invitation, `legacyMentalRoll` is now wired into `resolveAuspex` behind an
opt-in (`options.dice` or `VP_AUSPEX_DICE=1`), reproducing the legacy contest:
chance = `floor(men/(men+shadow_men)*100)` using the observer's mental **before** the
1-point spend (as legacy does), roll 1-100 per shadow, misses logged as `auspex_miss`, and
all-miss → the legacy private failure notice. Default remains deterministic — that was an
agreed Phase-1 shortcut and the demo/tests rely on it. Recommendation: keep deterministic
for Phase 1 demos; flip the env var when challenge stats are ported.
Note: legacy's "+2 for ottenebramento" branch (`auspex1.php:90-94`) is dead code — the
`switch` falls through and recomputes without the bonus — so it is intentionally not
reproduced.

---

## 3. Faithfulness gaps (deliberate vs. accidental)

Deliberate (agreed Phase-1 simplifications — confirmed, not bugs):
- **G1: Deterministic Auspex** instead of the `mentale()` roll. Now one flag away (see above).
- **G2: No mental-point recovery timer** (legacy `men_ts = now + 43200`, 12h). Points only
  go down; `seed.json` resets them. Fine for a demo, needed before real play.

Accidental deviations found (B2, B3 above — fixed).

Known/acceptable trust-model note:
- Invisibility is **roster-level**, exactly like the legacy (the hidden name simply never
  appears in the overlay roster another player receives). It is not Matrix-protocol-level:
  a player using a stock Element client instead of the overlay could still see room
  membership. That matches the brief's constraint ("roster-level, not Matrix-protocol");
  do not present it as cryptographic invisibility.

Minor notes (not fixed, low impact):
- **G3:** Legacy broadcasts the activation flavor line to the whole room
  (`obfuscate_in.php:88-89`, "X viene inghiottito dalle ombre" to `all`); phase1 returns it
  only to the activator (`chat.js:177` shows it as a status line). If you add the broadcast
  via `postRoomMessage`, send it as `m.notice` (or teach the watcher about `vp_system`) —
  otherwise the service-token message would itself be treated as speech; in the live test
  env the service token is character A's, and a plain `m.text` would instantly re-break A's
  own obfuscate.
- `POST /seed` (`server.mjs:152`) resets `data.json` with **no auth** — same destructive
  effect as the old footgun, one curl away. Fine for local demos; gate it before any
  shared deployment.
- `auspex.mjs` `visibleCharacters()` is dead code (the server uses `roster.mjs`) and, unlike
  `roster.mjs`, returns `mental_points` for every character to any observer. Harmless while
  unused; delete it or align it before anyone wires it up.
- Movement (`POST /rooms/:id/presence`, `server.mjs:208-210`) clears reveals in both
  directions; legacy `chat_location.php:21-28` clears directionally (visible mover: own
  observer rows; hidden mover: rows where they are the shadow). Phase1's version clears
  strictly more, never less — it can only end a reveal early, never leak a hidden PC — and
  phase1 reveals are room-scoped anyway. Left as is.
- Legacy DB credentials in `db_connect.php` were not reused or copied anywhere. A backup of
  the pre-audit live state is kept at `phase1/data.json.audit-backup` (contains tokens —
  local demo only; delete when no longer useful).
