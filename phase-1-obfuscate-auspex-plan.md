# Phase 1: Matrix/Element Obfuscate + Auspex Delivery Plan

## Purpose

Deliver a first working Matrix/Element-based package that preserves the core legacy behavior from the canonical no-year PHP system:

- Obfuscate hides a character from the game-visible room roster.
- The hidden character remains joined to the Matrix room and can still read messages.
- Auspex reveals hidden characters to the activating character.
- Speaking while hidden makes the character visible again.
- Staff/debug logs show the state changes.

This is an RPG overlay on top of Matrix/Element, not a Matrix protocol rewrite.

## Source Of Truth

Use `sito Vampiripavia/` as the canonical legacy source.

Use these files as direct references:

- `sito Vampiripavia/CHAT/chat_db.php` - login/session setup.
- `sito Vampiripavia/CHAT/chat.php` - player frameset.
- `sito Vampiripavia/CHAT/chat_lib.php` - shared helpers.
- `sito Vampiripavia/CHAT/lista_utenti.php` - visible roster.
- `sito Vampiripavia/CHAT/chat_main.php` - message rendering.
- `sito Vampiripavia/CHAT/chat_command.php` - message-send behavior.
- `sito Vampiripavia/CHAT/chat_location.php` - movement and room state.
- `sito Vampiripavia/CHAT/obfuscate_in.php` - Obfuscate activation.
- `sito Vampiripavia/CHAT/obfuscate_out.php` - Obfuscate exit.
- `sito Vampiripavia/CHAT/auspex1.php` - per-observer hidden reveal.
- `sito Vampiripavia/CHAT/auspex2.php` - stronger Auspex/whisper perception.
- `sito Vampiripavia/CHAT/challenge_lib.php` - mental roll helper.
- `sito Vampiripavia/CHAT/scheda.php` - old UI buttons.
- `sito Vampiripavia/Sql162932_4.sql` - schema and power IDs.

Treat `sito Vampiripavia 2019/` as reference-only. It adds a more complex buff/debuff and redesigned chat flow; do not pull it into Phase 1 unless explicitly needed.

Treat `sito Vampiripavia 2020/` as unopened zip artifacts; do not use it for Phase 1.

## Legacy Behavior To Preserve

### Obfuscate

- Legacy state: `users.obfuscate`.
- `0` = visible.
- `1` = hidden level 1.
- `2` = hidden level 2.
- Level 1 powers:
  - `15` / `obf1` / Manto di ombre.
  - `17` / `ott1` / Sudario della notte.
- Level 2 powers:
  - `16` / `obf2` / Svanire dall'occhio della mente.
  - `18` / `ott2` / Braccia degli abissi.
- Activation requires `schede_elysium.men > 1`.
- Activation spends 1 mental point.
- Activation sets a mental recovery timestamp in the legacy system; Phase 1 can log the spend and leave full recovery out.
- Level 1 cannot activate if another visible character is in the same room.
- Level 2 can activate even if others are present.
- Obfuscated characters are hidden from other players' visible roster.
- Obfuscated characters still read room messages.
- Self remains visible to self.
- Staff can see all states.
- Speaking publicly breaks Obfuscate.
- Ringing/knocking breaks Obfuscate in the legacy system; Phase 1 can skip unless movement/door UI exists.

### Auspex

- Level 1 power:
  - `35` / `aus1` / Scrutare nelle Ombre.
- Level 2 power:
  - `36` / `aus2` / Ascoltare il silenzio.
- Legacy reveal state: `auspex(IDOsservatore, IDOmbra)`.
- Auspex cannot be used by an obfuscated character.
- Auspex requires `men > 1`.
- Auspex spends 1 mental point.
- Auspex level 1 reveals hidden level 1 targets.
- Auspex level 2 reveals hidden level 1 and 2 targets.
- Successful reveals are per-observer, not global.
- Failure privately tells the activator that no invisible presence was noticed.
- Legacy `auspex2.php` also enables better third-party whisper perception. Phase 1 can defer this unless time remains.

### Message Visibility

- Legacy invisibility is roster invisibility, not message invisibility.
- Hidden users remain in the room and can read messages.
- Public speaking clears hidden state in `chat_command.php`.
- This maps cleanly to Matrix: keep Matrix room membership normal, and hide/show only the RPG roster.

## Phase 1 Architecture

### Keep

- Matrix/Synapse as message transport.
- Element Web as the visible chat client.
- A small RPG overlay service for character state and visibility.
- A custom side panel/widget for the game-visible roster and power buttons.

### Do Not Do

- Do not fork Matrix protocol.
- Do not try to hide `m.room.member` membership events.
- Do not migrate all legacy tables.
- Do not port the full dice/challenge system.
- Do not port XP ankh, SMS, mail, inventory, banking, hunting, healing, torpore, or full character-sheet editing.

## Minimal Data Model

Use the smallest sidecar schema that matches the legacy behavior.

### `characters`

Maps legacy `schede_elysium` and Matrix users.

Fields:

- `id`
- `matrix_user_id`
- `display_name`
- `mental_points`
- `is_staff`

Optional Phase 1 seed fields:

- `legacy_user_id`
- `clan`
- `notes`

### `character_powers`

Maps legacy `codici_disc_pg` and `codici_potere`.

Fields:

- `character_id`
- `power_code`

Seed with:

- `obf1`
- `obf2`
- `ott1`
- `ott2`
- `aus1`
- `aus2`

### `rooms`

Maps legacy `stanze` to Matrix rooms.

Fields:

- `id`
- `matrix_room_id`
- `name`

Phase 1 can create only 2-3 rooms manually.

### `room_presence`

Replaces legacy active `users` table for the overlay.

Fields:

- `character_id`
- `room_id`
- `obfuscate_level`
- `last_seen_at`

### `auspex_reveals`

Replaces legacy `auspex`.

Fields:

- `observer_character_id`
- `hidden_character_id`
- `room_id`
- `created_at`

### `event_log`

Minimal staff/debug log.

Fields:

- `id`
- `event_type`
- `actor_character_id`
- `target_character_id`
- `room_id`
- `details`
- `created_at`

Event types:

- `obfuscate_on`
- `obfuscate_off`
- `auspex_attempt`
- `auspex_success`
- `auspex_fail`
- `message_broke_obfuscate`

## Subtasks

### 1. Matrix/Element Baseline

- Run Synapse locally or on staging.
- Run Element Web against Synapse.
- Create 2-3 Matrix rooms.
- Create 3 Matrix users:
  - A: normal visible character.
  - B: character with `aus1` or `aus2`.
  - C: character with `obf1` or `obf2`.
- Confirm all users can join the same Matrix room and exchange messages.

Done when chat works in Element without RPG features.

### 2. Overlay Service Skeleton

- Create the sidecar service.
- Add a health endpoint.
- Add the minimal schema above.
- Seed test characters, powers, and rooms.
- Map each Matrix user ID to exactly one active character.

Done when the service can answer: "who is this Matrix user as a character?"

### 3. Overlay Room Presence

- Add endpoint to join/mark current game room:
  - `POST /rooms/:room_id/presence`
- Store/update `room_presence`.
- Keep this independent from Matrix membership.

Done when the overlay knows A, B, and C are in the same game room.

### 4. Visible Roster Endpoint

- Add:
  - `GET /rooms/:room_id/visible-characters`
- Return:
  - all characters where `obfuscate_level = 0`
  - the current user's own character
  - hidden characters revealed to current user through `auspex_reveals`
  - all characters for staff users
- Include state fields:
  - `visible`
  - `self`
  - `revealed_by_auspex`
  - `obfuscate_level` for staff/self only

Done when the backend can return different rosters for A, B, C, and staff.

### 5. Obfuscate Endpoint

- Add:
  - `POST /obfuscate`
- Determine level:
  - level 2 if user has `obf2` or `ott2`
  - else level 1 if user has `obf1` or `ott1`
  - else reject
- Validate:
  - `mental_points > 1`
  - character is in a room
  - level 1 has no other visible characters in same room
- Update:
  - set `room_presence.obfuscate_level`
  - decrement `characters.mental_points`
  - delete old reveals where this character is observer or hidden target if needed
  - write `event_log`
- Send or display activation text:
  - `obf*`: `[name] no longer seems to be there`
  - `ott*`: `[name] is swallowed by shadows`

Done when C disappears from A's roster while still reading the Matrix room.

### 6. Appear Endpoint

- Add:
  - `POST /appear`
- Update:
  - set `obfuscate_level = 0`
  - delete reveals where character is observer or hidden target
  - write `event_log`

Done when C becomes visible again to everyone.

### 7. Auspex Endpoint

- Add:
  - `POST /auspex`
- Determine level:
  - level 2 if user has `aus2`
  - else level 1 if user has `aus1`
  - else reject
- Validate:
  - character is not obfuscated
  - `mental_points > 1`
  - character is in a room
- Find hidden targets in the same room:
  - level 1 can reveal `obfuscate_level = 1`
  - level 2 can reveal `obfuscate_level IN (1,2)`
- Use a minimal mental roll:
  - Phase 1 shortcut: deterministic success if target exists, unless a real roll is explicitly needed.
  - Optional legacy-style roll: `floor(observer_men / (observer_men + target_men) * 100)` then `1..100`.
- Store successful reveal rows in `auspex_reveals`.
- Decrement `mental_points`.
- Write success/failure log.
- Send private notice to activator.

Done when B can reveal C without making C visible to A.

### 8. Element UI Overlay

- Add a custom Element side panel/widget or minimal adjacent web panel.
- Display the overlay roster from `visible-characters`.
- Add controls:
  - `Obfuscate`
  - `Appear`
  - `Auspex`
- Hide controls if user lacks the needed power.
- Refresh roster after every action.
- Visually mark:
  - self
  - revealed hidden users
  - staff-only hidden status

Done when the demo can be run without direct API calls.

### 9. Message Breaks Obfuscate

- Detect when a hidden character sends a public Matrix message.
- Call the same logic as `/appear`.
- Write `message_broke_obfuscate` log.
- Refresh overlay roster.

Acceptable Phase 1 implementation:

- Poll recent Matrix events or hook the send button in the UI overlay.
- Use the simplest reliable option available in the implementation environment.

Done when C speaks and becomes visible.

### 10. Staff Debug View

- Add a simple log endpoint:
  - `GET /staff/events`
- Show last 50 events.
- Staff can see all hidden characters in roster.

Done when staff can verify Obfuscate/Auspex without database access.

### 11. Seed Demo Data

Create seed data equivalent to:

- A: no powers, `mental_points = 5`
- B: `aus1` or `aus2`, `mental_points = 5`
- C: `obf1` or `obf2`, `mental_points = 5`
- Room: "Elysium" mapped to a Matrix room

Optional second room:

- "Strada" or "Biblioteca" for movement later.

Done when the demo starts from a clean seed.

### 12. Demo Script

Run this sequence:

1. A, B, and C enter the same Matrix room.
2. Overlay roster shows A, B, C to everyone.
3. C uses Obfuscate.
4. A sees only A and B.
5. C still reads room messages.
6. B uses Auspex.
7. B sees C marked as revealed.
8. A still does not see C.
9. C sends a public message.
10. C becomes visible to A and B.
11. Staff log shows Obfuscate, Auspex, and message break events.

Done when the sequence works twice from a clean seed without manual DB edits.

## Acceptance Criteria

- Matrix/Element chat works with 3 test users.
- Overlay roster exists and can differ from Matrix membership.
- Obfuscate hides a character from non-revealing players.
- Hidden character still reads Matrix room messages.
- Auspex reveals hidden character per observer.
- Speaking while hidden makes the character visible.
- Staff/debug log records key actions.
- Known limitation is visible in the README/demo notes: Matrix membership itself is not hidden.

## Explicit Non-Goals

- True Matrix-native invisibility.
- Hiding Matrix protocol room membership or presence.
- Full Element fork.
- Mobile Element support.
- Production-grade anti-cheat.
- Full legacy dice/challenge system.
- Full Auspex whisper-reading behavior.
- XP clickable ankh system.
- Movement graph and private room permissions.
- Hunting, healing, torpore, inventory, banking, SMS, missives.
- Complete character-sheet migration.
- Using 2019 buff/debuff mechanics.
- Unpacking/rebuilding 2020 zip artifacts.

## Risks And Shortcuts

- Matrix membership remains visible to users who inspect the raw Matrix member list. Phase 1 hides only the game roster.
- If Element's default member panel is confusing, hide/de-emphasize it in the demo and use the RPG roster panel.
- The sidecar service is the source of truth for game visibility.
- Phase 1 can use deterministic Auspex success to save time. Add legacy dice when the demo loop is accepted.
- Mental recovery can be skipped in Phase 1. Add timed recovery when more powers are ported.
- Use fake/demo character data. Do not import the whole SQL dump unless needed.
- Do not reuse legacy DB credentials or sensitive user data.

## Phase 1 Deliverables

- Running Matrix/Element demo environment.
- Sidecar RPG state service.
- Minimal seed data.
- Overlay roster UI.
- Obfuscate, Appear, and Auspex actions.
- Staff/debug event log.
- Demo script and known limitations.

