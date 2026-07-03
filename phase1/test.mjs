import assert from "node:assert/strict";
import { seedState } from "./store.mjs";
import { activateObfuscate } from "./obfuscate.mjs";
import { useAuspex } from "./auspex.mjs";
import { visibleRosterForRoom } from "./roster.mjs";
import { handleMatrixSync, createMatrixEventState } from "./matrix-events.mjs";

const powersOf = (db, id) => db.character_powers.filter((power) => power.character_id === id).map((power) => power.power_code);
const ids = (db, viewer) => visibleRosterForRoom(db, viewer, "1").map((row) => row.id);

function log(db, event_type, actor_character_id, room_id, details = {}, target_character_id = null) {
  db.event_log.unshift({
    id: String(db.event_log.length + 1),
    event_type,
    actor_character_id,
    target_character_id,
    room_id,
    details,
    created_at: new Date().toISOString(),
  });
}

function runDemo(round) {
  // In-memory seed only: this test must never overwrite data.json.
  const db = seedState();
  const [a, b, c, staff] = db.characters;
  const room = db.rooms.find((row) => row.id === "1");
  room.matrix_room_id = "!elysium:local";

  assert.deepEqual(ids(db, a), ["a", "b", "c"], `round ${round}: A initial roster`);
  assert.deepEqual(ids(db, b), ["a", "b", "c"], `round ${round}: B initial roster`);
  assert.deepEqual(ids(db, c), ["a", "b", "c"], `round ${round}: C initial roster`);

  const obfuscated = activateObfuscate(db, a, powersOf(db, a.id));
  log(db, "obfuscate_on", a.id, obfuscated.room_id, { level: obfuscated.obfuscate_level });
  assert.match(obfuscated.message, /no longer seems to be there/, `round ${round}: obfuscate message`);
  assert.deepEqual(ids(db, b), ["b", "c"], `round ${round}: B cannot see A`);
  assert.deepEqual(ids(db, c), ["b", "c"], `round ${round}: C cannot see A`);
  assert.deepEqual(ids(db, a), ["a", "b", "c"], `round ${round}: A sees self while hidden`);
  assert.equal(visibleRosterForRoom(db, staff, "1").find((row) => row.id === "a").obfuscate_level, 2, `round ${round}: staff sees hidden level`);

  const auspex = useAuspex(db, b);
  assert.deepEqual(auspex.body.revealed, ["a"], `round ${round}: B reveals A`);
  assert.equal(visibleRosterForRoom(db, b, "1").find((row) => row.id === "a").revealed_by_auspex, true, `round ${round}: A marked revealed`);
  assert.deepEqual(ids(db, c), ["b", "c"], `round ${round}: C still cannot see A`);

  const sync = {
    next_batch: `round-${round}`,
    rooms: { join: { "!elysium:local": { timeline: { events: [
      { type: "m.room.message", event_id: `$${round}`, sender: a.matrix_user_id, content: { msgtype: "m.text", body: "I speak." } },
    ] } } } },
  };
  const result = handleMatrixSync(db, sync, { state: createMatrixEventState(), saveState: () => {} });
  assert.equal(result.broke_obfuscate, 1, `round ${round}: Matrix message breaks obfuscate`);
  assert.deepEqual(ids(db, c), ["a", "b", "c"], `round ${round}: A visible after speaking`);

  const events = db.event_log.map((event) => event.event_type);
  assert.equal(events.includes("obfuscate_on"), true, `round ${round}: obfuscate logged`);
  assert.equal(events.includes("auspex_attempt"), true, `round ${round}: auspex attempt logged`);
  assert.equal(events.includes("auspex_success"), true, `round ${round}: auspex success logged`);
  assert.equal(events.includes("message_broke_obfuscate"), true, `round ${round}: message break logged`);
}

runDemo(1);
runDemo(2);
console.log("phase1 Matrix-event demo test ok");
