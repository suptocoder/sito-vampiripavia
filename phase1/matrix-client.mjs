import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const clientPath = (baseUrl, path) => `${baseUrl.replace(/\/+$/, "")}/_matrix/client/v3${path}`;
const enc = encodeURIComponent;

export function matrixConfigFromEnv(env = process.env) {
  const homeserverUrl = String(env.MATRIX_HOMESERVER || env.MATRIX_BASE_URL || "").replace(/\/+$/, "");
  const accessToken = String(env.MATRIX_ACCESS_TOKEN || env.MATRIX_SERVICE_ACCESS_TOKEN || "");
  const userId = String(env.MATRIX_USER_ID || "");
  const syncEnabled = !["0", "false", "no"].includes(String(env.MATRIX_SYNC_ENABLED || "1").toLowerCase());
  const syncPollMs = Number(env.MATRIX_SYNC_POLL_MS || 3000);
  return {
    configured: Boolean(homeserverUrl),
    homeserverUrl,
    accessToken,
    userId,
    syncEnabled,
    syncPollMs: Number.isFinite(syncPollMs) && syncPollMs > 0 ? syncPollMs : 3000,
  };
}

export class MatrixError extends Error {
  constructor(status, body) {
    super(body?.error || `Matrix request failed (${status})`);
    this.name = "MatrixError";
    this.status = status;
    this.body = body;
  }
}

export function createMatrixClient({ homeserverUrl, accessToken = "", fetchImpl = globalThis.fetch } = {}) {
  if (!homeserverUrl) throw new Error("homeserverUrl is required");
  if (!fetchImpl) throw new Error("fetch is required");

  let token = accessToken;
  let userId = "";
  let since = "";

  async function request(method, path, { body, query, auth = true } = {}) {
    const url = new URL(clientPath(homeserverUrl, path));
    for (const [key, value] of Object.entries(query || {})) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
    }

    const headers = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (auth && token) headers.authorization = `Bearer ${token}`;

    const res = await fetchImpl(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) throw new MatrixError(res.status, data);
    return data;
  }

  async function login(username, password, deviceId) {
    const data = await request("POST", "/login", {
      auth: false,
      body: {
        type: "m.login.password",
        identifier: { type: "m.id.user", user: username },
        password,
        ...(deviceId ? { device_id: deviceId } : {}),
      },
    });
    token = data.access_token || token;
    userId = data.user_id || userId;
    return data;
  }

  async function register(username, password, extra = {}) {
    const body = { username, password, ...extra };
    try {
      const data = await request("POST", "/register", { auth: false, body });
      token = data.access_token || token;
      userId = data.user_id || userId;
      return { ok: true, body: data };
    } catch (error) {
      const canDummyAuth = error instanceof MatrixError
        && error.status === 401
        && error.body?.session
        && error.body?.flows?.some((flow) => flow.stages?.includes("m.login.dummy"));
      if (canDummyAuth) {
        const data = await request("POST", "/register", {
          auth: false,
          body: { ...body, auth: { type: "m.login.dummy", session: error.body.session } },
        });
        token = data.access_token || token;
        userId = data.user_id || userId;
        return { ok: true, body: data };
      }
      if (error instanceof MatrixError && [400, 401, 403].includes(error.status)) {
        return { ok: false, status: error.status, body: error.body };
      }
      throw error;
    }
  }

  const createRoom = (body = {}) => request("POST", "/createRoom", { body });
  const joinRoom = (roomIdOrAlias) => request("POST", `/join/${enc(roomIdOrAlias)}`, { body: {} });
  const resolveRoomAlias = (roomAlias) => request("GET", `/directory/room/${enc(roomAlias)}`);
  const sendMessage = (roomId, message, txnId = `${Date.now()}-${Math.random().toString(36).slice(2)}`) =>
    request("PUT", `/rooms/${enc(roomId)}/send/m.room.message/${enc(txnId)}`, {
      body: typeof message === "string" ? { msgtype: "m.text", body: message } : message,
    });
  const sync = (options = {}) =>
    request("GET", "/sync", { query: { timeout: 0, since, ...options } }).then((data) => {
      since = data.next_batch || since;
      return data;
    });
  const messages = (roomId, options = {}) =>
    request("GET", `/rooms/${enc(roomId)}/messages`, { query: { dir: "b", limit: 20, ...options } });

  return {
    get accessToken() { return token; },
    get userId() { return userId; },
    request,
    login,
    register,
    createRoom,
    joinRoom,
    sendMessage,
    sync,
    messages,
    resolveRoomAlias,
    roomIdByAlias: resolveRoomAlias,
    lookupRoomId: resolveRoomAlias,
  };
}

export default createMatrixClient;

async function selfTest() {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.pathname.endsWith("/login")) {
      return new Response(JSON.stringify({ access_token: "tok", user_id: "@a:local" }), { status: 200 });
    }
    if (url.pathname.endsWith("/register")) {
      return new Response(JSON.stringify({ flows: [] }), { status: 401 });
    }
    return new Response(JSON.stringify({ room_id: "!r:local", next_batch: "s1" }), { status: 200 });
  };

  const client = createMatrixClient({ homeserverUrl: "http://matrix.local/", fetchImpl });
  await client.login("a", "pw");
  assert.equal(client.accessToken, "tok");
  assert.equal((await client.register("b", "pw")).ok, false);
  await client.createRoom({ name: "Elysium" });
  await client.joinRoom("#elysium:local");
  await client.sendMessage("!r:local", "hi", "t1");
  await client.sync();
  await client.messages("!r:local");
  await client.resolveRoomAlias("#elysium:local");
  assert.equal(calls[2].options.headers.authorization, "Bearer tok");
  assert.equal(calls.at(-1).url.pathname, "/_matrix/client/v3/directory/room/%23elysium%3Alocal");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await selfTest();
  console.log("matrix-client self-test ok");
}
