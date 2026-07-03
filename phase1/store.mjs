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
export const eventLogLimit = 50;

let state;

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

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
  state ??= normalize(readJson(existsSync(dataPath) ? dataPath : seedPath));
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
export function seedState() {
  return normalize(readJson(seedPath));
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
