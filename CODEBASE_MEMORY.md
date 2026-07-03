# Vampiri Pavia Codebase Memory

## Repository Layout

Root contains three historical versions:

- `sito Vampiripavia/` - canonical legacy version. This is the main PHP/MySQL app and the version to treat as the baseline unless a later feature is explicitly needed.
- `sito Vampiripavia 2019/` - later PHP variant with a redesigned chat flow, newer challenge/buff mechanics, SMS, and different UI files. Reference-only for now.
- `sito Vampiripavia 2020/` - packaged zip artifacts only: `client.zip`, `connection.zip`, `cgi-bin.zip`, `fonts.zip`, `forum.zip`.

Current file inventory:

- Total files: about 953.
- Canonical no-year tree: about 785 files.
- 2019 tree: about 162 files.
- 2020 tree: 5 zip files.
- Main extensions: PHP, JPG/GIF/PNG assets, SQL dumps, JS, CSS, XML notes.

## Canonical App Summary

The no-year system is a legacy PHP/MySQL play-by-chat application for a Vampire: The Masquerade-style RPG. It uses framesets, PHP sessions, raw `mysql_*` calls, and database-backed chat polling.

Main path:

- Login page: `sito Vampiripavia/CHAT/chat_login.php`
- Login handler: `sito Vampiripavia/CHAT/chat_db.php`
- Player chat frameset: `sito Vampiripavia/CHAT/chat.php`
- Master frameset: `sito Vampiripavia/CHAT/plancia.php`
- Shared library: `sito Vampiripavia/CHAT/chat_lib.php`
- DB connection: `sito Vampiripavia/CHAT/db_connect.php`
- Main SQL dump: `sito Vampiripavia/Sql162932_4.sql`

`db_connect.php` contains old live-looking database credentials. Do not reuse or publish them; rotate if this app ever touched a real reachable database.

## Runtime Model

The canonical app tracks active chat users in the `users` table, separate from permanent character records in `schede_elysium`.

Login flow:

1. `chat_login.php` posts credentials to `chat_db.php`.
2. `chat_db.php` validates `schede_elysium.username/password`.
3. It sets session keys:
   - `username`
   - `userID`
   - `trusted`
   - `current_room`
   - `auspex`
   - `obfuscate`
   - `accesslvl`
4. It inserts the active user into `users`.
5. It clears old Auspex reveal state.
6. It redirects to `chat.php`.

Player chat frames:

- `chat_location.php` - adjacent rooms and movement.
- `chat_main.php` - visible chat messages.
- `pannello.php` - character panel and XP ankh.
- `lista_utenti.php` - room user list.
- `chat_command.php` - message submission.

Messages are stored in `message` and polled/rendered in `chat_main.php`.

## Core Tables

From `Sql162932_4.sql`, important tables include:

- `schede_elysium` - permanent character sheet: username, password, traits, blood, will, mental/physical/social pools, XP, clan, status, notes, access level.
- `users` - currently connected users: character ID, name, room, last activity, Obfuscate state, IP.
- `message` - chat messages, whispers, room/system messages, master-level messages.
- `stanze` - rooms/locations.
- `percorsi` - room graph/adjacent movement.
- `permessi_stanze` - private room permissions by user or clan.
- `codici_potere` - power definitions. Key IDs:
  - `15` = `obf1`, Manto di ombre.
  - `16` = `obf2`, Svanire dall'occhio della mente.
  - `17` = `ott1`, Sudario della notte.
  - `18` = `ott2`, Braccia degli abissi.
  - `35` = `aus1`, Scrutare nelle Ombre.
  - `36` = `aus2`, Ascoltare il silenzio.
- `codici_disc_pg` - powers owned by characters.
- `auspex` - per-observer hidden-user reveals.
- `log_accessi` - login/access log.
- `log_combat` - combat/challenge log.
- `caccia`, `healing`, `torpore` - temporary unavailable states.
- `banca`, `inventario`, `schede_inv`, `schede_armi`, `armi` - resources/inventory/weapons.
- `missive`, `missive_dispatcher` - in-game mail.
- `help_*`, `news_*`, `bacheca_*` - content/news/forum-like structures.
- `master`, `comaster`, `notifiche_master` - staff/admin.

The schema is broad and game-specific; do not migrate all of it for a phase 1 chat prototype.

## Obfuscate And Auspex Legacy Behavior

Canonical files:

- `CHAT/obfuscate_in.php`
- `CHAT/obfuscate_out.php`
- `CHAT/auspex1.php`
- `CHAT/auspex2.php`
- `CHAT/lista_utenti.php`
- `CHAT/chat_command.php`
- `CHAT/chat_location.php`
- `CHAT/chat_main.php`
- `CHAT/challenge_lib.php`
- `CHAT/scheda.php`

Obfuscate:

- Stored as `users.obfuscate`.
- `0` means visible.
- `1` means hidden level 1.
- `2` means hidden level 2.
- Character must own `obf1`/`ott1` for level 1 or `obf2`/`ott2` for level 2.
- Character must have more than 1 mental point (`schede_elysium.men > 1`).
- Activation spends 1 mental point and sets `men_ts`.
- Level 1 cannot activate if another visible character is in the same room.
- Activation writes a public room message:
  - Oscurazione: character no longer seems there.
  - Ottenebramento: character is swallowed by shadows.
- Hidden characters remain in the room and keep reading messages.
- Speaking publicly in `chat_command.php` clears Obfuscate and clears Auspex state.
- Ringing a bell/knocking clears Obfuscate.
- Some challenge/combat effects call `obfuscate_off`.

User list:

- `lista_utenti.php` only returns visible users plus self:
  - visible if `obfuscate = 0`
  - self visible even if hidden
- It also appends users revealed via `auspex`.

Auspex:

- Auspex level is inferred from powers:
  - `35`/`aus1` = level 1.
  - `36`/`aus2` = level 2.
- `auspex1.php` searches hidden users in the current room.
- Level 1 sees `obfuscate = 1`.
- Level 2 sees `obfuscate IN (1,2)`.
- It performs a mental challenge using `challenge_lib.php::mentale`.
- Successful reveals are stored in `auspex(IDOsservatore, IDOmbra)`.
- Failure privately tells the observer they notice no invisible presence.
- Auspex cannot be used while obfuscated.
- `auspex2.php` sets `$_SESSION['auspex'] = 3`.
- In `chat_main.php`, `$_SESSION['auspex'] >= 2` reveals contents of third-party whispers; otherwise it only shows that one user talks with another.

Important migration point:

- Legacy "invisibility" is roster invisibility, not message invisibility. The hidden user remains present and can read room messages.

## XP Ankh Behavior

Canonical files:

- `CHAT/pannello.php`
- `CHAT/gainXP.php`

Behavior:

- `pannello.php` displays a hidden clickable ankh image after a timeout.
- `tempo_px` comes from `schede_elysium`.
- If `users.obfuscate` is 1 or 2, the delay is doubled.
- `gainXP.php` checks `delayXP` and active presence in `users`.
- If enough time has elapsed, it increments `schede_elysium.px_banca`.
- The old code contains a suspicious assignment in the delay check: `($_SESSION['userID']=8354)`. Treat this as a bug/cheat bypass if reviving the code.

## Challenge / Dice / Powers

Canonical files:

- `CHAT/challenge.php`
- `CHAT/calc_challenge.php`
- `CHAT/challenge_lib.php`
- `CHAT/challenge_sim.php`
- `CHAT/calc_challenge_sim.php`

Behavior:

- Challenges are PHP form-based.
- Core challenge helpers live in `challenge_lib.php`.
- `mentale($percsucc, $modperc, $stanza)` rolls `1..100`.
- `cFis` and `MenFis` apply damage/messages and can force targets out of Obfuscate.
- `calc_challenge.php` is large and contains discipline-specific effects.

Phase 1 migration should not port this entire system. Only the mental roll needed by Auspex is useful.

## Room / Movement Model

Canonical files:

- `CHAT/chat_location.php`
- `CHAT/mappa.php`
- `CHAT/mappa_master.php`
- `CHAT/gest_room*.php`

Tables:

- `stanze`
- `percorsi`
- `permessi_stanze`

Behavior:

- Rooms are numeric IDs.
- `percorsi` controls adjacent rooms.
- Private rooms use user/clan permissions.
- Moving rooms updates `users.stanza` and `users.entrata`.
- Movement clears Auspex observer state if visible.
- Movement clears being observed if hidden.
- Visible movement emits room messages; hidden movement does not.

## Character Sheet / Creation

Canonical files:

- `CHAT/scheda.php`
- `CHAT/scheda_master*.php`
- `CHAT/identita.php`
- `CHAT/comp_scheda_new.php`
- `CHAT/crea_pg*.php`
- `CHAT/lib/lib_crea_pg.php`

Character data mostly lives in `schede_elysium`, with extra tables for abilities, powers, rituals, inventory, weapons, resources, refuge, influence, and notes.

Obfuscate/Auspex buttons appear in `scheda.php` and are gated by owned power IDs.

## Admin / Staff Tools

Common areas:

- `plancia.php`, `plancia_login.php`, `plancia_comaster.php`
- `chat_main_master.php`, `chat_command_master.php`
- `listaUtenti.php`, `listaUtenticomaster.php`
- `log*.php`
- `gest_*.php`
- `notifica_master.php`

Staff can inspect users, logs, rooms, banners, notifications, weapons, stipends, and character sheets.

## Assets

Canonical asset folders:

- `CHAT/images/` - old UI images, clan art, buttons, maps, backgrounds.
- `CHAT/imgs/` - newer/login/header assets.
- `CHAT/stanza/` - room/location images.
- `CHAT/avatar/` - character avatars.
- `CHAT/script/` - old JavaScript helpers.
- `CHAT/help/` - help/news/bacheca PHP pages.

The UI is mostly table/frame-based with CSS in:

- `CHAT/stili.css`
- `CHAT/stili_scheda.css`

## 2019 Version Notes

The 2019 tree is a later PHP variant, not the baseline.

Notable differences:

- Chat frameset changed:
  - `chat2.php`
  - `chat_rightpanel.php`
  - `chat_main_cont.php`
  - `chat_location_cont.php`
  - `chat_main_stats.php`
- `chat_main.php` uses newer incremental message handling with `$_SESSION['lastiddisplayed']` and `$_SESSION['chatlog']`.
- It introduces/imports more complex discipline logic through `lib_discipline.php`.
- It uses `buff`/`debuff` concepts in runtime logic.
- Auspex-like whisper listening appears as buff-based behavior.
- It has a newer challenge flow:
  - `challenge_box.php`
  - `challenge_resolve.php`
  - `challenge_lib2.php`
- It has SMS-related files:
  - `sms.php`
  - `sms_master.php`
  - `sms_read.php`
- `chat_lib.php` in 2019 accepts plaintext or MD5 passwords, has many more helper functions, and references newer tables not necessarily present in the old dump.

Use 2019 only when a feature is missing in the baseline or when intentionally upgrading scope.

## 2020 Version Notes

The 2020 folder contains zip artifacts, not an expanded PHP app:

- `client.zip`
- `connection.zip`
- `cgi-bin.zip`
- `fonts.zip`
- `forum.zip`

Do not treat 2020 as implementation source until the zips are explicitly unpacked and reviewed.

## Security / Compatibility Risks

- Uses deprecated `mysql_*` API throughout.
- Heavy raw SQL string interpolation; SQL injection risk.
- Plaintext password support in canonical version.
- Old live-looking DB credentials are present in source.
- Old emails and notification addresses are hardcoded.
- Uses framesets and old browser assumptions.
- Uses `ereg_*`, magic quotes checks, and old PHP idioms.
- Some code has apparent bugs or legacy hacks, for example assignment in `gainXP.php` delay check.
- SQL dump contains real-looking user data, emails, notes, IPs, and content. Treat as sensitive.
- Static assets include a Windows `.exe` in `CHAT/PortraitProfessionalStudio.exe`; do not execute.

## Matrix / Element Migration Guidance

For a Phase 1 Element/Matrix implementation:

- Do not try to hide Matrix room membership at protocol level.
- Keep Matrix rooms for real chat transport.
- Implement RPG visibility as an overlay service.
- Use a custom Element widget/side panel for the game-visible roster.
- Map Matrix users to characters in a sidecar table.
- Port only these mechanics first:
  - active character/room mapping
  - Obfuscate state
  - Auspex reveal rows
  - mental-point spend
  - visible-character roster
  - simple staff/debug logs

The old behavior maps cleanly because legacy Obfuscate hides the user from the roster while they continue reading the room.

## Best Starting Points For Future Work

Read these first for the canonical app:

1. `CHAT/chat_db.php` - login/session setup.
2. `CHAT/chat.php` - player frameset.
3. `CHAT/chat_lib.php` - shared helpers.
4. `CHAT/lista_utenti.php` - visible roster.
5. `CHAT/chat_main.php` - message rendering.
6. `CHAT/chat_command.php` - message send behavior.
7. `CHAT/chat_location.php` - movement and room state.
8. `CHAT/obfuscate_in.php`, `CHAT/obfuscate_out.php` - invisibility.
9. `CHAT/auspex1.php`, `CHAT/auspex2.php` - reveal mechanics.
10. `Sql162932_4.sql` - schema.

Treat `sito Vampiripavia 2019/chat` as reference-only unless the task asks for the upgraded mechanics.

