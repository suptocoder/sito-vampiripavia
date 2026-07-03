import { pathToFileURL } from "node:url";

const AUSPEX_POWER_LEVELS = new Map([
  ["aus1", 1],
  ["35", 1],
  ["aus2", 2],
  ["36", 2],
]);

const toPowerCode = (power) => String(power?.power_code ?? power?.ref_disc ?? power ?? "").toLowerCase();
const nowIso = () => new Date().toISOString();

export function determineAuspexLevel(powers = []) {
  return powers.reduce((level, power) => Math.max(level, AUSPEX_POWER_LEVELS.get(toPowerCode(power)) || 0), 0);
}

export const auspexLevel = determineAuspexLevel;

export function legacyMentalRoll(percentSuccess, modifierPercent = 0, roll = Math.random) {
  const adjusted = Math.floor(Number(percentSuccess) + (Number(percentSuccess) * Number(modifierPercent)) / 100);
  const value = typeof roll === "function" ? Math.floor(roll() * 100) + 1 : Number(roll);
  return value <= adjusted;
}

function characterById(db, characterOrId) {
  const id = typeof characterOrId === "object" ? characterOrId?.id : characterOrId;
  return db.characters?.find((character) => character.id === id) || (typeof characterOrId === "object" ? characterOrId : null);
}

function presenceOf(db, characterId) {
  return (db.room_presence || db.presence || []).find((presence) => presence.character_id === characterId) || null;
}

function powersOf(db, characterId) {
  return (db.character_powers || db.powers || []).filter((power) => power.character_id === characterId) || [];
}

function eventLog(db) {
  const key = db.event_log ? "event_log" : "events";
  if (!Array.isArray(db[key])) db[key] = [];
  return db[key];
}

function logEvent(db, event_type, actor_character_id, room_id, details = {}, target_character_id = null, now = nowIso) {
  const events = eventLog(db);
  const event = {
    id: String(events.length + 1),
    event_type,
    actor_character_id,
    target_character_id,
    room_id,
    details,
    created_at: now(),
  };
  events.unshift(event);
  if (db.event_log) db.event_log = events.slice(0, 50);
  else db.events = events.slice(0, 50);
  return event;
}

export function findAuspexTargets(db, actorCharacterId, roomId, level) {
  return (db.room_presence || db.presence || []).filter(
    (presence) =>
      presence.room_id === roomId &&
      presence.character_id !== actorCharacterId &&
      presence.obfuscate_level > 0 &&
      presence.obfuscate_level <= level,
  );
}

function rememberReveal(db, observerCharacterId, hiddenCharacterId, roomId, createdAt) {
  const key = db.auspex_reveals ? "auspex_reveals" : "reveals";
  if (!Array.isArray(db[key])) db[key] = [];
  const exists = db[key].some(
    (reveal) =>
      reveal.observer_character_id === observerCharacterId &&
      reveal.hidden_character_id === hiddenCharacterId &&
      reveal.room_id === roomId,
  );
  if (!exists) {
    db[key].push({
      observer_character_id: observerCharacterId,
      hidden_character_id: hiddenCharacterId,
      room_id: roomId,
      created_at: createdAt,
    });
  }
}

export function visibleCharacters(db, observerCharacterOrId, roomId) {
  const observer = characterById(db, observerCharacterOrId);
  if (!observer) return [];

  const revealed = new Set(
    (db.auspex_reveals || db.reveals || [])
      .filter((reveal) => reveal.observer_character_id === observer.id && reveal.room_id === roomId)
      .map((reveal) => reveal.hidden_character_id),
  );

  return (db.room_presence || db.presence || []).flatMap((presence) => {
    if (presence.room_id !== roomId) return [];
    const character = db.characters?.find((item) => item.id === presence.character_id);
    if (!character) return [];
    const self = character.id === observer.id;
    const revealed_by_auspex = revealed.has(character.id);
    if (presence.obfuscate_level > 0 && !self && !revealed_by_auspex && !observer.is_staff) return [];
    return [{
      id: character.id,
      display_name: character.display_name,
      matrix_user_id: character.matrix_user_id,
      mental_points: character.mental_points,
      visible: presence.obfuscate_level === 0,
      self,
      revealed_by_auspex,
      obfuscate_level: observer.is_staff || self ? presence.obfuscate_level : undefined,
    }];
  });
}

export function resolveAuspex(db, actorCharacterOrId, options = {}) {
  const actor = characterById(db, actorCharacterOrId);
  if (!actor) return { status: 404, body: { error: "character not found" } };

  const actorPresence = presenceOf(db, actor.id);
  const roomId = actorPresence?.room_id || null;
  const level = determineAuspexLevel(powersOf(db, actor.id));
  const now = options.now || nowIso;

  logEvent(db, "auspex_attempt", actor.id, roomId, { level }, null, now);

  if (!level) {
    logEvent(db, "auspex_fail", actor.id, roomId, { reason: "missing auspex power" }, null, now);
    return { status: 403, body: { error: "missing auspex power" } };
  }
  if (!actorPresence) {
    logEvent(db, "auspex_fail", actor.id, roomId, { reason: "character is not in a room", level }, null, now);
    return { status: 400, body: { error: "character is not in a room" } };
  }
  if (actorPresence.obfuscate_level > 0) {
    logEvent(db, "auspex_fail", actor.id, roomId, { reason: "cannot use auspex while obfuscated", level }, null, now);
    return { status: 409, body: { error: "cannot use auspex while obfuscated" } };
  }
  if (actor.mental_points <= 1) {
    logEvent(db, "auspex_fail", actor.id, roomId, { reason: "not enough mental points", level }, null, now);
    return { status: 400, body: { error: "not enough mental points" } };
  }

  // Legacy auspex1.php reads the observer's mental score BEFORE spending the point and uses
  // that value in the contest formula.
  const mentalBefore = actor.mental_points;
  actor.mental_points -= 1;
  const targets = findAuspexTargets(db, actor.id, roomId, level);

  if (!targets.length) {
    logEvent(db, "auspex_fail", actor.id, roomId, { reason: "no hidden targets", level }, null, now);
    return { status: 200, body: { message: "No invisible presence noticed", revealed: [] } };
  }

  // Phase 1 default is deterministic (agreed simplification). Pass { dice: true } or set
  // VP_AUSPEX_DICE=1 to use the legacy mentale() contest: per shadow,
  // chance = floor(men / (men + shadow_men) * 100), roll 1-100 must be <= chance.
  // (Legacy's "+2 for ottenebramento" branch is dead code — switch fall-through — so it is
  // intentionally not reproduced.)
  const dice = options.dice ?? process.env.VP_AUSPEX_DICE === "1";
  const roll = options.roll || Math.random;

  const createdAt = now();
  const revealed = [];
  for (const target of targets) {
    if (dice) {
      const shadow = characterById(db, target.character_id);
      const shadowMental = Number(shadow?.mental_points ?? shadow?.men ?? 0);
      const chance = Math.floor((mentalBefore / (mentalBefore + shadowMental)) * 100);
      if (!legacyMentalRoll(chance, 0, roll)) {
        logEvent(db, "auspex_miss", actor.id, roomId, { level, chance }, target.character_id, now);
        continue;
      }
    }
    rememberReveal(db, actor.id, target.character_id, roomId, createdAt);
    logEvent(db, "auspex_success", actor.id, roomId, { level }, target.character_id, now);
    revealed.push(target.character_id);
  }

  if (!revealed.length) {
    return { status: 200, body: { message: "No invisible presence noticed", revealed: [] } };
  }

  return {
    status: 200,
    body: {
      message: "You notice a presence that escaped you",
      revealed,
    },
  };
}

export const useAuspex = resolveAuspex;

function testDb() {
  return {
    characters: [
      { id: "a", matrix_user_id: "@a:local", display_name: "A", mental_points: 3, is_staff: false },
      { id: "b", matrix_user_id: "@b:local", display_name: "B", mental_points: 3, is_staff: false },
      { id: "c", matrix_user_id: "@c:local", display_name: "C", mental_points: 3, is_staff: false },
      { id: "staff", matrix_user_id: "@staff:local", display_name: "Staff", mental_points: 3, is_staff: true },
    ],
    powers: [
      { character_id: "a", power_code: "aus1" },
      { character_id: "b", power_code: "aus2" },
    ],
    presence: [
      { character_id: "a", room_id: "elysium", obfuscate_level: 0 },
      { character_id: "b", room_id: "elysium", obfuscate_level: 0 },
      { character_id: "c", room_id: "elysium", obfuscate_level: 2 },
    ],
    reveals: [],
    events: [],
  };
}

function assertEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function selfTest() {
  assertEqual(determineAuspexLevel(["aus1"]), 1, "aus1 level");
  assertEqual(determineAuspexLevel([{ power_code: "aus2" }]), 2, "aus2 level");
  assertEqual(legacyMentalRoll(50, 0, 50), true, "legacy roll hit");
  assertEqual(legacyMentalRoll(50, 0, 51), false, "legacy roll miss");

  let db = testDb();
  assertEqual(resolveAuspex(db, "a").body.revealed, [], "level 1 cannot reveal level 2");
  assertEqual(db.characters[0].mental_points, 2, "failed scan spends mental");

  db = testDb();
  assertEqual(resolveAuspex(db, "b").body.revealed, ["c"], "level 2 reveals level 2");
  assertEqual(visibleCharacters(db, "b", "elysium").map((character) => character.id), ["a", "b", "c"], "observer sees reveal");
  assertEqual(visibleCharacters(db, "a", "elysium").map((character) => character.id), ["a", "b"], "others do not see reveal");
  assertEqual(db.characters[1].mental_points, 2, "success spends mental");
  assertEqual(db.events.some((event) => event.event_type === "auspex_success" && event.target_character_id === "c"), true, "success logged");

  db = testDb();
  db.presence[1].obfuscate_level = 1;
  assertEqual(resolveAuspex(db, "b").status, 409, "obfuscated actor rejected");
  assertEqual(db.characters[1].mental_points, 3, "rejected actor does not spend mental");

  db = testDb();
  db.characters[1].mental_points = 1;
  assertEqual(resolveAuspex(db, "b").status, 400, "low mental rejected");
  assertEqual(db.characters[1].mental_points, 1, "low mental does not spend");

  // Legacy dice mode (opt-in): b(men 3) vs c(men 3) -> chance 50. Roll 1 hits, roll 100 misses.
  db = testDb();
  assertEqual(resolveAuspex(db, "b", { dice: true, roll: () => 0 }).body.revealed, ["c"], "dice hit reveals");
  db = testDb();
  const miss = resolveAuspex(db, "b", { dice: true, roll: () => 0.999 });
  assertEqual(miss.body.revealed, [], "dice miss reveals nothing");
  assertEqual(miss.body.message, "No invisible presence noticed", "dice miss gets failure notice");
  assertEqual(db.characters[1].mental_points, 2, "dice miss still spends mental");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  selfTest();
  console.log("auspex self-test ok");
}

export default {
  auspexLevel,
  determineAuspexLevel,
  findAuspexTargets,
  legacyMentalRoll,
  resolveAuspex,
  useAuspex,
  visibleCharacters,
};
