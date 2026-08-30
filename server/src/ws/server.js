'use strict';

/**
 * WebSocket hub per architecture-security.md §1.3.
 *
 * - Path: /ws
 * - Auth: Sec-WebSocket-Protocol subprotocol `bearer.<token>` (primary, per
 *   spec's recommendation — token never lands in access logs/history),
 *   falling back to `?token=` query param (redacted from access logs — see
 *   logger usage in index.js's request logging, which never logs raw query
 *   strings for /ws).
 * - Message envelope: { type, id, payload, timestamp } both directions.
 * - Heartbeat: server sends both a WebSocket protocol ping and the documented
 *   JSON ping every 15s. Either pong keeps the connection alive. Browsers
 *   answer protocol pings without waiting for page JavaScript, which avoids
 *   false timeouts when a tablet throttles a backgrounded page.
 * - Close codes: 4401 invalid/revoked token, 4403 source IP fails LAN check.
 */

const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const HEARTBEAT_INTERVAL_MS = 15_000;
const HEARTBEAT_TIMEOUT_MS = 10_000;
const ALL_CHANNELS = ['status', 'now_playing', 'connection'];
// Minimum spacing between processed pointer_input 'move' messages per
// connection — a touch-drag can emit far faster than a spawned `ydotool`
// process can keep up with; this coalesces to the latest delta rather than
// queuing every event, which is what you want for pointer tracking (the
// intermediate positions don't matter, only catching up to the latest one).
const POINTER_MOVE_MIN_INTERVAL_MS = 16;

function envelope(type, id, payload) {
  return JSON.stringify({ type, id: id ?? null, payload: payload ?? {}, timestamp: new Date().toISOString() });
}

function extractBearerFromProtocols(protocolsHeader) {
  if (!protocolsHeader) return null;
  const protocols = protocolsHeader.split(',').map((p) => p.trim());
  const found = protocols.find((p) => p.startsWith('bearer.'));
  return found ? { token: found.slice('bearer.'.length), matchedProtocol: found } : null;
}

function extractBearerFromQuery(reqUrl) {
  try {
    const url = new URL(reqUrl, 'http://placeholder');
    const token = url.searchParams.get('token');
    return token ? { token } : null;
  } catch {
    return null;
  }
}

class WsHub {
  constructor({ tokenStore, isAddressAllowed, allowedSubnets, limiters, logger, serverVersion, desktopController }) {
    this.tokenStore = tokenStore;
    this.isAddressAllowed = isAddressAllowed;
    this.allowedSubnets = allowedSubnets;
    this.limiters = limiters;
    this.logger = logger;
    this.serverVersion = serverVersion;
    this.desktopController = desktopController;
    this.clients = new Set(); // { ws, tokenId, sessionId, subscriptions, lastPongAt, pingTimer }

    this.wss = new WebSocketServer({
      noServer: true,
      handleProtocols: (protocols) => {
        for (const p of protocols) {
          if (p.startsWith('bearer.')) return p;
        }
        return false;
      },
    });
  }

  /** Attach the /ws upgrade handler to an additional http.Server (one per bound LAN interface). */
  attach(server) {
    server.on('upgrade', (req, socket, head) => this._handleUpgrade(req, socket, head));
  }

  _handleUpgrade(req, socket, head) {
    const { pathname } = new URL(req.url, 'http://placeholder');
    if (pathname !== '/ws') {
      socket.destroy();
      return;
    }

    const remoteAddress = socket.remoteAddress;
    const rl = this.limiters.wsReconnect.check(remoteAddress || 'unknown');
    if (!rl.allowed) {
      this.logger.warn('ws upgrade rejected: rate limited', { source_ip: remoteAddress });
      socket.write('HTTP/1.1 429 Too Many Requests\r\nRetry-After: ' + rl.retryAfterSeconds + '\r\n\r\n');
      socket.destroy();
      return;
    }

    if (!this.isAddressAllowed(remoteAddress, this.allowedSubnets)) {
      this.logger.warn('ws upgrade rejected: source IP not allowed', { source_ip: remoteAddress });
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    const fromProto = extractBearerFromProtocols(req.headers['sec-websocket-protocol']);
    const fromQuery = fromProto ? null : extractBearerFromQuery(req.url);
    const token = fromProto?.token || fromQuery?.token || null;
    const record = this.tokenStore.verify(token);

    this.wss.handleUpgrade(req, socket, head, (ws) => {
      if (!record) {
        this.logger.warn('ws connection rejected: invalid/missing token', { source_ip: remoteAddress });
        ws.close(4401, 'invalid_token');
        return;
      }
      this.tokenStore.touch(record.token_id);
      this._acceptConnection(ws, record, remoteAddress);
    });
  }

  _acceptConnection(ws, record, remoteAddress) {
    const client = {
      ws,
      tokenId: record.token_id,
      sessionId: crypto.randomUUID(),
      subscriptions: new Set(ALL_CHANNELS),
      lastPongAt: Date.now(),
      pingTimer: null,
      awaitingPong: false,
      lastPointerMoveAt: 0,
      lastPointerErrorAt: 0,
      lastKeyboardErrorAt: 0,
    };
    this.clients.add(client);
    this.logger.info('ws connected', { token_id: client.tokenId, session_id: client.sessionId, source_ip: remoteAddress });

    ws.send(envelope('hello', null, { server_version: this.serverVersion, session_id: client.sessionId }));

    ws.on('message', (data) => this._handleMessage(client, data));
    ws.on('pong', () => this._markAlive(client));
    ws.on('close', () => {
      clearInterval(client.pingTimer);
      clearTimeout(client.pongDeadline);
      this.clients.delete(client);
      this.logger.info('ws disconnected', { token_id: client.tokenId, session_id: client.sessionId });
    });
    ws.on('error', (err) => {
      this.logger.warn('ws error', { token_id: client.tokenId, error: err.message });
    });

    client.pingTimer = setInterval(() => this._heartbeatTick(client), HEARTBEAT_INTERVAL_MS);
  }

  _heartbeatTick(client) {
    // Re-check token validity each cycle so revocation takes effect within
    // one heartbeat interval, per architecture-security.md §2.5.
    if (!this.tokenStore.get(client.tokenId)) {
      this.logger.info('ws closing: token revoked', { token_id: client.tokenId });
      client.ws.close(4401, 'token_revoked');
      return;
    }

    if (client.awaitingPong) {
      // Previous ping never got a pong in time — stale connection.
      this.logger.info('ws closing: heartbeat timeout', { token_id: client.tokenId, session_id: client.sessionId });
      client.ws.terminate();
      return;
    }

    if (client.ws.readyState !== 1) return;

    client.awaitingPong = true;
    client.pongDeadline = setTimeout(() => {
      if (client.awaitingPong) {
        this.logger.info('ws closing: pong not received in time', {
          token_id: client.tokenId,
          session_id: client.sessionId,
        });
        client.ws.terminate();
      }
    }, HEARTBEAT_TIMEOUT_MS);
    // Browser WebSocket implementations automatically answer protocol ping
    // frames even when timers/message handlers in the page are throttled.
    client.ws.ping();
    // Keep the application heartbeat for protocol compatibility and for
    // non-browser clients which already implement the documented envelope.
    client.ws.send(envelope('ping', null, {}));
  }

  _markAlive(client) {
    client.awaitingPong = false;
    client.lastPongAt = Date.now();
    clearTimeout(client.pongDeadline);
  }

  _handleMessage(client, data) {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      client.ws.send(envelope('error', null, { code: 'BAD_MESSAGE', message: 'Message was not valid JSON.' }));
      return;
    }
    if (!msg || typeof msg.type !== 'string') {
      client.ws.send(envelope('error', null, { code: 'BAD_MESSAGE', message: 'Missing message type.' }));
      return;
    }

    switch (msg.type) {
      case 'pong':
        this._markAlive(client);
        break;
      case 'subscribe': {
        const channels = Array.isArray(msg.payload?.channels) ? msg.payload.channels : ALL_CHANNELS;
        const valid = channels.filter((c) => ALL_CHANNELS.includes(c));
        client.subscriptions = new Set(valid.length ? valid : ALL_CHANNELS);
        break;
      }
      case 'pointer_input':
        this._handlePointerInput(client, msg.payload || {});
        break;
      case 'keyboard_input':
        this._handleKeyboardInput(client, msg.payload || {});
        break;
      default:
        client.ws.send(envelope('error', null, { code: 'UNKNOWN_MESSAGE_TYPE', message: `Unknown message type '${msg.type}'` }));
    }
  }

  /**
   * Trackpad input from the tablet — architecture-security.md §1.1's own
   * split rationale ("continuous/high-frequency → WS, not REST") applies
   * directly to move/scroll; click is low-frequency but kept on the same
   * channel so ordering with in-flight moves is preserved. Never resolves
   * per-event (that would be far too chatty for a touch-drag) — errors are
   * surfaced at most once every few seconds via a WS `error` push so a
   * missing `ydotool` shows one toast, not a flood.
   */
  _handlePointerInput(client, payload) {
    if (!this.desktopController) return;
    const { action } = payload;
    const report = (err) => {
      const now = Date.now();
      if (now - client.lastPointerErrorAt < 4000) return;
      client.lastPointerErrorAt = now;
      client.ws.send(envelope('error', null, { code: 'POINTER_INPUT_FAILED', message: err.message }));
    };

    if (action === 'move') {
      const now = Date.now();
      if (now - client.lastPointerMoveAt < POINTER_MOVE_MIN_INTERVAL_MS) return;
      client.lastPointerMoveAt = now;
      const dx = Number(payload.dx) || 0;
      const dy = Number(payload.dy) || 0;
      if (!dx && !dy) return;
      this.desktopController.moveCursor({ dx, dy }).catch(report);
    } else if (action === 'click') {
      this.desktopController.click({ button: payload.button === 'right' ? 'right' : payload.button === 'middle' ? 'middle' : 'left' }).catch(report);
    } else if (action === 'scroll') {
      this.desktopController.scroll({ dy: Number(payload.dy) || 0 }).catch(report);
    } else {
      client.ws.send(envelope('error', null, { code: 'BAD_MESSAGE', message: `Unknown pointer_input action '${action}'` }));
    }
  }

  /**
   * Virtual keyboard input from the tablet. Same fire-and-forget shape as
   * pointer_input and the same reasoning for why: a run of typed characters
   * is a continuous stream of low-consequence-per-event actions, not a
   * discrete command needing a result per keystroke. `type` carries literal
   * text (letters/digits/punctuation/space); `key` carries a symbolic name
   * from the server's fixed allowlist (see desktop.js SPECIAL_KEYS) — never
   * a raw keycode or arbitrary key combo from the client.
   */
  _handleKeyboardInput(client, payload) {
    if (!this.desktopController) return;
    const { action } = payload;
    const report = (err) => {
      const now = Date.now();
      if (now - client.lastKeyboardErrorAt < 4000) return;
      client.lastKeyboardErrorAt = now;
      client.ws.send(envelope('error', null, { code: 'KEYBOARD_INPUT_FAILED', message: err.message }));
    };

    if (action === 'type') {
      const text = typeof payload.text === 'string' ? payload.text.slice(0, 500) : '';
      if (!text) return;
      this.desktopController.typeText(text).catch(report);
    } else if (action === 'key') {
      this.desktopController.pressKey(String(payload.key || '')).catch(report);
    } else {
      client.ws.send(envelope('error', null, { code: 'BAD_MESSAGE', message: `Unknown keyboard_input action '${action}'` }));
    }
  }

  _broadcast(channel, type, payload) {
    for (const client of this.clients) {
      if (client.ws.readyState !== 1) continue;
      if (!client.subscriptions.has(channel)) continue;
      client.ws.send(envelope(type, null, payload));
    }
  }

  pushStatusUpdate(payload) {
    this._broadcast('status', 'status_update', payload);
  }

  pushNowPlayingUpdate(payload) {
    this._broadcast('now_playing', 'now_playing_update', payload);
  }

  pushConnectionStatus(payload) {
    this._broadcast('connection', 'connection_status', payload);
  }

  /** Push a command_result to the connection(s) belonging to the originating token. */
  pushCommandResult(tokenId, commandId, result) {
    for (const client of this.clients) {
      if (client.tokenId !== tokenId) continue;
      if (client.ws.readyState !== 1) continue;
      client.ws.send(envelope('command_result', commandId, result));
    }
  }
}

module.exports = { WsHub, envelope };
