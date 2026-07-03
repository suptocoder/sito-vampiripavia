import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { appearForPublicMessage } from "./obfuscate.mjs";
import { getState, save } from "./store.mjs";

const now = () => new Date().toISOString();
const uniq = (items) => [...new Set(items.filter(Boolean).map(String))];
const stripSlash = (value) => String(value || "").replace(/\/+$/, "");

export function createMatrixEventState(options = {}) {
  const seenEventIds = new Set(options.seenEventIds || []);
  const sinceByToken = new Map(Object.entries(options.sinceByToken || {}));
  return { since: options.since || null, sinceByToken, seenEventIds };
}

export function matrixRoomMap(db) {
  return new Map((db.rooms || []).filter((room) => room.matrix_room_id).map((room) => [room.matrix_room_id, room]));
}

export function matrixBaseUrl(db = {}, options = {}) {
  return stripSlash(
    options.baseUrl ||
      process.env.MATRIX_BASE_URL ||
      process.env.MATRIX_HOMESERVER_URL ||
      db.matrix?.base_url ||
      db.matrix?.homeserver_url ||
      db.config?.matrix_base_url,
  );
}

export function matrixAccessTokens(db = {}, options = {}) {
  const configured = uniq([
    options.accessToken,
    ...(options.accessTokens || []),
    process.env.MATRIX_ACCESS_TOKEN,
    process.env.MATRIX_SERVICE_ACCESS_TOKEN,
    process.env.MATRIX_STAFF_ACCESS_TOKEN,
    db.matrix?.access_token,
    db.matrix?.service_access_token,
    db.matrix?.staff_access_token,
  ]);
  if (configured.length) return configured;

  return uniq((db.characters || []).flatMap((character) => [
    character.matrix_access_token,
    character.access_token,
    character.matrix?.access_token,
  ]));
}

export function matrixEventsFromSync(syncBody, rooms = matrixRoomMap({})) {
  return Object.entries(syncBody?.rooms?.join || {}).flatMap(([matrixRoomId, room]) => {
    const mappedRoom = rooms.get(matrixRoomId);
    if (!mappedRoom) return [];
    return (room.timeline?.events || []).map((event) => ({ event, room: mappedRoom, matrixRoomId }));
  });
}

function publicRoomMessage(event) {
  if (event?.type !== "m.room.message") return false;
  if (!event.event_id || !event.sender) return false;
  if (event.content?.["m.relates_to"]?.rel_type === "m.replace") return false;
  return event.content?.msgtype !== "m.notice";
}

function characterByMatrix(db, matrixUserId) {
  return (db.characters || []).find((character) => character.matrix_user_id === matrixUserId) || null;
}

function presenceOf(db, characterId) {
  return (db.room_presence || []).find((presence) => presence.character_id === characterId) || null;
}

function matrixEventAlreadyLogged(db, eventId) {
  return (db.event_log || []).some((entry) => entry.details?.matrix_event_id === eventId);
}

function logEvent(db, event_type, actor_character_id, room_id, details = {}) {
  const events = Array.isArray(db.event_log) ? db.event_log : [];
  const id = String(events.reduce((max, event) => Math.max(max, Number(event.id) || 0), 0) + 1);
  db.event_log = [{
    id,
    event_type,
    actor_character_id,
    target_character_id: null,
    room_id,
    details,
    created_at: now(),
  }, ...events].slice(0, 50);
}

export function handleMatrixEvent(db, event, room, options = {}) {
  const state = options.state || createMatrixEventState();
  if (!publicRoomMessage(event)) return { processed: false, reason: "not_public_message" };
  if (state.seenEventIds.has(event.event_id) || matrixEventAlreadyLogged(db, event.event_id)) {
    return { processed: false, reason: "seen" };
  }

  state.seenEventIds.add(event.event_id);
  if (state.seenEventIds.size > (options.seenLimit || 1000)) {
    state.seenEventIds.delete(state.seenEventIds.values().next().value);
  }

  const actor = characterByMatrix(db, event.sender);
  if (!actor) return { processed: false, reason: "unknown_sender" };

  const presence = presenceOf(db, actor.id);
  if (!presence || presence.room_id !== room.id) return { processed: false, reason: "not_present_in_mapped_room" };

  const result = appearForPublicMessage(db, actor);
  if (result.broke_obfuscate) {
    logEvent(db, "message_broke_obfuscate", actor.id, result.room_id, {
      matrix_event_id: event.event_id,
      matrix_room_id: room.matrix_room_id,
    });
    (options.saveState || save)(db);
  }

  return {
    processed: true,
    actor_character_id: actor.id,
    room_id: room.id,
    broke_obfuscate: Boolean(result.broke_obfuscate),
  };
}

export function handleMatrixSync(db, syncBody, options = {}) {
  const rooms = matrixRoomMap(db);
  const results = matrixEventsFromSync(syncBody, rooms).map(({ event, room }) =>
    handleMatrixEvent(db, event, room, options)
  );
  return {
    next_batch: syncBody?.next_batch || null,
    processed: results.filter((result) => result.processed).length,
    broke_obfuscate: results.filter((result) => result.broke_obfuscate).length,
    results,
  };
}

async function fetchSync(baseUrl, accessToken, since, options = {}) {
  const url = new URL("/_matrix/client/v3/sync", `${baseUrl}/`);
  url.searchParams.set("timeout", String(options.timeoutMs ?? 0));
  if (since) url.searchParams.set("since", since);

  const response = await (options.fetchImpl || fetch)(url, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`Matrix sync failed: ${response.status} ${response.statusText}`);
  return response.json();
}

export async function pollMatrixEvents(options = {}) {
  const db = options.db || getState();
  const baseUrl = matrixBaseUrl(db, options);
  const tokens = matrixAccessTokens(db, options);
  const state = options.state || createMatrixEventState(options);
  if (!baseUrl) throw new Error("Matrix base URL is required");
  if (!tokens.length) throw new Error("Matrix access token is required");

  const polls = [];
  for (const token of tokens) {
    const since = state.sinceByToken.get(token) || state.since;
    const body = await fetchSync(baseUrl, token, since, options);
    // First sync for a token has no cursor and replays recent room history. Acting on it
    // would re-process old messages (e.g. one sent while still visible) and wrongly break
    // an obfuscation activated afterwards — so only prime the cursor, process nothing.
    const result = since
      ? handleMatrixSync(db, body, { ...options, state })
      : { next_batch: body?.next_batch || null, processed: 0, broke_obfuscate: 0, results: [], primed: true };
    if (body.next_batch) {
      state.sinceByToken.set(token, body.next_batch);
      state.since = body.next_batch;
    }
    polls.push(result);
  }

  return {
    ok: true,
    polls,
    processed: polls.reduce((sum, poll) => sum + poll.processed, 0),
    broke_obfuscate: polls.reduce((sum, poll) => sum + poll.broke_obfuscate, 0),
    state,
  };
}

export function watchMatrixEvents(options = {}) {
  const intervalMs = Number(options.intervalMs ?? process.env.MATRIX_WATCH_INTERVAL_MS ?? 3000);
  const state = options.state || createMatrixEventState(options);
  let stopped = false;
  let timer = null;
  let running = false;

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const result = await pollMatrixEvents({ ...options, state });
      if (options.onPoll) options.onPoll(result);
    } catch (error) {
      if (options.onError) options.onError(error);
      else console.error(error.message);
    } finally {
      running = false;
      if (!stopped) timer = setTimeout(tick, intervalMs);
    }
  };

  timer = setTimeout(tick, options.immediate === false ? intervalMs : 0);
  return {
    state,
    poll: () => pollMatrixEvents({ ...options, state }),
    stop: () => {
      stopped = true;
      clearTimeout(timer);
    },
  };
}

export const createMatrixEventWatcher = watchMatrixEvents;

function selfTest() {
  const db = {
    characters: [{ id: "c", matrix_user_id: "@c:local", display_name: "C" }],
    rooms: [{ id: "elysium", matrix_room_id: "!elysium:local" }],
    room_presence: [{ character_id: "c", room_id: "elysium", obfuscate_level: 2 }],
    auspex_reveals: [{ observer_character_id: "a", hidden_character_id: "c", room_id: "elysium" }],
    event_log: [],
  };
  let saved = false;
  const state = createMatrixEventState();
  const sync = {
    next_batch: "s1",
    rooms: { join: { "!elysium:local": { timeline: { events: [
      { type: "m.room.message", event_id: "$1", sender: "@c:local", content: { msgtype: "m.text", body: "I speak." } },
    ] } } } },
  };

  const result = handleMatrixSync(db, sync, { state, saveState: () => { saved = true; } });
  assert.equal(result.processed, 1);
  assert.equal(result.broke_obfuscate, 1);
  assert.equal(db.room_presence[0].obfuscate_level, 0);
  assert.equal(db.auspex_reveals.length, 0);
  assert.equal(db.event_log[0].event_type, "message_broke_obfuscate");
  assert.equal(db.event_log[0].details.matrix_event_id, "$1");
  assert.equal(saved, true);
  assert.equal(handleMatrixSync(db, sync, { state, saveState: () => {} }).processed, 0);
  return pollSelfTest();
}

async function pollSelfTest() {
  // Initial sync (no since) must only prime the cursor: the historical message from @c:local
  // must NOT break the obfuscation. The follow-up incremental sync must be processed.
  const db = {
    characters: [{ id: "c", matrix_user_id: "@c:local", display_name: "C" }],
    rooms: [{ id: "elysium", matrix_room_id: "!elysium:local" }],
    room_presence: [{ character_id: "c", room_id: "elysium", obfuscate_level: 2 }],
    auspex_reveals: [],
    event_log: [],
  };
  const timeline = (eventId) => ({
    next_batch: eventId === "$old" ? "s1" : "s2",
    rooms: { join: { "!elysium:local": { timeline: { events: [
      { type: "m.room.message", event_id: eventId, sender: "@c:local", content: { msgtype: "m.text", body: "hi" } },
    ] } } } },
  });
  const fetched = [];
  const fetchImpl = async (url) => {
    fetched.push(url.searchParams.get("since"));
    return new Response(JSON.stringify(timeline(fetched.length === 1 ? "$old" : "$new")), { status: 200 });
  };
  const state = createMatrixEventState();
  const options = { db, state, baseUrl: "http://matrix.local", accessToken: "tok", fetchImpl, saveState: () => {} };

  const first = await pollMatrixEvents(options);
  assert.equal(first.processed, 0, "initial sync must not process history");
  assert.equal(db.room_presence[0].obfuscate_level, 2, "initial sync must not break obfuscate");
  assert.equal(state.sinceByToken.get("tok"), "s1", "initial sync primes cursor");

  const second = await pollMatrixEvents(options);
  assert.deepEqual(fetched, [null, "s1"]);
  assert.equal(second.broke_obfuscate, 1, "incremental sync processes new message");
  assert.equal(db.room_presence[0].obfuscate_level, 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await selfTest();
  console.log("matrix-events self-test ok");
}
