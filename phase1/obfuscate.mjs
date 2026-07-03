import { fileURLToPath } from "node:url";

const OBFUSCATE_TEXT = "{name} no longer seems to be there";
const SHADOW_TEXT = "{name} is swallowed by shadows";

const tables = (db) => ({
  presence: db.room_presence || db.presence || [],
  reveals: db.auspex_reveals || db.reveals || [],
});

const characterId = (character) => character?.id ?? character?.character_id;
const mentalPoints = (character) => character?.mental_points ?? character?.men ?? 0;
const setMentalPoints = (character, points) => {
  if ("mental_points" in character) character.mental_points = points;
  else character.men = points;
};

export function obfuscateLevel(powerCodes = []) {
  const powers = new Set(powerCodes.map(String));
  if (powers.has("obf2") || powers.has("ott2") || powers.has("16") || powers.has("18")) return 2;
  if (powers.has("obf1") || powers.has("ott1") || powers.has("15") || powers.has("17")) return 1;
  return 0;
}

export function obfuscateMessage(character, powerCodes = []) {
  const powers = new Set(powerCodes.map(String));
  const template = powers.has("ott1") || powers.has("ott2") || powers.has("17") || powers.has("18")
    ? SHADOW_TEXT
    : OBFUSCATE_TEXT;
  return template.replace("{name}", character.display_name || character.username || character.name || character.nome);
}

export function clearAuspexReveals(db, actorCharacterId) {
  const key = db.auspex_reveals ? "auspex_reveals" : "reveals";
  db[key] = (db[key] || []).filter(
    (reveal) => reveal.observer_character_id !== actorCharacterId && reveal.hidden_character_id !== actorCharacterId,
  );
  return db[key];
}

export function activateObfuscate(db, actor, powerCodes) {
  const id = characterId(actor);
  const level = obfuscateLevel(powerCodes);
  const { presence } = tables(db);
  const actorPresence = presence.find((row) => row.character_id === id);

  if (!level) return { ok: false, status: 403, error: "missing obfuscate power" };
  if (mentalPoints(actor) <= 1) return { ok: false, status: 400, error: "not enough mental points" };
  if (!actorPresence) return { ok: false, status: 400, error: "character is not in a room" };

  const otherVisible = presence.some(
    (row) => row.room_id === actorPresence.room_id && row.character_id !== id && row.obfuscate_level === 0,
  );
  if (level === 1 && otherVisible) {
    return { ok: false, status: 409, error: "level 1 cannot obfuscate before visible characters" };
  }

  actorPresence.obfuscate_level = level;
  setMentalPoints(actor, mentalPoints(actor) - 1);
  // Legacy obfuscate_in.php does NOT clear the auspex table on activation: re-casting while
  // already revealed does not shake off an observer's reveal. Rows are cleared only when the
  // obfuscation breaks (appear/speaking) or on movement.

  return {
    ok: true,
    status: 200,
    room_id: actorPresence.room_id,
    obfuscate_level: level,
    message: obfuscateMessage(actor, powerCodes),
  };
}

export function appear(db, actorOrCharacterId) {
  const id = typeof actorOrCharacterId === "object" ? characterId(actorOrCharacterId) : actorOrCharacterId;
  const { presence } = tables(db);
  const actorPresence = presence.find((row) => row.character_id === id);
  if (!actorPresence) return { ok: false, status: 400, error: "character is not in a room", broke_obfuscate: false };

  const broke_obfuscate = actorPresence.obfuscate_level > 0;
  actorPresence.obfuscate_level = 0;
  clearAuspexReveals(db, id);

  return { ok: true, status: 200, room_id: actorPresence.room_id, broke_obfuscate };
}

export function appearForPublicMessage(db, actorOrCharacterId) {
  const id = typeof actorOrCharacterId === "object" ? characterId(actorOrCharacterId) : actorOrCharacterId;
  const { presence } = tables(db);
  const actorPresence = presence.find((row) => row.character_id === id);
  if (!actorPresence) return { ok: false, status: 400, error: "character is not in a room", broke_obfuscate: false };
  if (actorPresence.obfuscate_level <= 0) {
    return { ok: true, status: 200, room_id: actorPresence.room_id, broke_obfuscate: false };
  }
  return appear(db, id);
}

function selfTest() {
  const db = {
    room_presence: [
      { character_id: "a", room_id: "elysium", obfuscate_level: 0 },
      { character_id: "b", room_id: "elysium", obfuscate_level: 0 },
    ],
    auspex_reveals: [
      { observer_character_id: "a", hidden_character_id: "b", room_id: "elysium" },
      { observer_character_id: "b", hidden_character_id: "a", room_id: "elysium" },
    ],
  };
  const actor = { id: "a", display_name: "A", mental_points: 2 };

  if (activateObfuscate(db, actor, ["obf1"]).status !== 409) throw new Error("level 1 block failed");
  if (actor.mental_points !== 2) throw new Error("rejected activation spent a mental point");
  db.room_presence[1].obfuscate_level = 1;
  const activated = activateObfuscate(db, actor, ["ott2"]);
  if (!activated.ok || activated.message !== "A is swallowed by shadows") throw new Error("activation failed");
  if (actor.mental_points !== 1 || db.room_presence[0].obfuscate_level !== 2) throw new Error("state update failed");
  if (db.auspex_reveals.length !== 2) throw new Error("activation must not clear auspex reveals (legacy keeps them)");
  if (!appearForPublicMessage(db, actor).broke_obfuscate || db.room_presence[0].obfuscate_level !== 0) {
    throw new Error("message-break appear failed");
  }
  if (db.auspex_reveals.length !== 0) throw new Error("breaking obfuscate must clear reveals involving the actor");
  db.auspex_reveals.push({ observer_character_id: "a", hidden_character_id: "b", room_id: "elysium" });
  if (appearForPublicMessage(db, actor).broke_obfuscate || db.auspex_reveals.length !== 1) {
    throw new Error("visible public message mutated state");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  selfTest();
  console.log("obfuscate self-test ok");
}
