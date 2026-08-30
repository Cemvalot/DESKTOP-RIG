// frontend/src/data/provider.js
//
// The single contract every part of the UI is allowed to talk to for PC
// communication. Screens/components must NEVER call fetch()/WebSocket
// directly and must NEVER contain OS-specific logic — that is entirely the
// server's job. They only ever call methods on the active provider returned
// by `getProvider()` in `./index.js`.
//
// Two concrete implementations exist behind this shape:
//   - mockProvider.js  (deterministic fake data, default/active with zero server)
//   - liveProvider.js  (real fetch/WebSocket calls against architecture-security.md)
//
// Every provider method below MUST be implemented by both. Methods that
// return live-updating data via push (status, now playing, connection
// health, command results) are exposed as subscribe*(cb) -> unsubscribe().
//
// ── Provider interface (JSDoc contract, not enforced at runtime) ──────────
//
// async init(): Promise<void>
//   Called once at app startup. Load stored token (live) / seed rng (mock).
//
// isPaired(): boolean
//   Whether a usable auth token/session exists right now.
//
// async pair(code, deviceName): Promise<{ token, token_id, expires_at }>
//   POST /api/v1/pairing/claim equivalent. Throws ProviderError on failure.
//
// async revoke(tokenId=null): Promise<{ revoked: true }>
//   POST /api/v1/auth/revoke equivalent (also used for "log out this device").
//
// async getStatus(): Promise<SystemStatus>
//   One-shot GET /api/v1/status equivalent.
//
// subscribeStatus(cb): unsubscribe()
//   cb(SystemStatus) on every push (WS status_update, or a simulated timer).
//
// async getNowPlaying(): Promise<NowPlaying>
// subscribeNowPlaying(cb): unsubscribe()
//
// subscribeConnection(cb): unsubscribe()
//   cb({ state: 'connected'|'reconnecting'|'offline', lastConnectedAt }) —
//   drives the connection-lost/reconnecting overlay and status-strip badge.
//
// subscribeCommandResult(cb): unsubscribe()
//   cb({ command_id, status, message }) — async resolution pushed over WS.
//
// subscribeAuthInvalid(cb): unsubscribe()
//   cb() fires when the provider discovers the current session is no longer
//   valid (a REST call 401s, or the WS closes with 4401/4403) — added per
//   docs/test-report.md Bug #1. The provider clears its own stored token
//   before emitting, so isPaired() is already false by the time cb() runs;
//   the caller's job is just to re-show the pairing UI. Never fires spontaneously
//   for a transient network drop (that's subscribeConnection's 'reconnecting'
//   state) — only for a session the server has explicitly rejected.
//
// async getApps(): Promise<AppEntry[]>
// async getLinks(): Promise<LinkEntry[]>
// async getMaintenanceCommands(): Promise<MaintenanceEntry[]>
// async getGames(): Promise<{ library, recentlyPlayed, favorites }>
// async getSmartHomeConfig(): Promise<SmartHomeConfig>
//   Config-driven presentation data. Live provider hits /api/v1/config/*;
//   mock provider serves the bundled seed/*.json fallback data.
//
// async executeCommand(cmd): Promise<CommandAccepted | ConfirmationRequired>
//   POST /api/v1/commands/execute equivalent. `cmd` is one of the abstract
//   shapes from architecture-security.md §4 / reconciliation.md §2:
//     { type: 'launch_app', app_id }
//     { type: 'launch_game', steam_app_id }
//     { type: 'open_link', link_id }
//     { type: 'power_action', action: 'lock'|'sleep'|'restart'|'shutdown' }
//     { type: 'maintenance', task_id }
//   Never anything else — no raw paths/strings ever leave the frontend.
//
// async confirmCommand(confirmToken): Promise<CommandAccepted>
//   POST /api/v1/commands/confirm equivalent.
//
// async mediaControl(action): Promise<{ accepted, id }>
//   action: 'play'|'pause'|'next'|'previous'|'stop'|'toggle'
//
// async setVolume({ level } | { mute }): Promise<{ level, muted }>
// async setMic({ mute }): Promise<{ muted }>
//
// async getCommandHistory(): Promise<CommandHistoryEntry[]>
// async clearCommandHistory(): Promise<{ cleared: number }>
//
// async wol(): Promise<{ sent: true }>
//   POST /api/v1/wol equivalent (Wake-on-LAN magic packet).
//
// ── Virtual keyboard / trackpad (architecture-security.md §11) ────────────
//
// subscribeDesktopError(cb): unsubscribe()
//   cb({ code, message }) when a pointer_input/keyboard_input action fails
//   server-side (e.g. ydotool not installed) — rate-limited server-side to
//   at most one push every few seconds per action type so a bad drag or a
//   burst of typing doesn't flood toasts.
//
// sendPointerInput({ action: 'move'|'click'|'scroll', dx?, dy?, button? }): void
//   Fire-and-forget (WS send, no response correlation — see
//   architecture-security.md §1.1's continuous/high-frequency-over-WS
//   rationale, same reasoning as status_update). 'move' takes relative
//   dx/dy touch deltas; 'click' takes button: 'left'|'right'|'middle';
//   'scroll' takes dy. Never sends anything if the WS isn't connected.
//
// sendKeyboardInput({ action: 'type'|'key', text?, key? }): void
//   Fire-and-forget, same shape as sendPointerInput. 'type' sends literal
//   text (letters/digits/punctuation/space) the server types via the OS
//   input layer; 'key' sends a symbolic non-printable key name (e.g.
//   'Enter', 'Backspace', 'ArrowLeft') from the server's fixed allowlist —
//   never a raw keycode.
//
// async getPcName(): Promise<string>
//
// destroy(): void
//   Tear down sockets/timers (used when switching mock<->live in Settings).
//
// ── Shared error type ──────────────────────────────────────────────────────

export class ProviderError extends Error {
  constructor(code, message, status = null) {
    super(message || code);
    this.name = "ProviderError";
    this.code = code;
    this.status = status;
  }
}

// ── Tiny pub/sub helper shared by both provider implementations ───────────

export class Channel {
  constructor() {
    this._subs = new Set();
  }
  subscribe(cb) {
    this._subs.add(cb);
    return () => this._subs.delete(cb);
  }
  emit(payload) {
    for (const cb of this._subs) {
      try {
        cb(payload);
      } catch (err) {
        console.error("[Channel] subscriber threw", err);
      }
    }
  }
  clear() {
    this._subs.clear();
  }
}

export const COMMAND_TYPES = Object.freeze({
  LAUNCH_APP: "launch_app",
  LAUNCH_GAME: "launch_game",
  OPEN_LINK: "open_link",
  MEDIA_CONTROL: "media_control",
  VOLUME_SET: "volume_set",
  MIC_MUTE: "mic_mute",
  POWER_ACTION: "power_action",
  MAINTENANCE: "maintenance",
});
