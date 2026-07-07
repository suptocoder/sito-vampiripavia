import { pathToFileURL } from "node:url";
import { appearMessage } from "./obfuscate.mjs";

// Faithful port of the legacy dice/challenge core (challenge_lib.php / calc_challenge.php):
//   percsucc = floor(att / (att + def) * 100); roll 1..100; win if roll <= percsucc.
// Contest types mirror the legacy "codici sfida": 2=fisica, 3=mentale, 4=mentale-vs-fisica,
// plus sociale (soc vs soc). Disciplines can buff a trait for a duration (the client's
// "powers increasing physical/mental/social traits for a time, with automatic messages").

const TYPES = {
  fisica: { att: "fis", def: "fis", label: "Fisica" },
  mentale: { att: "men", def: "men", label: "Mentale" },
  sociale: { att: "soc", def: "soc", label: "Sociale" },
  menfis: { att: "men", def: "fis", label: "Mentale vs Fisica" },
};

// discipline buff catalog (key = normalized discipline name)
export const BUFFS = {
  celerita: { label: "Celerità", trait: "fis", amount: 2, duration: 300, scope: "all", msg: "%a si muove con innaturale rapidità" },
  potenza: { label: "Potenza", trait: "fis", amount: 2, duration: 300, scope: "all", msg: "%a sprigiona una forza sovrumana" },
  robustezza: { label: "Robustezza", trait: "fis", amount: 2, duration: 300, scope: "self", msg: "La tua pelle si fa dura come pietra" },
  presenza: { label: "Presenza", trait: "soc", amount: 2, duration: 300, scope: "all", msg: "%a emana un fascino magnetico e innaturale" },
  // Auspex has no "Attiva" buff: its powers are the Scruta/Aguzza l'udito buttons (client
  // confirmed the extra Attiva button had no meaningful effect and asked to remove it).
};

export const normalizeDiscipline = (name) =>
  String(name || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "");

const nowSec = () => Math.floor(Date.now() / 1000);
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

const characterById = (db, id) => (db.characters || []).find((c) => c.id === id) || null;
const presenceOf = (db, id) => (db.room_presence || db.presence || []).find((p) => p.character_id === id) || null;

function clearReveals(db, characterId) {
  const key = db.auspex_reveals ? "auspex_reveals" : "reveals";
  db[key] = (db[key] || []).filter((r) => r.observer_character_id !== characterId && r.hidden_character_id !== characterId);
}

function logEvent(db, type, actor, room, details, target = null) {
  const key = db.event_log ? "event_log" : "events";
  if (!Array.isArray(db[key])) db[key] = [];
  db[key].unshift({
    id: String((db[key][0] ? Number(db[key][0].id) || db[key].length : 0) + 1),
    event_type: type, actor_character_id: actor, target_character_id: target,
    room_id: room, details, created_at: new Date().toISOString(),
  });
  db[key] = db[key].slice(0, 50);
}

export function effectiveTrait(character, kind) {
  if (!character) return 1;
  const base = kind === "men" ? Number(character.mental_points || 0) : Number(character[kind] || 0);
  const now = nowSec();
  const bonus = (character.buffs || []).filter((b) => b.trait === kind && b.expires > now).reduce((s, b) => s + Number(b.amount || 0), 0);
  return Math.max(1, base + bonus);
}

export function resolveChallenge(db, attacker, targetId, type) {
  const t = TYPES[type] || TYPES.fisica;
  const target = characterById(db, targetId);
  if (!target) return { status: 404, body: { error: "target not found" } };
  if (attacker.id === targetId) return { status: 400, body: { error: "cannot challenge yourself" } };
  const ap = presenceOf(db, attacker.id);
  if (!ap) return { status: 400, body: { error: "character is not in a room" } };

  const att = effectiveTrait(attacker, t.att);
  const def = effectiveTrait(target, t.def);
  const percsucc = Math.max(1, Math.min(99, Math.floor((att / (att + def)) * 100)));
  const roll = randInt(1, 100);
  const won = roll <= percsucc;

  const a = attacker.display_name, d = target.display_name;
  let message, color;
  if (won) {
    message = `${a} attacca ${d} e ferisce l'avversario`;
    color = "red";
    const tp = presenceOf(db, targetId);
    if (tp && tp.obfuscate_level > 0) { tp.obfuscate_level = 0; clearReveals(db, targetId); } // legacy: a hit breaks obfuscate
    if (type === "fisica") target.danni = Number(target.danni || 0) + 1;
  } else {
    message = `${a} attacca ${d}, ma il colpo non causa danno`;
    color = "gold";
  }

  // Legacy calc_challenge.php calls obfuscate_off($_SESSION['userID']) after the contest,
  // hit or miss: attacking always drops the attacker out of obfuscation. The appear line
  // is announced by the caller before the combat narration.
  let attacker_appear_message = null;
  if (ap.obfuscate_level > 0) {
    ap.obfuscate_level = 0;
    clearReveals(db, attacker.id);
    const powers = (db.character_powers || db.powers || [])
      .filter((p) => p.character_id === attacker.id)
      .map((p) => p.power_code ?? p.ref_disc);
    attacker_appear_message = appearMessage(attacker, powers);
    logEvent(db, "challenge_broke_obfuscate", attacker.id, ap.room_id, {}, targetId);
  }

  logEvent(db, "challenge", attacker.id, ap.room_id, { type, percsucc, roll, won }, targetId);
  return {
    status: 200,
    body: { won, percsucc, roll, message, color, type: t.label },
    room_id: ap.room_id,
    message,
    color,
    attacker_appear_message,
  };
}

export function activateBuff(db, character, powerKey) {
  const buff = BUFFS[normalizeDiscipline(powerKey)];
  if (!buff) return { status: 400, body: { error: "unknown discipline" } };
  const ap = presenceOf(db, character.id);
  const now = nowSec();
  character.buffs = (character.buffs || []).filter((b) => b.expires > now);
  character.buffs.push({ trait: buff.trait, amount: buff.amount, expires: now + buff.duration, label: buff.label });
  logEvent(db, "buff", character.id, ap ? ap.room_id : null, { label: buff.label, trait: buff.trait, amount: buff.amount });
  const message = buff.scope === "all" ? buff.msg.replace("%a", character.display_name) : buff.msg;
  return { status: 200, body: { ok: true, label: buff.label, scope: buff.scope, message, trait: buff.trait, amount: buff.amount }, room_id: ap ? ap.room_id : null, scope: buff.scope, message };
}

function selfTest() {
  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
  const db = {
    characters: [
      { id: "a", display_name: "A", fis: 4, soc: 3, mental_points: 5 },
      { id: "b", display_name: "B", fis: 2, soc: 5, mental_points: 4 },
    ],
    room_presence: [
      { character_id: "a", room_id: "1", obfuscate_level: 0 },
      { character_id: "b", room_id: "1", obfuscate_level: 1 },
    ],
    auspex_reveals: [], event_log: [],
  };
  assert(effectiveTrait(db.characters[0], "fis") === 4, "base trait");
  assert(normalizeDiscipline("Celerità") === "celerita", "normalize");
  // buff raises trait
  activateBuff(db, db.characters[0], "Celerità");
  assert(effectiveTrait(db.characters[0], "fis") === 6, "buff applied");
  // challenge math: A fis 6 vs B fis 2 -> 75%
  const r = resolveChallenge(db, db.characters[0], "b", "fisica");
  assert(r.body.percsucc === 75, "percsucc " + r.body.percsucc);
  assert(r.body.roll >= 1 && r.body.roll <= 100, "roll range");
  assert(r.attacker_appear_message === null, "visible attacker has no appear message");
  // attacking while obfuscated breaks the attacker's obfuscation, hit or miss (legacy)
  db.room_presence[0].obfuscate_level = 2;
  db.character_powers = [{ character_id: "a", power_code: "ott2" }];
  const r2 = resolveChallenge(db, db.characters[0], "b", "fisica");
  assert(db.room_presence[0].obfuscate_level === 0, "attack must break attacker obfuscate");
  assert(r2.attacker_appear_message === "A emerge dalle ombre", "attacker appear message");
  assert(!BUFFS.auspex, "auspex must not be an Attiva buff");
  // expired buff ignored
  db.characters[0].buffs = [{ trait: "fis", amount: 2, expires: nowSec() - 1 }];
  assert(effectiveTrait(db.characters[0], "fis") === 4, "expired buff ignored");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  selfTest();
  console.log("challenge self-test ok");
}

export default { TYPES, BUFFS, effectiveTrait, resolveChallenge, activateBuff, normalizeDiscipline };
