import { pathToFileURL } from "node:url";

// Breadth subsystems ported from the legacy: caccia (hunt), guarisci (heal), volonta,
// funzioni vitali (fva), banca (banking/stipend), missive (in-game mail).
const MONTH = 2592000; // 30 days, legacy stipend cycle
const nowSec = () => Math.floor(Date.now() / 1000);
const presenceOf = (db, id) => (db.room_presence || db.presence || []).find((p) => p.character_id === id) || null;

function logEvent(db, type, actor, room, details = {}, target = null) {
  const k = db.event_log ? "event_log" : "events";
  if (!Array.isArray(db[k])) db[k] = [];
  db[k].unshift({
    id: String((db[k][0] ? Number(db[k][0].id) || db[k].length : 0) + 1),
    event_type: type, actor_character_id: actor, target_character_id: target,
    room_id: room, details, created_at: new Date().toISOString(),
  });
  db[k] = db[k].slice(0, 50);
}

export function caccia(db, ch) {
  if (Number(ch.blood || 0) >= Number(ch.bloodmax || 10)) return { status: 400, body: { error: "Sangue gia al massimo" } };
  if (nowSec() - Number(ch.caccia_ts || 0) < 3600) return { status: 429, body: { error: "Hai gia cacciato di recente" } };
  ch.blood = Number(ch.bloodmax || 10);
  ch.caccia_ts = nowSec();
  const ap = presenceOf(db, ch.id);
  logEvent(db, "caccia", ch.id, ap ? ap.room_id : null);
  return { status: 200, body: { ok: true, blood: ch.blood }, room_id: ap ? ap.room_id : null, message: `${ch.display_name} torna dalla caccia, sazio` };
}

export function guarisci(db, ch) {
  if (Number(ch.danni || 0) <= 0) return { status: 400, body: { error: "Nessuna ferita da curare" } };
  if (Number(ch.blood || 0) <= 1) return { status: 400, body: { error: "Sangue insufficiente" } };
  ch.danni = Number(ch.danni) - 1;
  ch.blood = Number(ch.blood) - 1;
  const ap = presenceOf(db, ch.id);
  logEvent(db, "guarisci", ch.id, ap ? ap.room_id : null);
  return { status: 200, body: { ok: true, danni: ch.danni, blood: ch.blood }, room_id: ap ? ap.room_id : null, message: `${ch.display_name} rimargina le proprie ferite` };
}

// Legacy volonta.php: spend 1 point and announce it to the room. Restoring trait pools
// is a SEPARATE action (refill below, legacy scheda_refill.php).
export function volonta(db, ch) {
  if (Number(ch.will || 0) <= 0) return { status: 400, body: { error: "Volonta insufficiente" } };
  ch.will = Number(ch.will) - 1;
  const ap = presenceOf(db, ch.id);
  logEvent(db, "volonta", ch.id, ap ? ap.room_id : null);
  return {
    status: 200,
    body: { ok: true, will: ch.will, message: "Spendi un punto Volonta" },
    room_id: ap ? ap.room_id : null,
    message: `[${ch.display_name} spende un punto Forza di Volonta]`,
  };
}

// Legacy scheda_refill.php (?t=M/F/S): 1 Volonta restores ONE pool to its max, only when
// that pool is below max and will > 0. No room announcement. Legacy's Fisici branch had
// two copy-paste bugs (guarded on the mental condition, restored fis to soc_max) —
// intent reproduced, bugs not.
const REFILL_POOLS = {
  M: { label: "Mentali", cur: (ch) => Number(ch.mental_points ?? ch.men ?? 0), max: (ch) => Number(ch.men_max), set: (ch, v) => { ch.mental_points = v; if ("men" in ch) ch.men = v; } },
  F: { label: "Fisici", cur: (ch) => Number(ch.fis ?? 0), max: (ch) => Number(ch.fis_max), set: (ch, v) => { ch.fis = v; } },
  S: { label: "Sociali", cur: (ch) => Number(ch.soc ?? 0), max: (ch) => Number(ch.soc_max), set: (ch, v) => { ch.soc = v; } },
};

export function refill(db, ch, pool) {
  const spec = REFILL_POOLS[String(pool || "").toUpperCase()];
  if (!spec) return { status: 400, body: { error: "Pool non valido (t=M, F o S)" } };
  if (Number(ch.will || 0) <= 0) return { status: 400, body: { error: "Volonta insufficiente" } };
  if (!Number.isFinite(spec.max(ch)) || spec.cur(ch) >= spec.max(ch)) {
    return { status: 400, body: { error: `${spec.label} gia al massimo` } };
  }
  spec.set(ch, spec.max(ch));
  ch.will = Number(ch.will) - 1;
  const ap = presenceOf(db, ch.id);
  logEvent(db, "refill", ch.id, ap ? ap.room_id : null, { pool: spec.label });
  return {
    status: 200,
    body: { ok: true, will: ch.will, mental_points: ch.mental_points, fis: ch.fis, soc: ch.soc, message: `${spec.label} ripristinati` },
  };
}

export function fva(db, ch) {
  ch.fva = 1;
  ch.fva_ts = nowSec();
  return { status: 200, body: { ok: true, message: "Funzioni vitali attivate" } };
}

export function bancaInfo(ch) {
  const b = ch.banca || { entrate: 0, uscite: 0, spesi: 0, time: 0 };
  const totale = Number(b.entrate || 0) - Number(b.uscite || 0);
  return { entrate: Number(b.entrate || 0), uscite: Number(b.uscite || 0), totale, spesi: Number(b.spesi || 0), ultimo: Number(b.time || 0), prossimo: Number(b.time || 0) + MONTH };
}

export function riscuoti(ch) {
  const b = ch.banca || (ch.banca = { entrate: 0, uscite: 0, spesi: 0, time: 0 });
  if (b.time && nowSec() - Number(b.time) < MONTH) return { status: 429, body: { error: "Stipendio non ancora disponibile" } };
  const totale = Number(b.entrate || 0) - Number(b.uscite || 0);
  b.spesi = Number(b.spesi || 0) + totale;
  b.time = nowSec();
  return { status: 200, body: { ok: true, riscosso: totale, spesi: b.spesi } };
}

export function sendMissive(db, fromId, toId, text) {
  if (!toId || !text) return { status: 400, body: { error: "Destinatario e testo richiesti" } };
  if (!Array.isArray(db.missive)) db.missive = [];
  db.missive.push({ id: String(db.missive.length + 1), from: fromId, to: toId, body: String(text).slice(0, 2000), time: nowSec(), read: false });
  return { status: 200, body: { ok: true } };
}

export function listMissive(db, id) {
  const all = db.missive || [];
  return { received: all.filter((m) => m.to === id), sent: all.filter((m) => m.from === id) };
}

function selfTest() {
  const assert = (c, m) => { if (!c) throw new Error(m); };
  const db = {
    characters: [{ id: "a", display_name: "A", blood: 5, bloodmax: 10, will: 3, danni: 2, mental_points: 1, men_max: 5, fis: 2, fis_max: 6, soc: 3, soc_max: 7 }],
    room_presence: [{ character_id: "a", room_id: "1", obfuscate_level: 0 }],
    event_log: [], missive: [],
  };
  const a = db.characters[0];
  assert(caccia(db, a).body.blood === 10, "caccia refills blood");
  assert(caccia(db, a).status === 400, "caccia blocked at max");
  assert(guarisci(db, a).body.danni === 1, "guarisci reduces damage");
  const spent = volonta(db, a);
  assert(spent.body.will === 2, "volonta spends will");
  assert(a.mental_points === 1 && a.fis === 2 && a.soc === 3, "volonta does NOT touch trait pools (legacy)");
  assert(spent.room_id === "1" && /Forza di Volonta/.test(spent.message), "volonta announces to the room");
  assert(refill(db, a, "M").body.mental_points === 5 && a.will === 1, "refill M restores mentali for 1 will");
  assert(refill(db, a, "M").status === 400, "refill M blocked at max");
  assert(refill(db, a, "f").body.fis === 6 && a.will === 0, "refill F restores fisici to fis_max");
  assert(refill(db, a, "S").status === 400, "refill blocked at zero will");
  assert(/insufficiente/.test(refill(db, a, "S").body.error), "zero-will refill error message");
  a.will = 1;
  assert(refill(db, a, "S").body.soc === 7, "refill S restores sociali");
  assert(refill(db, a, "X").status === 400, "invalid pool rejected");
  assert(volonta(db, a).status === 400, "volonta blocked at zero will");
  a.will = 3;
  assert(fva(db, a).body.ok, "fva activates");
  assert(bancaInfo({ banca: { entrate: 5, uscite: 2 } }).totale === 3, "banca totale");
  assert(sendMissive(db, "a", "b", "ciao").body.ok, "send missive");
  assert(listMissive(db, "b").received.length === 1, "list missive received");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  selfTest();
  console.log("extra self-test ok");
}

export default { caccia, guarisci, volonta, refill, fva, bancaInfo, riscuoti, sendMissive, listMissive };
