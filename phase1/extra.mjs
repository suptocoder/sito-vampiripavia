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

// Legacy: volonta.php spends the point and announces it to the room; scheda_refill.php
// restores a trait pool to max for 1 Volonta. Per the client, one SPENDI restores all
// three pools (Mentali, Sociali, Fisici) at once. (Legacy charged 1 per pool, and its
// fisici branch had a copy-paste bug restoring fis to soc_max — not reproduced.)
export function volonta(db, ch) {
  if (Number(ch.will || 0) <= 0) return { status: 400, body: { error: "Volonta insufficiente" } };
  ch.will = Number(ch.will) - 1;
  if (ch.men_max != null) {
    ch.mental_points = Number(ch.men_max);
    if ("men" in ch) ch.men = Number(ch.men_max);
  }
  if (ch.fis_max != null) ch.fis = Number(ch.fis_max);
  if (ch.soc_max != null) ch.soc = Number(ch.soc_max);
  const ap = presenceOf(db, ch.id);
  logEvent(db, "volonta", ch.id, ap ? ap.room_id : null);
  return {
    status: 200,
    body: { ok: true, will: ch.will, mental_points: ch.mental_points, fis: ch.fis, soc: ch.soc, message: "Spendi un punto Volonta: Mentali, Sociali e Fisici ripristinati" },
    room_id: ap ? ap.room_id : null,
    message: `[${ch.display_name} spende un punto Forza di Volonta]`,
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
  assert(a.mental_points === 5 && a.fis === 6 && a.soc === 7, "volonta refills mentali/fisici/sociali to max");
  assert(spent.room_id === "1" && /Forza di Volonta/.test(spent.message), "volonta announces to the room");
  a.will = 0;
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

export default { caccia, guarisci, volonta, fva, bancaInfo, riscuoti, sendMissive, listMissive };
