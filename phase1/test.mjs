import assert from "node:assert/strict";
import { seedState } from "./store.mjs";
import { activateObfuscate } from "./obfuscate.mjs";
import { useAuspex, useAuspexListen } from "./auspex.mjs";
import { resolveChallenge } from "./challenge.mjs";
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
  // seed character A has Ottenebramento (ott2): legacy shadow flavour, in Italian
  assert.equal(obfuscated.message, "A viene inghiottito dalle ombre", `round ${round}: obfuscate message`);
  assert.deepEqual(ids(db, b), ["b", "c"], `round ${round}: B cannot see A`);
  assert.deepEqual(ids(db, c), ["b", "c"], `round ${round}: C cannot see A`);
  assert.deepEqual(ids(db, a), ["a", "b", "c"], `round ${round}: A sees self while hidden`);
  assert.equal(visibleRosterForRoom(db, staff, "1").find((row) => row.id === "a").obfuscate_level, 2, `round ${round}: staff sees hidden level`);

  const auspex = useAuspex(db, b);
  assert.deepEqual(auspex.body.revealed, ["a"], `round ${round}: B reveals A`);
  assert.equal(visibleRosterForRoom(db, b, "1").find((row) => row.id === "a").revealed_by_auspex, true, `round ${round}: A marked revealed`);
  assert.deepEqual(ids(db, c), ["b", "c"], `round ${round}: C still cannot see A`);

  const makeSync = (eventId, content) => ({
    next_batch: `round-${round}-${eventId}`,
    rooms: { join: { "!elysium:local": { timeline: { events: [
      { type: "m.room.message", event_id: eventId, sender: a.matrix_user_id, content },
    ] } } } },
  });

  // Whisper to the staff must NOT break the obfuscation (legacy wisperM=1 exception)...
  const staffWhisper = handleMatrixSync(db, makeSync(`$${round}-staff`, { msgtype: "m.text", body: "psst", vp_rcpt: staff.matrix_user_id }), {
    state: createMatrixEventState(),
    saveState: () => {},
  });
  assert.equal(staffWhisper.broke_obfuscate, 0, `round ${round}: staff whisper keeps obfuscate`);
  assert.deepEqual(ids(db, c), ["b", "c"], `round ${round}: A still hidden after staff whisper`);

  // ...while a whisper to another PC (or speaking) does, and announces the reappearance.
  const announced = [];
  const result = handleMatrixSync(db, makeSync(`$${round}`, { msgtype: "m.text", body: "I speak.", vp_rcpt: c.matrix_user_id }), {
    state: createMatrixEventState(),
    saveState: () => {},
    announce: (_db, roomId, text) => announced.push([roomId, text]),
  });
  assert.equal(result.broke_obfuscate, 1, `round ${round}: Matrix message breaks obfuscate`);
  assert.deepEqual(ids(db, c), ["a", "b", "c"], `round ${round}: A visible after speaking`);
  assert.deepEqual(announced, [["1", "A emerge dalle ombre"]], `round ${round}: reappearance announced`);

  // Attacking while obfuscated breaks the attacker's obfuscation, hit or miss (legacy).
  const again = activateObfuscate(db, a, powersOf(db, a.id));
  assert.equal(again.ok, true, `round ${round}: re-obfuscate for challenge`);
  const challenge = resolveChallenge(db, a, "c", "fisica");
  assert.equal(challenge.status, 200, `round ${round}: challenge resolves`);
  assert.equal(challenge.attacker_appear_message, "A emerge dalle ombre", `round ${round}: challenge announces attacker`);
  assert.deepEqual(ids(db, c), ["a", "b", "c"], `round ${round}: A visible after attacking`);

  // "Aguzza l'udito" (auspex2): only aus2, tracked as auspex_listen (whisper gate lives in chat.js).
  assert.equal(useAuspexListen(db, a.id).status, 403, `round ${round}: A cannot listen`);
  assert.equal(useAuspexListen(db, b.id).status, 200, `round ${round}: B listens`);
  assert.equal(db.characters[1].auspex_listen, true, `round ${round}: listen flag set`);

  const events = db.event_log.map((event) => event.event_type);
  assert.equal(events.includes("obfuscate_on"), true, `round ${round}: obfuscate logged`);
  assert.equal(events.includes("auspex_attempt"), true, `round ${round}: auspex attempt logged`);
  assert.equal(events.includes("auspex_success"), true, `round ${round}: auspex success logged`);
  assert.equal(events.includes("message_broke_obfuscate"), true, `round ${round}: message break logged`);
  assert.equal(events.includes("challenge_broke_obfuscate"), true, `round ${round}: challenge break logged`);
}

runDemo(1);
runDemo(2);
console.log("phase1 Matrix-event demo test ok");
