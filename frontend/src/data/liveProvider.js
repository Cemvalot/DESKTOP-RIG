// frontend/src/data/liveProvider.js
//
// Real HTTP + WebSocket implementation of the provider contract, matching
// docs/architecture-security.md exactly: REST paths under /api/v1, the WS
// message envelope, bearer-token auth (Sec-WebSocket-Protocol subprotocol
// per §1.3's recommendation), the two-step dangerous-command confirmation
// flow (§5), and exponential-backoff reconnect (§1.3).
//
// This file contains ZERO Windows-specific logic — it only ever sends the
// abstract command shapes the server allowlists.

import { Channel, ProviderError } from "./provider.js";

const TOKEN_KEY = "launchpad.token";
const TOKEN_ID_KEY = "launchpad.token_id";
// Dev convenience: override the server origin (e.g. "http://192.168.1.42:8787")
// when the frontend isn't served by the same Node process as the API.
const BASE_KEY = "launchpad.serverBase";

function getBase() {
  return localStorage.getItem(BASE_KEY) || "";
}
export function setServerBase(base) {
  if (base) localStorage.setItem(BASE_KEY, base);
  else localStorage.removeItem(BASE_KEY);
}

function getToken() {
  return localStorage.getItem(TOKEN_KEY) || null;
}
function setToken(token, tokenId) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
    if (tokenId) localStorage.setItem(TOKEN_ID_KEY, tokenId);
  } else {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_ID_KEY);
  }
}

// Fix for docs/test-report.md Bug #1: a stale/invalid token used to leave
// the app stuck in an infinite WS-reconnect loop (backoff kept getting
// reset by the open->4401-close flicker) instead of returning to the
// pairing screen. This is the single place that decides "the server has
// rejected our session, stop retrying and clear it" — called from both the
// REST 401 path and the WS 4401/4403 close path so there's one source of
// truth instead of two independent guesses.
const authInvalidChan = new Channel();
let authAlreadyInvalidated = false;
function invalidateAuth() {
  if (authAlreadyInvalidated) return; // avoid duplicate emits from both REST+WS firing close together
  authAlreadyInvalidated = true;
  setToken(null);
  authInvalidChan.emit();
}

function wsUrl(token) {
  const base = getBase();
  let origin;
  if (base) {
    origin = base.replace(/^http/, "ws");
  } else {
    origin = (location.protocol === "https:" ? "wss://" : "ws://") + location.host;
  }
  return `${origin}/ws`;
}

const PC_NAME_KEY = "launchpad.pcName";

// /health is unauthenticated and root-level (not under /api/v1), so this
// bypasses apiFetch deliberately. Never throws — always resolves to a name.
async function fetchAndCachePcName() {
  try {
    const res = await fetch(`${getBase()}/health`);
    const data = await res.json();
    if (data && typeof data.pc_name === "string" && data.pc_name) {
      localStorage.setItem(PC_NAME_KEY, data.pc_name);
      return data.pc_name;
    }
  } catch (_) {
    /* offline/unreachable — fall through to cached value */
  }
  return localStorage.getItem(PC_NAME_KEY) || "PC";
}

async function apiFetch(path, { method = "GET", body, auth = true } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth) {
    const token = getToken();
    if (!token) throw new ProviderError("NO_TOKEN", "Device is not paired.", 401);
    headers.Authorization = `Bearer ${token}`;
  }
  let res;
  try {
    res = await fetch(`${getBase()}/api/v1${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new ProviderError("NETWORK_ERROR", err.message || "Network request failed.");
  }
  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    /* empty body is fine for some responses */
  }
  if (!res.ok) {
    const errInfo = data && data.error ? data.error : {};
    if (res.status === 401 && auth) {
      // The token we sent was rejected — not "no token", an actively bad
      // one (revoked/unknown/state lost). Stop treating this as a retryable
      // network hiccup; tell the app to re-pair. See invalidateAuth() above.
      invalidateAuth();
    }
    throw new ProviderError(errInfo.code || `HTTP_${res.status}`, errInfo.message || res.statusText, res.status);
  }
  return data;
}

export function createLiveProvider() {
  const statusChan = new Channel();
  const nowPlayingChan = new Channel();
  const connectionChan = new Channel();
  const commandResultChan = new Channel();
  const desktopErrorChan = new Channel();

  let ws = null;
  let wsExplicitlyClosed = false;
  let backoffMs = 1000;
  const BACKOFF_MAX = 30000;
  let reconnectTimer = null;
  let pongTimeoutTimer = null;
  let lastConnectedAt = null;
  let destroyed = false;

  function setConnectionState(state) {
    connectionChan.emit({ state, lastConnectedAt });
  }

  function scheduleReconnect() {
    if (destroyed || wsExplicitlyClosed) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX);
      connectWs();
    }, backoffMs);
  }

  function connectWs() {
    if (destroyed) return;
    const token = getToken();
    if (!token) {
      setConnectionState("offline");
      return;
    }
    setConnectionState(backoffMs > 1000 ? "reconnecting" : "reconnecting");
    try {
      ws = new WebSocket(wsUrl(), [`bearer.${token}`]);
    } catch (err) {
      scheduleReconnect();
      return;
    }

    ws.addEventListener("open", () => {
      backoffMs = 1000;
      lastConnectedAt = new Date().toISOString();
      setConnectionState("connected");
    });

    ws.addEventListener("message", (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch (_) {
        return;
      }
      handleWsMessage(msg);
    });

    ws.addEventListener("close", (event) => {
      clearTimeout(pongTimeoutTimer);
      if (wsExplicitlyClosed) return;
      if (event.code === 4401 || event.code === 4403) {
        // Server rejected our token/origin at the WS layer — this is not a
        // transient drop, retrying will just fail identically forever
        // (and previously did, tripping the WS reconnect rate limit — see
        // Bug #1). Stop reconnecting and surface the pairing gate instead.
        wsExplicitlyClosed = true;
        clearTimeout(reconnectTimer);
        setConnectionState("offline");
        invalidateAuth();
        return;
      }
      setConnectionState("reconnecting");
      scheduleReconnect();
    });

    ws.addEventListener("error", () => {
      // 'close' will follow; nothing extra to do here.
    });
  }

  function send(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }

  function handleWsMessage(msg) {
    switch (msg.type) {
      case "hello":
        break;
      case "status_update":
        statusChan.emit(msg.payload);
        break;
      case "now_playing_update":
        nowPlayingChan.emit(msg.payload);
        break;
      case "connection_status":
        // PC's own network state — surfaced alongside WS link state via a
        // separate emit so the status strip can show both if desired.
        connectionChan.emit({ state: "connected", lastConnectedAt, pc: msg.payload });
        break;
      case "command_result":
        commandResultChan.emit(msg.payload);
        break;
      case "ping":
        send({ type: "pong", id: null, payload: {}, timestamp: new Date().toISOString() });
        break;
      case "error":
        if (msg.payload?.code === "POINTER_INPUT_FAILED" || msg.payload?.code === "KEYBOARD_INPUT_FAILED") {
          desktopErrorChan.emit(msg.payload);
        } else {
          console.warn("[liveProvider] server error message", msg.payload);
        }
        break;
      default:
        break;
    }
  }

  return {
    async init() {
      wsExplicitlyClosed = false;
      if (getToken()) connectWs();
      else setConnectionState("offline");
    },

    isPaired() {
      return !!getToken();
    },

    async pair(code, deviceName) {
      const data = await apiFetch("/pairing/claim", {
        method: "POST",
        auth: false,
        body: { pairing_code: code, device_name: deviceName || navigator.userAgent },
      });
      setToken(data.token, data.token_id);
      authAlreadyInvalidated = false; // fresh session — allow future invalidation to fire again
      backoffMs = 1000;
      wsExplicitlyClosed = false;
      connectWs();
      // Lead reconciliation fix: /health now carries pc_name (see
      // docs/reconciliation.md §5). Best-effort refresh, never blocks pairing.
      fetchAndCachePcName();
      return data;
    },

    async revoke(tokenId = null) {
      const body = tokenId ? { token_id: tokenId } : {};
      const data = await apiFetch("/auth/revoke", { method: "POST", body });
      if (!tokenId) {
        setToken(null);
        wsExplicitlyClosed = true;
        if (ws) ws.close();
        setConnectionState("offline");
      }
      return data;
    },

    async getPcName() {
      // /health now carries pc_name (added per docs/reconciliation.md §5,
      // closing the gap flagged in frontend-notes.md #3). Try a fresh
      // fetch first (cheap, unauthenticated), fall back to the last cached
      // value or "PC" if the PC is unreachable.
      return fetchAndCachePcName();
    },

    async getStatus() {
      return apiFetch("/status");
    },
    subscribeStatus(cb) {
      return statusChan.subscribe(cb);
    },

    async getNowPlaying() {
      return apiFetch("/media/now-playing");
    },
    subscribeNowPlaying(cb) {
      return nowPlayingChan.subscribe(cb);
    },

    subscribeConnection(cb) {
      return connectionChan.subscribe(cb);
    },
    subscribeCommandResult(cb) {
      return commandResultChan.subscribe(cb);
    },
    subscribeAuthInvalid(cb) {
      return authInvalidChan.subscribe(cb);
    },

    async getApps() {
      return (await apiFetch("/config/apps")).apps;
    },
    async getLinks() {
      return (await apiFetch("/config/links")).links;
    },
    async getMaintenanceCommands() {
      return (await apiFetch("/config/maintenance")).commands;
    },
    async getGames() {
      // Not in the architecture-security.md endpoint table; assumed to
      // follow the same /config/* convention as apps/links/maintenance.
      // Flagged as an assumption for the lead/server subagent to confirm.
      return apiFetch("/config/games");
    },
    async getSmartHomeConfig() {
      // Smart Home is a disabled placeholder module in v1 (no live HA
      // integration); served the same way as other config, expected to
      // always come back with connected:false until the HA module ships.
      return apiFetch("/config/smarthome");
    },

    async executeCommand(cmd) {
      return apiFetch("/commands/execute", { method: "POST", body: cmd });
    },

    async confirmCommand(confirmToken) {
      return apiFetch("/commands/confirm", { method: "POST", body: { confirm_token: confirmToken } });
    },

    async mediaControl(action) {
      return apiFetch("/media/control", { method: "POST", body: { action } });
    },

    async setVolume(opts) {
      return apiFetch("/media/volume", { method: "POST", body: opts });
    },

    async setMic(opts) {
      return apiFetch("/media/mic", { method: "POST", body: opts });
    },

    async getCommandHistory() {
      // Server's actual response key is `history` (server/src/routes/commands.js),
      // not `commands` — fixes docs/test-report.md Bug #2, where this always
      // fell through to returning the whole response object instead of an array.
      const data = await apiFetch("/commands/history");
      return data.history || [];
    },

    async clearCommandHistory() {
      return apiFetch("/commands/history", { method: "DELETE" });
    },

    async wol() {
      return apiFetch("/wol", { method: "POST", body: {} });
    },

    subscribeDesktopError(cb) {
      return desktopErrorChan.subscribe(cb);
    },
    sendPointerInput(payload) {
      send({ type: "pointer_input", id: null, payload, timestamp: new Date().toISOString() });
    },
    sendKeyboardInput(payload) {
      send({ type: "keyboard_input", id: null, payload, timestamp: new Date().toISOString() });
    },

    destroy() {
      destroyed = true;
      wsExplicitlyClosed = true;
      clearTimeout(reconnectTimer);
      clearTimeout(pongTimeoutTimer);
      if (ws) ws.close();
      statusChan.clear();
      nowPlayingChan.clear();
      connectionChan.clear();
      commandResultChan.clear();
      desktopErrorChan.clear();
    },
  };
}
