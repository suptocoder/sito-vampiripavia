import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { getState, resetSeed, save } from "./store.mjs";
import { createMatrixClient } from "./matrix-client.mjs";

const port = Number(process.env.PORT || 9877);
const overlayBase = `http://127.0.0.1:${port}`;
const homeserverUrl = (process.env.MATRIX_HOMESERVER || process.env.MATRIX_BASE_URL || "http://localhost:8008").replace(/\/+$/, "");

const requiredCharacters = ["a", "b", "c", "staff"];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class SkipError extends Error {}

function skip(message) {
  throw new SkipError(message);
}

function isMatrixUserId(value) {
  return typeof value === "string" && /^@[^\s:]+:[^\s:]+$/.test(value);
}

function isMatrixRoomId(value) {
  return typeof value === "string" && /^![^\s:]+:[^\s:]+$/.test(value);
}

function hasToken(value) {
  return typeof value === "string" && value.length > 16 && !/\s/.test(value);
}

function requireProvisioned() {
  const db = getState();
  const room = db.rooms.find((row) => row.id === "1");
  if (!room || !isMatrixRoomId(room.matrix_room_id)) {
    skip("phase1/data.json has no real Matrix room id. Run `node .\\phase1\\setup-matrix.mjs` after starting Synapse.");
  }
  for (const id of requiredCharacters) {
    const character = db.characters.find((row) => row.id === id);
    if (!character || !isMatrixUserId(character.matrix_user_id) || !hasToken(character.access_token)) {
      skip(`phase1/data.json has no real Matrix id/token for ${id}. Run \`node .\\phase1\\setup-matrix.mjs\`.`);
    }
  }
  return { db, room };
}

async function api(path, as = "@a:local", options = {}) {
  const url = new URL(path, overlayBase);
  url.searchParams.set("matrix_user_id", as);
  const response = await fetch(url, {
    headers: { "content-type": "application/json", "x-matrix-user-id": as },
    ...options,
  });
  const data = await response.json();
  assert.equal(response.ok, true, `${path} failed: ${JSON.stringify(data)}`);
  return data;
}

async function roster(as) {
  return (await api("/rooms/1/visible-characters", as)).characters;
}

async function validateMatrixTokens(db) {
  for (const id of requiredCharacters) {
    const character = db.characters.find((row) => row.id === id);
    const client = createMatrixClient({ homeserverUrl, accessToken: character.access_token });
    try {
      const whoami = await client.request("GET", "/account/whoami");
      assert.equal(whoami.user_id, character.matrix_user_id, `${id} token belongs to ${whoami.user_id}, not ${character.matrix_user_id}`);
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        skip(`Matrix token for ${character.matrix_user_id} is invalid. Run \`node .\\phase1\\setup-matrix.mjs\`.`);
      }
      throw error;
    }
  }
}

function rosterIds(rows) {
  return rows.map((row) => row.id);
}

async function waitForServer(output) {
  const deadline = Date.now() + 7000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${overlayBase}/health`);
      if (response.ok) return;
    } catch {
      await sleep(150);
    }
  }
  throw new Error(`overlay server did not start\n${output()}`);
}

async function waitUntil(label, fn, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await sleep(500);
  }
  throw new Error(`timed out waiting for ${label}`);
}

function resetRuntimeKeepingMatrix() {
  const current = getState();
  const matrix = {
    characters: Object.fromEntries(current.characters.map((row) => [row.id, {
      matrix_user_id: row.matrix_user_id,
      access_token: row.access_token,
    }])),
    rooms: Object.fromEntries(current.rooms.map((row) => [row.id, { matrix_room_id: row.matrix_room_id }])),
  };
  const db = resetSeed();
  for (const character of db.characters) Object.assign(character, matrix.characters[character.id] || {});
  for (const room of db.rooms) Object.assign(room, matrix.rooms[room.id] || {});
  return save(db);
}

async function main() {
  let db;
  try {
    ({ db } = requireProvisioned());
    const response = await fetch(`${homeserverUrl}/_matrix/client/versions`);
    if (!response.ok) skip(`Matrix homeserver is not ready at ${homeserverUrl}`);
    await validateMatrixTokens(db);
  } catch (error) {
    if (!(error instanceof SkipError)) error = new SkipError(`Matrix homeserver is not reachable at ${homeserverUrl}`);
    console.error(`SKIP: ${error.message}`);
    process.exitCode = 0;
    return;
  }

  db = resetRuntimeKeepingMatrix();
  const room = db.rooms.find((row) => row.id === "1");
  const a = db.characters.find((row) => row.id === "a");
  const b = db.characters.find((row) => row.id === "b");
  const c = db.characters.find((row) => row.id === "c");
  const staff = db.characters.find((row) => row.id === "staff");

  const env = {
    ...process.env,
    PORT: String(port),
    MATRIX_BASE_URL: homeserverUrl,
    MATRIX_ACCESS_TOKEN: a.access_token,
    MATRIX_USER_ID: a.matrix_user_id,
    MATRIX_SYNC_ENABLED: "1",
    MATRIX_SYNC_POLL_MS: "500",
  };
  const server = spawn(process.execPath, ["server.mjs"], {
    cwd: new URL(".", import.meta.url),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  server.stdout.on("data", (chunk) => { output += chunk; });
  server.stderr.on("data", (chunk) => { output += chunk; });

  try {
    await waitForServer(() => output);
    await api("/obfuscate", a.matrix_user_id, { method: "POST" });
    assert.deepEqual(rosterIds(await roster(a.matrix_user_id)), ["a", "b", "c"], "A roster while hidden");
    assert.deepEqual(rosterIds(await roster(b.matrix_user_id)), ["b", "c"], "B roster before Auspex");
    assert.deepEqual(rosterIds(await roster(c.matrix_user_id)), ["b", "c"], "C roster while A hidden");
    assert.equal((await roster(staff.matrix_user_id)).find((row) => row.id === "a").obfuscate_level, 2, "staff sees hidden A");

    assert.deepEqual((await api("/auspex", b.matrix_user_id, { method: "POST" })).revealed, ["a"]);
    assert.equal((await roster(b.matrix_user_id)).find((row) => row.id === "a").revealed_by_auspex, true, "B sees A via Auspex");
    assert.deepEqual(rosterIds(await roster(c.matrix_user_id)), ["b", "c"], "C still cannot see A");

    const client = createMatrixClient({ homeserverUrl, accessToken: a.access_token });
    await client.sendMessage(room.matrix_room_id, `Matrix message breaks Obfuscate ${Date.now()}`);

    await waitUntil("Matrix message break", async () => {
      return rosterIds(await roster(c.matrix_user_id)).includes("a");
    }, 20000);

    assert.deepEqual(rosterIds(await roster(a.matrix_user_id)), ["a", "b", "c"], "A roster after Matrix message");
    assert.deepEqual(rosterIds(await roster(b.matrix_user_id)), ["a", "b", "c"], "B roster after Matrix message");
    assert.deepEqual(rosterIds(await roster(c.matrix_user_id)), ["a", "b", "c"], "C roster after Matrix message");
    assert.equal((await roster(staff.matrix_user_id)).find((row) => row.id === "a").obfuscate_level, 0, "staff sees A unhidden");

    const events = (await api("/staff/events", staff.matrix_user_id)).events;
    assert.equal(events.some((event) => event.event_type === "message_broke_obfuscate" && event.details?.matrix_event_id), true);
    console.log("phase1 real Matrix flow test ok");
  } finally {
    server.kill();
  }
}

main();
