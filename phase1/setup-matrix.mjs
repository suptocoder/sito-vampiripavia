import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resetSeed, save } from "./store.mjs";

const users = [
  ["a", "A"],
  ["b", "B"],
  ["c", "C"],
  ["staff", "Staff"],
];

const config = {
  homeserver: (process.env.MATRIX_HOMESERVER || process.env.MATRIX_BASE_URL || "http://localhost:8008").replace(/\/+$/, ""),
  serverName: process.env.MATRIX_SERVER_NAME || "local",
  password: process.env.MATRIX_DEMO_PASSWORD || process.env.MATRIX_PASSWORD || "vp-demo-password",
  roomAlias: process.env.MATRIX_ROOM_ALIAS || "elysium",
  roomName: process.env.MATRIX_ROOM_NAME || "Elysium",
  roomId: process.env.MATRIX_ROOM_ID || "",
  registrationSecret: process.env.SYNAPSE_REGISTRATION_SHARED_SECRET || "",
};

// One Matrix room per game room, sourced from the seeded room list (legacy stanze).
const seedRooms = JSON.parse(readFileSync(new URL("./seed.json", import.meta.url), "utf8")).rooms;
const rooms = seedRooms.map((room) => ({ id: room.id, alias: `vp-${room.id}`, name: room.name, roomId: "" }));

class MatrixError extends Error {
  constructor(response, body) {
    super(body?.error || `${response.status} ${response.statusText}`);
    this.status = response.status;
    this.errcode = body?.errcode;
    this.body = body;
  }
}

const pathPart = (value) => encodeURIComponent(value);
const userId = (localpart, serverName = config.serverName) => `@${localpart}:${serverName}`;
const serverNameOf = (matrixUserId) => matrixUserId.split(":").slice(1).join(":") || config.serverName;
const roomAliasId = (alias, serverName) => `#${alias}:${serverName}`;

async function matrix(method, path, token, body) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await fetch(`${config.homeserver}${path}`, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (response.ok) return data;
    if (response.status === 429 && attempt < 5) {
      await new Promise((resolve) => setTimeout(resolve, Number(data.retry_after_ms || 1000) + 250));
      continue;
    }
    throw new MatrixError(response, data);
  }
}

async function login(localpart) {
  return matrix("POST", "/_matrix/client/v3/login", "", {
    type: "m.login.password",
    identifier: { type: "m.id.user", user: localpart },
    password: config.password,
    initial_device_display_name: "VP phase1 setup",
  });
}

async function register(localpart) {
  const body = {
    username: localpart,
    password: config.password,
    inhibit_login: false,
    initial_device_display_name: "VP phase1 setup",
  };
  try {
    return await matrix("POST", "/_matrix/client/v3/register", "", body);
  } catch (error) {
    if (error.status !== 401 || !error.body?.session) throw error;
    return matrix("POST", "/_matrix/client/v3/register", "", {
      ...body,
      auth: { type: "m.login.dummy", session: error.body.session },
    });
  }
}

function registrationMac(nonce, localpart) {
  return createHmac("sha1", config.registrationSecret)
    .update(`${nonce}\0${localpart}\0${config.password}\0notadmin`)
    .digest("hex");
}

async function synapseRegister(localpart) {
  const { nonce } = await matrix("GET", "/_synapse/admin/v1/register", "", null);
  const registered = await matrix("POST", "/_synapse/admin/v1/register", "", {
    nonce,
    username: localpart,
    password: config.password,
    admin: false,
    mac: registrationMac(nonce, localpart),
  });
  return registered.access_token ? registered : login(localpart);
}

async function loginOrRegister(localpart) {
  if (config.registrationSecret) {
    try {
      return await synapseRegister(localpart);
    } catch (error) {
      if (error.errcode !== "M_USER_IN_USE") throw error;
    }
  }
  try {
    return await login(localpart);
  } catch (loginError) {
    try {
      return await register(localpart);
    } catch (registerError) {
      if (registerError.errcode === "M_USER_IN_USE") {
        throw new Error(`${userId(localpart)} already exists but MATRIX_DEMO_PASSWORD did not log in`);
      }
      if (registerError.errcode === "M_FORBIDDEN" && config.registrationSecret) return synapseRegister(localpart);
      if (registerError.errcode === "M_FORBIDDEN") {
        throw new Error(`registration is disabled on ${config.homeserver}; enable local registration or pre-create ${userId(localpart)}`);
      }
      throw registerError;
    }
  }
}

async function setDisplayName(account, displayName) {
  await matrix("PUT", `/_matrix/client/v3/profile/${pathPart(account.user_id)}/displayname`, account.access_token, {
    displayname: displayName,
  });
}

async function existingRoomId(token, serverName, alias) {
  try {
    return (await matrix("GET", `/_matrix/client/v3/directory/room/${pathPart(roomAliasId(alias, serverName))}`, token, null)).room_id;
  } catch (error) {
    if (error.errcode === "M_NOT_FOUND") return "";
    throw error;
  }
}

async function createRoom(token, serverName, room) {
  if (room.roomId) return room.roomId;
  const existing = await existingRoomId(token, serverName, room.alias);
  if (existing) return existing;
  try {
    return (
      await matrix("POST", "/_matrix/client/v3/createRoom", token, {
        name: room.name,
        visibility: "public",
        preset: "public_chat",
        room_alias_name: room.alias,
      })
    ).room_id;
  } catch (error) {
    if (error.errcode === "M_ROOM_IN_USE") {
      const roomId = await existingRoomId(token, serverName, room.alias);
      if (roomId) return roomId;
    }
    throw error;
  }
}

async function joinRoom(account, roomId) {
  await matrix("POST", `/_matrix/client/v3/join/${pathPart(roomId)}`, account.access_token, {});
}

function updateStore(accounts, matrixRooms) {
  const db = resetSeed();
  for (const [id] of users) {
    const character = db.characters.find((row) => row.id === id);
    if (!character) throw new Error(`missing character ${id} in phase1 data`);
    character.matrix_user_id = accounts[id].user_id;
    character.access_token = accounts[id].access_token;
  }
  for (const [roomId, matrixRoomId] of Object.entries(matrixRooms)) {
    const room = db.rooms.find((row) => row.id === roomId);
    if (!room) throw new Error(`missing ${roomId} room in phase1 data`);
    room.matrix_room_id = matrixRoomId;
  }
  return save(db);
}

async function main() {
  const accounts = {};
  for (const [localpart, displayName] of users) {
    console.log(`provision: user ${localpart}`);
    accounts[localpart] = await loginOrRegister(localpart);
    await setDisplayName(accounts[localpart], displayName);
  }

  const matrixRooms = {};
  let done = 0;
  for (const room of rooms) {
    matrixRooms[room.id] = await createRoom(accounts.staff.access_token, serverNameOf(accounts.staff.user_id), room);
    for (const [localpart] of users) await joinRoom(accounts[localpart], matrixRooms[room.id]);
    done += 1;
    if (done % 10 === 0 || done === rooms.length) console.log(`provision: rooms ${done}/${rooms.length}`);
  }
  updateStore(accounts, matrixRooms);

  console.log(`wrote phase1 data for ${users.length} users and ${rooms.length} rooms`);
}

function selfTest() {
  assert.equal(userId("a", "local"), "@a:local");
  assert.equal(serverNameOf("@staff:local"), "local");
  assert.equal(pathPart("#elysium:local"), "%23elysium%3Alocal");
  assert.equal(roomAliasId("strada", "local"), "#strada:local");
  const db = {
    characters: users.map(([id]) => ({ id })),
    character_powers: [],
    rooms: [{ id: "elysium" }, { id: "strada" }],
    room_presence: [],
    auspex_reveals: [],
    event_log: [],
  };
  const accounts = Object.fromEntries(users.map(([id]) => [id, { user_id: userId(id), access_token: `${id}-token` }]));
  for (const [id] of users) {
    const character = db.characters.find((row) => row.id === id);
    character.matrix_user_id = accounts[id].user_id;
    character.access_token = accounts[id].access_token;
  }
  for (const [roomId, matrixRoomId] of Object.entries({ elysium: "!room:local", strada: "!strada-room:local" })) {
    db.rooms.find((row) => row.id === roomId).matrix_room_id = matrixRoomId;
  }
  assert.equal(db.characters[3].access_token, "staff-token");
  assert.equal(db.rooms[0].matrix_room_id, "!room:local");
  assert.equal(db.rooms[1].matrix_room_id, "!strada-room:local");
  console.log("setup-matrix self-test ok");
}

// Importable for auto-provisioning (server.mjs); the CLI behavior is unchanged when the
// file is executed directly.
export const provision = main;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) selfTest();
  else main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
