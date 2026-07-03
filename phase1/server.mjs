import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { getState, reseedKeepingMatrix, save, seedState } from "./store.mjs";
import { activateObfuscate, appear, appearForPublicMessage } from "./obfuscate.mjs";
import { useAuspex } from "./auspex.mjs";
import { resolveChallenge, activateBuff } from "./challenge.mjs";
import { caccia, guarisci, volonta, fva, bancaInfo, riscuoti, sendMissive, listMissive } from "./extra.mjs";
import { visibleRosterForRoom } from "./roster.mjs";
import { matrixConfigFromEnv } from "./matrix-client.mjs";
import { watchMatrixEvents } from "./matrix-events.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const legacyRoot = join(root, "..", "sito Vampiripavia", "CHAT");
const port = Number(process.env.PORT || 8787);
const matrixConfig = matrixConfigFromEnv();
const matrixStatus = {
  configured: matrixConfig.configured,
  running: false,
  base_url: matrixConfig.homeserverUrl || null,
  user_id: matrixConfig.userId || null,
  last_sync_at: null,
  last_event_at: null,
  error: null,
};
let matrixWatcher = null;

const now = () => new Date().toISOString();
const state = () => getState();
const powersOf = (db, id) => db.character_powers.filter((power) => power.character_id === id).map((power) => power.power_code);
const presenceOf = (db, id) => db.room_presence.find((presence) => presence.character_id === id) || null;
const characterByMatrix = (db, matrixUserId) => db.characters.find((character) => character.matrix_user_id === matrixUserId);

// VP_REQUIRE_AUTH=1 (production): identity comes only from a Matrix access token verified
// against Synapse. Default (local dev/tests): the legacy spoofable ?as=/x-matrix-user-id
// params still work, so the offline tests and the overlay dev tool are unchanged.
const requireAuth = process.env.VP_REQUIRE_AUTH === "1";
const whoamiCache = new Map(); // token -> { user_id, expires }

async function verifyMatrixToken(token) {
  const cached = whoamiCache.get(token);
  if (cached && cached.expires > Date.now()) return cached.user_id;
  const baseUrl = matrixConfig.homeserverUrl || "http://localhost:8008";
  let user_id = null;
  try {
    const response = await fetch(`${baseUrl}/_matrix/client/v3/account/whoami`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (response.ok) user_id = (await response.json()).user_id || null;
  } catch {
    return null; // homeserver unreachable: fail closed, do not cache
  }
  whoamiCache.set(token, { user_id, expires: Date.now() + (user_id ? 300_000 : 30_000) });
  if (whoamiCache.size > 1000) whoamiCache.delete(whoamiCache.keys().next().value);
  return user_id;
}

function bearerToken(req, url) {
  const header = String(req.headers.authorization || "");
  if (/^Bearer\s+/i.test(header)) return header.replace(/^Bearer\s+/i, "").trim();
  return req.headers["x-vp-token"] || url.searchParams.get("token") || "";
}

async function actor(req, url) {
  const db = state();
  const token = bearerToken(req, url);
  if (token) {
    const userId = await verifyMatrixToken(token);
    if (userId) return characterByMatrix(db, userId);
  }
  if (requireAuth) return null;
  const matrixUserId = req.headers["x-matrix-user-id"] || url.searchParams.get("matrix_user_id") || url.searchParams.get("as");
  return matrixUserId && characterByMatrix(db, matrixUserId);
}

function event(db, event_type, actor_character_id, room_id, details = {}, target_character_id = null) {
  db.event_log.unshift({
    id: String(Math.max(0, ...db.event_log.map((entry) => Number(entry.id) || 0)) + 1),
    event_type,
    actor_character_id,
    target_character_id,
    room_id,
    details,
    created_at: now(),
  });
  db.event_log = db.event_log.slice(0, 50);
}

const json = (res, status, body) => {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type, x-matrix-user-id, x-vp-token, x-vp-admin-secret, authorization",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  });
  res.end(JSON.stringify(body, null, 2));
};

const fail = (res, status, error) => json(res, status, { error });

function contentType(path) {
  return {
    ".css": "text/css",
    ".gif": "image/gif",
    ".ico": "image/x-icon",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".js": "text/javascript",
    ".png": "image/png",
  }[extname(path).toLowerCase()] || "application/octet-stream";
}

async function bodyJson(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

// Post a system/combat line into a game room's Matrix room via the service token, so it
// shows for everyone (legacy reg_msg("",msg,"all",stanza)). Marked vp_system for styling.
async function postRoomMessage(db, gameRoomId, text, color) {
  const room = db.rooms.find((r) => r.id === gameRoomId);
  // Falls back to the staff character's token so narration works without a dedicated
  // service token (e.g. after auto-provisioning).
  const token = matrixConfig.accessToken || db.characters.find((c) => c.id === "staff")?.access_token;
  if (!room || !room.matrix_room_id || !matrixConfig.homeserverUrl || !token) return;
  const txn = `vp-sys-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  // msgtype m.notice: the /sync watcher ignores notices, so system narration can never be
  // mistaken for the sending account "speaking" and break its obfuscation.
  await fetch(`${matrixConfig.homeserverUrl}/_matrix/client/v3/rooms/${encodeURIComponent(room.matrix_room_id)}/send/m.room.message/${txn}`, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ msgtype: "m.notice", body: text, vp_system: true, vp_color: color || "gold" }),
  }).catch(() => {});
}

async function matrixLogin(username, password) {
  const baseUrl = matrixConfig.homeserverUrl || "http://localhost:8008";
  const response = await fetch(`${baseUrl}/_matrix/client/v3/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "m.login.password",
      identifier: { type: "m.id.user", user: username },
      password,
    }),
  });
  const body = await response.json();
  if (!response.ok) return { ok: false, status: response.status, body };
  return { ok: true, body };
}

function routeResult(res, db, result, successEvent) {
  if (result.ok === false || result.status >= 400) {
    return json(res, result.status || 400, { error: result.error || result.body?.error || "request failed" });
  }
  if (successEvent) successEvent();
  save(db);
  return json(res, result.status || 200, result.body || result);
}

async function route(req, res) {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;
  if (req.method === "OPTIONS") return json(res, 204, {});
  if (req.method === "GET" && path === "/health") return json(res, 200, { ok: true });
  if (req.method === "GET" && path === "/matrix/status") {
    const db = state();
    return json(res, 200, {
      ...matrixStatus,
      rooms: db.rooms.map((room) => ({
        id: room.id,
        name: room.name,
        matrix_room_id: room.matrix_room_id,
        watched: Boolean(room.matrix_room_id),
      })),
    });
  }
  if (req.method === "GET" && path === "/rooms") {
    const db = state();
    return json(res, 200, {
      rooms: db.rooms.map((room) => ({
        id: room.id,
        name: room.name,
        matrix_room_id: room.matrix_room_id || "",
        adjacent: room.adjacent || [],
        descrizione: room.descrizione || "",
      })),
    });
  }
  // Demo reset: restores seed RPG state but KEEPS the provisioned Matrix identities,
  // tokens, and room mappings. In production it requires staff or the admin secret.
  if (req.method === "POST" && path === "/seed") {
    if (requireAuth) {
      const adminSecret = process.env.VP_ADMIN_SECRET || "";
      const provided = req.headers["x-vp-admin-secret"] || url.searchParams.get("admin_secret") || "";
      const caller = await actor(req, url);
      const allowed = Boolean(caller?.is_staff) || Boolean(adminSecret && provided === adminSecret);
      if (!allowed) return fail(res, 403, "reset requires the staff login or the admin secret");
    }
    return json(res, 200, { ok: true, data: reseedKeepingMatrix() });
  }

  // Browser runtime config: the public Synapse URL (may differ from the sidecar-internal
  // MATRIX_BASE_URL, e.g. Railway private networking vs the public domain).
  if (req.method === "GET" && path === "/vp-config.js") {
    const publicUrl = (process.env.VP_PUBLIC_SYNAPSE_URL || matrixConfig.homeserverUrl || "http://localhost:8008").replace(/\/+$/, "");
    res.writeHead(200, { "content-type": "text/javascript", "access-control-allow-origin": "*" });
    return res.end(`window.VP_SYNAPSE_URL = ${JSON.stringify(publicUrl)};\n`);
  }

  if (req.method === "GET" && (path === "/" || path === "/login.html")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(await readFile(join(root, "login.html"), "utf8"));
  }

  if (req.method === "GET" && (path === "/overlay.html" || path === "/chat.html" || path === "/scheda.html" || path === "/popup.html" || path === "/challenge.html" || path === "/pagina.html")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(await readFile(join(root, path.slice(1)), "utf8"));
  }

  if (req.method === "GET" && path.startsWith("/legacy-assets/")) {
    const asset = decodeURIComponent(path.replace(/^\/legacy-assets\//, ""));
    if (!asset.startsWith("imgs") && !asset.startsWith("images") && asset !== "stili.css") return fail(res, 404, "asset not found");
    const assetPath = join(legacyRoot, asset);
    if (relative(legacyRoot, assetPath).startsWith("..")) return fail(res, 404, "asset not found");
    res.writeHead(200, { "content-type": contentType(assetPath) });
    return res.end(await readFile(assetPath));
  }

  if (req.method === "GET" && [".css", ".js"].includes(extname(path))) {
    const content = await readFile(join(root, path.slice(1)), "utf8");
    res.writeHead(200, { "content-type": contentType(path) });
    return res.end(content);
  }

  const db = state();

  if (req.method === "POST" && path === "/matrix/login") {
    const { username = "", password = "" } = await bodyJson(req);
    const login = await matrixLogin(username, password);
    if (!login.ok) return json(res, 401, { error: login.body?.error || "login failed" });
    const character = characterByMatrix(db, login.body.user_id);
    if (!character) return fail(res, 403, "Matrix user is not mapped to a Phase 1 character");
    return json(res, 200, {
      matrix_user_id: character.matrix_user_id,
      display_name: character.display_name,
      overlay_url: `/overlay.html?matrix_user_id=${encodeURIComponent(character.matrix_user_id)}&room_id=1`,
    });
  }

  const me = await actor(req, url);
  if (!me) {
    return fail(res, 401, requireAuth
      ? "log in first: this deployment requires a valid Matrix access token"
      : "pass ?as=@a:local, ?matrix_user_id=@a:local, or x-matrix-user-id");
  }

  if (req.method === "GET" && path === "/me") {
    return json(res, 200, { ...me, powers: powersOf(db, me.id), presence: presenceOf(db, me.id) });
  }

  const roomPresence = path.match(/^\/rooms\/([^/]+)\/presence$/);
  if (req.method === "POST" && roomPresence) {
    const room_id = roomPresence[1];
    if (!db.rooms.some((room) => room.id === room_id)) return fail(res, 404, "room not found");
    const existing = presenceOf(db, me.id);
    if (existing) Object.assign(existing, { room_id, last_seen_at: now() });
    else db.room_presence.push({ character_id: me.id, room_id, obfuscate_level: 0, last_seen_at: now() });
    db.auspex_reveals = db.auspex_reveals.filter(
      (reveal) => reveal.observer_character_id !== me.id && reveal.hidden_character_id !== me.id,
    );
    save(db);
    return json(res, 200, { ok: true, presence: presenceOf(db, me.id) });
  }

  const visibleRoster = path.match(/^\/rooms\/([^/]+)\/visible-characters$/);
  if (req.method === "GET" && visibleRoster) {
    return json(res, 200, { characters: visibleRosterForRoom(db, me, visibleRoster[1]) });
  }

  if (req.method === "POST" && path === "/obfuscate") {
    const result = activateObfuscate(db, me, powersOf(db, me.id));
    // Legacy obfuscate_in.php broadcasts the disappearance to the whole room
    // (reg_msg("", msg, "all", stanza)); sent as m.notice so the watcher ignores it.
    if (result.ok) await postRoomMessage(db, result.room_id, result.message, "gold");
    return routeResult(res, db, result, () => event(db, "obfuscate_on", me.id, result.room_id, { level: result.obfuscate_level }));
  }

  if (req.method === "POST" && path === "/appear") {
    const result = appear(db, me);
    return routeResult(res, db, result, () => {
      if (result.broke_obfuscate) event(db, "obfuscate_off", me.id, result.room_id);
    });
  }

  if (req.method === "POST" && path === "/auspex") {
    const result = useAuspex(db, me);
    save(db);
    return json(res, result.status, result.body);
  }

  if (req.method === "GET" && path === "/staff/events") {
    if (!me.is_staff) return fail(res, 403, "staff only");
    return json(res, 200, { events: db.event_log });
  }

  // XP ankh (legacy gainXP.php): +1 px once the per-character delay elapses; the delay
  // doubles while obfuscated (legacy pannello.php tempo_px*2).
  if (req.method === "POST" && path === "/gainxp") {
    const presence = presenceOf(db, me.id);
    if (!presence) return fail(res, 400, "character is not in a room");
    const base = Number(me.tempo_px || 60);
    const effective = (presence.obfuscate_level || 0) > 0 ? base * 2 : base;
    const nowSec = Math.floor(Date.now() / 1000);
    const elapsed = nowSec - Number(me.delayXP || 0);
    if (elapsed < effective) return json(res, 429, { error: "too soon", next_in: effective - elapsed });
    me.px_banca = Number(me.px_banca || 0) + 1;
    me.delayXP = nowSec;
    event(db, "gain_xp", me.id, presence.room_id, { px_banca: me.px_banca });
    save(db);
    return json(res, 200, { ok: true, px_banca: me.px_banca, next_in: effective });
  }

  // dice/challenge contest (legacy challenge.php) -> narration posted to the room
  if (req.method === "POST" && path === "/challenge") {
    const { target, type } = await bodyJson(req);
    const result = resolveChallenge(db, me, target, type);
    if (result.body.error) return json(res, result.status, result.body);
    save(db);
    await postRoomMessage(db, result.room_id, result.message, result.color);
    return json(res, result.status, result.body);
  }

  // discipline buff: raise a trait for a duration (auto-message to room or just activator)
  if (req.method === "POST" && path === "/buff") {
    const { power } = await bodyJson(req);
    const result = activateBuff(db, me, power);
    if (result.body.error) return json(res, result.status, result.body);
    save(db);
    if (result.scope === "all" && result.room_id) await postRoomMessage(db, result.room_id, result.message, "gold");
    return json(res, result.status, result.body);
  }

  // character maintenance (legacy scheda buttons): caccia / guarisci post to the room
  if (req.method === "POST" && (path === "/caccia" || path === "/guarisci")) {
    const result = (path === "/caccia" ? caccia : guarisci)(db, me);
    if (result.body.error) return json(res, result.status, result.body);
    save(db);
    if (result.room_id) await postRoomMessage(db, result.room_id, result.message, "gold");
    return json(res, result.status, result.body);
  }
  if (req.method === "POST" && (path === "/volonta" || path === "/fva")) {
    const result = (path === "/volonta" ? volonta : fva)(db, me);
    if (result.body.error) return json(res, result.status, result.body);
    save(db);
    return json(res, result.status, result.body);
  }

  // banca (banking / stipend)
  if (req.method === "GET" && path === "/banca") return json(res, 200, bancaInfo(me));
  if (req.method === "POST" && path === "/banca/riscuoti") {
    const result = riscuoti(me);
    if (result.body.error) return json(res, result.status, result.body);
    save(db);
    return json(res, result.status, result.body);
  }

  // inventario
  if (req.method === "GET" && path === "/inventario") return json(res, 200, { items: me.inventario || [] });

  // missive (in-game mail)
  if (req.method === "GET" && path === "/missive") {
    const lists = listMissive(db, me.id);
    const name = (id) => { const c = db.characters.find((x) => x.id === id); return c ? c.display_name : id; };
    const withNames = (m) => ({ ...m, from_name: name(m.from), to_name: name(m.to) });
    return json(res, 200, { received: lists.received.map(withNames), sent: lists.sent.map(withNames) });
  }
  if (req.method === "POST" && path === "/missive") {
    const { to, body } = await bodyJson(req);
    const byName = db.characters.find((c) => c.display_name && c.display_name.toLowerCase() === String(to || "").toLowerCase());
    const result = sendMissive(db, me.id, byName ? byName.id : to, body);
    if (result.body.error) return json(res, result.status, result.body);
    save(db);
    return json(res, result.status, result.body);
  }

  // public character card (legacy identita.php) for the roster "I" button
  const charLookup = path.match(/^\/characters\/([^/]+)$/);
  if (req.method === "GET" && charLookup) {
    const c = db.characters.find((row) => row.id === charLookup[1]);
    if (!c) return fail(res, 404, "character not found");
    return json(res, 200, {
      id: c.id, display_name: c.display_name, clan: c.clan, status: c.status,
      citta: c.citta, natura: c.natura, gen: c.gen, umanita: c.umanita,
      disciplines: c.disciplines || {}, abilita: c.abilita || [], note: c.note || "",
    });
  }

  return fail(res, 404, "not found");
}

function selfTest() {
  // In-memory seed only: the self-test must never overwrite data.json (it holds the live
  // Matrix room mappings and access tokens).
  const db = seedState();
  const [a, b, c, staff] = db.characters;
  assert.deepEqual(visibleRosterForRoom(db, a, "1").map((row) => row.id), ["a", "b", "c"]);
  let result = activateObfuscate(db, a, powersOf(db, a.id));
  assert.equal(result.ok, true);
  event(db, "obfuscate_on", a.id, result.room_id, { level: result.obfuscate_level });
  assert.deepEqual(visibleRosterForRoom(db, b, "1").map((row) => row.id), ["b", "c"]);
  assert.deepEqual(visibleRosterForRoom(db, c, "1").map((row) => row.id), ["b", "c"]);
  assert.deepEqual(visibleRosterForRoom(db, a, "1").map((row) => row.id), ["a", "b", "c"]);
  result = useAuspex(db, b);
  assert.deepEqual(result.body.revealed, ["a"]);
  assert.deepEqual(visibleRosterForRoom(db, b, "1").map((row) => row.id), ["a", "b", "c"]);
  assert.deepEqual(visibleRosterForRoom(db, c, "1").map((row) => row.id), ["b", "c"]);
  assert.equal(visibleRosterForRoom(db, staff, "1").find((row) => row.id === "a").obfuscate_level, 2);
  result = appearForPublicMessage(db, a);
  assert.equal(result.broke_obfuscate, true);
  event(db, "message_broke_obfuscate", a.id, result.room_id);
  assert.deepEqual(visibleRosterForRoom(db, c, "1").map((row) => row.id), ["a", "b", "c"]);
}

function startMatrixWatcher() {
  if (!matrixConfig.configured || !matrixConfig.syncEnabled) return null;
  matrixStatus.running = true;
  matrixWatcher = watchMatrixEvents({
    baseUrl: matrixConfig.homeserverUrl,
    accessToken: matrixConfig.accessToken || undefined,
    intervalMs: matrixConfig.syncPollMs,
    onError(error) {
      matrixStatus.error = error.message;
      matrixStatus.running = false;
    },
    onPoll(result) {
      matrixStatus.last_sync_at = now();
      matrixStatus.running = true;
      matrixStatus.error = null;
      if (result.broke_obfuscate) matrixStatus.last_event_at = now();
    },
    saveState(db) {
      matrixStatus.last_event_at = now();
      save(db);
    },
  });
  const poll = matrixWatcher.poll;
  matrixWatcher.poll = async () => {
    const result = await poll();
    matrixStatus.last_sync_at = now();
    matrixStatus.running = true;
    matrixStatus.error = null;
    if (result.broke_obfuscate) matrixStatus.last_event_at = now();
    return result;
  };
  return matrixWatcher;
}

// VP_AUTO_PROVISION=1: on boot, if data.json has no Matrix wiring yet (fresh volume),
// register the demo users and create/join the game rooms against MATRIX_BASE_URL.
// Retries until Synapse is reachable, so service start order doesn't matter.
async function autoProvision() {
  if (process.env.VP_AUTO_PROVISION !== "1") return;
  const provisioned = () => {
    const db = state();
    return db.rooms.some((room) => room.matrix_room_id)
      && db.characters.length > 0
      && db.characters.every((character) => character.access_token);
  };
  if (provisioned()) return;
  const { provision } = await import("./setup-matrix.mjs");
  for (;;) {
    try {
      await provision();
      console.log("auto-provisioned Matrix users and rooms");
      return;
    } catch (error) {
      console.error(`auto-provision failed (${error.message}); retrying in 15s`);
      await new Promise((resolve) => setTimeout(resolve, 15_000));
    }
  }
}

if (process.argv.includes("--self-test")) {
  selfTest();
  console.log("phase1 self-test ok");
} else {
  // The HTTP server starts immediately; provisioning runs in the background and the
  // watcher self-heals once tokens exist (it retries on every poll tick).
  autoProvision().catch((error) => console.error(error.message));
  startMatrixWatcher();
  createServer((req, res) => route(req, res).catch((error) => fail(res, 500, error.message))).listen(port, () => {
    console.log(`Phase 1 overlay listening on http://localhost:${port}`);
  });
}
