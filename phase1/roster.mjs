import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const isStaff = (viewer) => Boolean(viewer?.is_staff);
const sameId = (a, b) => String(a) === String(b);

function characterId(row) {
  return row?.character_id ?? row?.userID ?? row?.id;
}

function revealObserverId(row) {
  return row?.observer_character_id ?? row?.IDOsservatore;
}

function revealHiddenId(row) {
  return row?.hidden_character_id ?? row?.IDOmbra;
}

function inRoom(row, roomId) {
  return row?.room_id === undefined || sameId(row.room_id, roomId);
}

export function revealedCharacterIds(reveals, viewer, roomId) {
  return new Set(
    (reveals ?? [])
      .filter((row) => sameId(revealObserverId(row), viewer?.id) && inRoom(row, roomId))
      .map((row) => String(revealHiddenId(row))),
  );
}

export function visibleRoster({ characters = [], presence = [], reveals = [], viewer, roomId }) {
  const byId = new Map(characters.map((character) => [String(character.id), character]));
  const revealed = revealedCharacterIds(reveals, viewer, roomId);

  return presence
    .filter((row) => sameId(row.room_id, roomId))
    .flatMap((row) => {
      const character = byId.get(String(characterId(row)));
      if (!character) return [];

      const self = sameId(character.id, viewer?.id);
      const hidden = Number(row.obfuscate_level ?? row.obfuscate ?? 0) > 0;
      const revealed_by_auspex = hidden && revealed.has(String(character.id));
      const include = !hidden || self || revealed_by_auspex || isStaff(viewer);
      if (!include) return [];

      return [{
        id: character.id,
        display_name: character.display_name ?? character.nome ?? character.username,
        matrix_user_id: character.matrix_user_id,
        visible: !hidden,
        self,
        revealed_by_auspex,
        ...(isStaff(viewer) || self ? { obfuscate_level: Number(row.obfuscate_level ?? row.obfuscate ?? 0) } : {}),
        ...(isStaff(viewer) || self ? { mental_points: character.mental_points ?? character.men } : {}),
      }];
    });
}

export function visibleRosterForRoom(db, viewer, roomId) {
  return visibleRoster({
    characters: db.characters,
    presence: db.presence ?? db.room_presence,
    reveals: db.reveals ?? db.auspex_reveals,
    viewer,
    roomId,
  });
}

function selfTest() {
  const db = {
    characters: [
      { id: "a", display_name: "A", matrix_user_id: "@a:local", mental_points: 5 },
      { id: "b", display_name: "B", matrix_user_id: "@b:local", mental_points: 4 },
      { id: "c", display_name: "C", matrix_user_id: "@c:local", mental_points: 3 },
      { id: "staff", display_name: "Staff", matrix_user_id: "@staff:local", is_staff: true },
    ],
    presence: [
      { character_id: "a", room_id: "elysium", obfuscate_level: 0 },
      { character_id: "b", room_id: "elysium", obfuscate_level: 1 },
      { character_id: "c", room_id: "elysium", obfuscate_level: 2 },
    ],
    reveals: [{ observer_character_id: "a", hidden_character_id: "b", room_id: "elysium" }],
  };

  const [a, b, , staff] = db.characters;
  const ids = (viewer) => visibleRosterForRoom(db, viewer, "elysium").map((row) => row.id);

  assert.deepEqual(ids(a), ["a", "b"]);
  assert.deepEqual(ids(b), ["a", "b"]);
  assert.deepEqual(ids(staff), ["a", "b", "c"]);
  assert.equal(visibleRosterForRoom(db, a, "elysium").find((row) => row.id === "b").revealed_by_auspex, true);
  assert.equal("obfuscate_level" in visibleRosterForRoom(db, a, "elysium").find((row) => row.id === "b"), false);
  assert.equal("mental_points" in visibleRosterForRoom(db, a, "elysium").find((row) => row.id === "b"), false);
  assert.equal(visibleRosterForRoom(db, b, "elysium").find((row) => row.id === "b").obfuscate_level, 1);
  assert.equal(visibleRosterForRoom(db, staff, "elysium").find((row) => row.id === "c").mental_points, 3);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  selfTest();
  console.log("roster self-test ok");
}
