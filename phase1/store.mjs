import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const tables = [
  "characters",
  "character_powers",
  "rooms",
  "room_presence",
  "auspex_reveals",
  "event_log",
  "missive",
];

// VP_DATA_PATH lets deployments point the live state at a persistent volume
// (e.g. /data/data.json on Railway) instead of the app directory.
export const dataPath = process.env.VP_DATA_PATH || join(root, "data.json");
export const seedPath = join(root, "seed.json");
// VP_ROSTER_PATH (default phase1/roster.json) is the deployment's real cast. When it
// exists, the characters/powers come from it instead of the built-in a/b/c/staff demo;
// the room map and every other table still come from seed.json. Absent → demo fallback,
// so local dev and the offline self-tests are unchanged.
export const rosterPath = process.env.VP_ROSTER_PATH || join(root, "roster.json");
export const eventLogLimit = 50;

let state;

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

// A blank, playable character sheet. Roster entries overlay their own fields (display
// name, clan, mental points, staff flag, powers, and any explicit sheet overrides) on
// top of this so the front-end always receives every field it renders.
const DEFAULT_SHEET = {
  clan: "",
  notes: "",
  status: "Neonato",
  citta: "",
  natura: "",
  gen: 8,
  umanita: 5,
  mental_points: 5,
  men_max: 5,
  fis: 3,
  fis_max: 5,
  soc: 3,
  soc_max: 5,
  blood: 8,
  bloodmax: 10,
  will: 5,
  willmax: 7,
  beast: 0,
  salute: "Illeso",
  px_banca: 0,
  px_spesi: 0,
  tempo_px: 60,
  delayXP: 0,
  abilita: [],
  disciplines: {},
  note: "",
  danni: 0,
  fva: 0,
  fva_ts: 0,
  caccia_ts: 0,
  banca: { entrate: 0, uscite: 0, spesi: 0, time: 0 },
  inventario: [],
};

// Fields a roster entry may set directly on the sheet (everything except identity, which
// is derived, and `powers`, which becomes rows in character_powers).
const ROSTER_SHEET_FIELDS = [
  "clan", "notes", "status", "citta", "natura", "gen", "umanita",
  "mental_points", "men_max", "fis", "fis_max", "soc", "soc_max",
  "blood", "bloodmax", "will", "willmax", "beast", "salute",
  "px_banca", "px_spesi", "tempo_px", "abilita", "disciplines", "note",
  "legacy_user_id",
];

export function rosterConfigured() {
  return existsSync(rosterPath);
}

// Parse and validate roster.json. Throws with a clear message on malformed input so a
// bad cast file fails provisioning loudly instead of silently shipping an empty game.
export function loadRoster(path = rosterPath) {
  const raw = readJson(path);
  const entries = Array.isArray(raw) ? raw : raw?.characters;
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error(`${path}: expected a non-empty array of characters (or { "characters": [...] })`);
  }
  const seen = new Set();
  const normalized = entries.map((entry, index) => {
    const username = String(entry?.username ?? entry?.id ?? "").trim();
    if (!/^[a-z0-9._=\-/]+$/.test(username)) {
      throw new Error(`roster[${index}]: "username" is required and must be a valid Matrix localpart (lowercase letters, digits, . _ = - /)`);
    }
    if (seen.has(username)) throw new Error(`roster: duplicate username "${username}"`);
    seen.add(username);
    const powers = Array.isArray(entry.powers) ? entry.powers.map((code) => String(code)) : [];
    return {
      username,
      display_name: String(entry.display_name || username),
      is_staff: Boolean(entry.is_staff),
      powers,
      password: entry.password ? String(entry.password) : "",
      sheet: Object.fromEntries(ROSTER_SHEET_FIELDS.filter((key) => key in entry).map((key) => [key, entry[key]])),
    };
  });
  return normalized;
}

// Build the characters + character_powers tables from a validated roster, overlaying each
// entry on DEFAULT_SHEET. Other tables (rooms, presence, reveals, log, missive) are kept
// from the seed so the room map/graph is preserved.
function buildFromRoster(seed, roster) {
  const serverName = process.env.MATRIX_SERVER_NAME || "local";
  const characters = roster.map((entry) => ({
    ...DEFAULT_SHEET,
    id: entry.username,
    matrix_user_id: `@${entry.username}:${serverName}`,
    access_token: "",
    display_name: entry.display_name,
    is_staff: entry.is_staff,
    ...entry.sheet,
    // men_max defaults to the starting mental points unless the entry set it explicitly.
    men_max: entry.sheet.men_max ?? entry.sheet.mental_points ?? DEFAULT_SHEET.mental_points,
  }));
  const character_powers = roster.flatMap((entry) =>
    entry.powers.map((power_code) => ({ character_id: entry.username, power_code })),
  );
  return { ...seed, characters, character_powers };
}

function normalize(input) {
  // Preserve unknown top-level keys (e.g. a `matrix` config block read by matrix-events.mjs)
  // instead of silently dropping them on every save.
  const extras = Object.fromEntries(Object.entries(input || {}).filter(([key]) => !tables.includes(key)));
  return {
    ...extras,
    ...Object.fromEntries(tables.map((table) => [table, Array.isArray(input?.[table]) ? input[table] : []])),
  };
}

function nextEventId(events) {
  const max = events.reduce((id, event) => Math.max(id, Number(event.id) || 0), 0);
  return String(max + 1);
}

export function getState() {
  // Before provisioning writes data.json, fall back to the seed — via seedState() so the
  // roster cast (not the raw demo seed) is used when roster.json is present.
  state ??= existsSync(dataPath) ? normalize(readJson(dataPath)) : seedState();
  return state;
}

export function save(nextState = state) {
  state = normalize(nextState);
  // VP_DATA_PATH may point into a directory that doesn't exist yet (e.g. a volume
  // mount path on a plan without volumes) — create it instead of failing every save.
  mkdirSync(dirname(dataPath), { recursive: true });
  writeFileSync(dataPath, `${JSON.stringify(state, null, 2)}\n`);
  return state;
}

// In-memory copy of the seed: safe for tests — never touches data.json.
// When roster.json exists the cast (characters + powers) is built from it; the room map
// and all other tables still come from seed.json. No roster → the a/b/c/staff demo seed.
export function seedState() {
  const seed = readJson(seedPath);
  if (!rosterConfigured()) return normalize(seed);
  return normalize(buildFromRoster(seed, loadRoster()));
}

// Destructive: overwrites data.json (drops Matrix room mappings and tokens). Only for
// explicit re-provisioning (setup-matrix.mjs) — never call from tests.
export function resetSeed() {
  state = seedState();
  return save(state);
}

// Demo reset: fresh RPG state (mental points, obfuscate, reveals, events) while keeping the
// provisioned Matrix identities, tokens, and room mappings. Used by POST /seed.
export function reseedKeepingMatrix() {
  const current = getState();
  const fresh = seedState();
  for (const character of fresh.characters) {
    const previous = current.characters.find((row) => row.id === character.id);
    if (!previous) continue;
    character.matrix_user_id = previous.matrix_user_id ?? character.matrix_user_id;
    character.access_token = previous.access_token ?? character.access_token;
  }
  for (const room of fresh.rooms) {
    const previous = current.rooms.find((row) => row.id === room.id);
    if (previous?.matrix_room_id) room.matrix_room_id = previous.matrix_room_id;
  }
  return save(fresh);
}

export function appendEventLog(entry, limit = eventLogLimit) {
  if (!entry?.event_type) throw new Error("event_type is required");

  const db = getState();
  const event = {
    id: entry.id ?? nextEventId(db.event_log),
    event_type: entry.event_type,
    actor_character_id: entry.actor_character_id ?? null,
    target_character_id: entry.target_character_id ?? null,
    room_id: entry.room_id ?? null,
    details: entry.details ?? {},
    created_at: entry.created_at ?? new Date().toISOString(),
  };

  db.event_log.unshift(event);
  db.event_log = db.event_log.slice(0, limit);
  save(db);
  return event;
}
