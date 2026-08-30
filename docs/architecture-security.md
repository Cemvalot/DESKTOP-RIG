# Launchpad — PC Service Architecture & Security Spec

Status: DESIGN — this is the implementation contract for the Node.js (Express + `ws`) PC
control service and the tablet frontend that talks to it. No implementation code exists yet;
this document is authoritative for endpoint shapes, message schemas, auth, and command
semantics. The frontend/server implementers should not deviate from this without updating
this file first.

Scope reminder: LAN-only, single trusted household network, one Windows PC, one Samsung Tab A8
kiosk client. No internet exposure. No arbitrary command execution from the tablet, ever.

---

## Table of contents

1. [Transport](#1-transport)
2. [Authentication / pairing](#2-authentication--pairing)
3. [Network binding](#3-network-binding)
4. [Command model — allowlist, not shell exec](#4-command-model--allowlist-not-shell-exec)
5. [Dangerous-command confirmation](#5-dangerous-command-confirmation)
6. [Rate limiting & logging](#6-rate-limiting--logging)
7. [Secrets handling](#7-secrets-handling)
8. [System stats reporting](#8-system-stats-reporting)
9. [Auto-start on Windows](#9-auto-start-on-windows)
10. [Threat model summary](#10-threat-model-summary)

---

## 1. Transport

### 1.1 Split: HTTP REST + WebSocket, justified

- **HTTP REST** is used for everything that is a discrete, client-initiated action with a
  clear request/response pairing: issuing a command, confirming a dangerous command, pairing,
  token management, fetching the allowlist/config, fetching a one-shot stats snapshot. HTTP
  gives us: standard status codes, easy per-route rate limiting/middleware, statelessness
  (survives tablet Wi-Fi hiccups without needing reconnect logic for the *command* path), and
  it's trivial to reason about and log per request.
- **WebSocket** is used for everything that is server-initiated / continuous / high-frequency:
  live system stats push (CPU/GPU/RAM/temp/network, ~1x/sec), now-playing/media session
  changes, and asynchronous command result notification for commands that don't resolve
  synchronously (e.g. an app launch that takes a moment, or a dangerous command's execution
  after confirmation). Polling this over HTTP would waste battery/bandwidth on a 3GB-RAM
  Android tablet and add latency to the "live dashboard" feel the UI needs.
- The WebSocket connection is **not** used to carry the initial command (that stays HTTP POST,
  so it has a clean request/response and status code, and so command issuance can be
  rate-limited independently of the socket's lifecycle). The WS channel is used to push the
  *result* / status updates asynchronously, keyed by a command `id` shared with the HTTP
  response, so the client can correlate.

### 1.2 REST endpoint list

All paths are prefixed with `/api/v1`. All require `Authorization: Bearer <token>` unless
marked **(pairing)**, which is a special unauthenticated-but-token-gated flow (see §2).

| Method | Path | Auth | Request body | Response body | Status codes |
|---|---|---|---|---|---|
| POST | `/pairing/claim` | pairing code (not bearer) | `{ "pairing_code": "string", "device_name": "string" }` | `{ "token": "string", "token_id": "string", "expires_at": null }` | 200, 400, 401, 410, 429 |
| POST | `/auth/revoke` | Bearer | `{ "token_id": "string" }` (omit to revoke self) | `{ "revoked": true }` | 200, 401, 403, 404 |
| GET | `/auth/tokens` | Bearer (PC-console only, see note) | — | `{ "tokens": [ { "token_id", "device_name", "created_at", "last_seen_at" } ] }` | 200, 401, 403 |
| GET | `/status` | Bearer | — | `SystemStatus` object (see §8) | 200, 401 |
| GET | `/config/apps` | Bearer | — | `{ "apps": [AppEntry...] }` | 200, 401 |
| GET | `/config/links` | Bearer | — | `{ "links": [LinkEntry...] }` | 200, 401 |
| GET | `/config/maintenance` | Bearer | — | `{ "commands": [MaintenanceEntry...] }` | 200, 401 |
| POST | `/commands/execute` | Bearer | `CommandRequest` (see §4) | `CommandAccepted` \| `ConfirmationRequired` (see §5) | 200, 202, 400, 401, 403, 404, 409, 429 |
| POST | `/commands/confirm` | Bearer | `{ "confirm_token": "string" }` | `CommandAccepted` | 200, 400, 401, 403, 404, 409, 429 |
| POST | `/media/control` | Bearer | `{ "action": "play\|pause\|next\|previous\|stop\|toggle" }` | `{ "accepted": true, "id": "string" }` | 200, 400, 401, 429 |
| POST | `/media/volume` | Bearer | `{ "level": 0-100 }` OR `{ "mute": true\|false }` | `{ "level": number, "muted": boolean }` | 200, 400, 401, 429 |
| POST | `/media/mic` | Bearer | `{ "mute": true\|false }` | `{ "muted": boolean }` | 200, 400, 401, 429 |
| GET | `/media/now-playing` | Bearer | — | `NowPlaying` object (see §1.3) | 200, 401 |
| GET | `/health` | none | — | `{ "status": "ok", "version": "string" }` | 200 |

Notes:
- `GET /health` is deliberately unauthenticated and reveals nothing sensitive (no hostname,
  no IP, no config) — it exists purely so the tablet can cheaply detect "is the service up
  and reachable" before attempting pairing/reconnect, and so LAN discovery/troubleshooting
  doesn't require a token.
- `GET /auth/tokens` is intended to be exposed only via a local PC-side admin view (e.g. a
  system-tray UI on the PC itself), not the tablet UI. It's still bearer-gated in case the
  tablet UI ever grows a "manage paired devices" screen, but the primary revocation path is
  the PC tray app calling `localhost`.
- Standard error body shape for all 4xx/5xx: `{ "error": { "code": "string", "message": "string" } }`.
  `code` is a stable machine-readable string (e.g. `INVALID_TOKEN`, `UNKNOWN_APP_ID`,
  `RATE_LIMITED`, `CONFIRMATION_EXPIRED`) the frontend can switch on without parsing prose.

### 1.3 WebSocket

- Path: `wss://<pc-ip>:<port>/ws` (or `ws://` if TLS is not configured — see §3.4 on TLS).
- Auth: token passed as a query param on the upgrade request, `?token=<bearer>`
  (WebSocket upgrade requests cannot carry custom headers from browser `WebSocket` API), OR
  via a `Sec-WebSocket-Protocol` subprotocol carrying the token if the implementer prefers to
  avoid tokens in URLs/logs. **Recommendation: use the `Sec-WebSocket-Protocol` header
  approach** (`new WebSocket(url, ["bearer." + token])`) so the token never lands in server
  access logs or browser history — the server validates it during the upgrade handshake and
  before accepting the connection. If that proves awkward to implement, the query-param
  fallback is acceptable given LAN-only exposure, but access logs must then redact the query
  string (see §6).
- One WS connection per tablet session. Server closes with code `4401` if the token is
  invalid/revoked, and `4403` if the peer's source IP fails the LAN-subnet check (§3).
- Heartbeat: server sends a WebSocket protocol ping and `{"type":"ping",...}` every 15s.
  Either the automatic protocol pong or a client `{"type":"pong",...}` reply must arrive
  within 10s or the server closes the connection (stale-connection
  cleanup on a kiosk tablet that can silently drop Wi-Fi).
- Client reconnect policy (frontend responsibility, documented here for the contract): on
  close/error, exponential backoff starting at 1s, capped at 30s, indefinitely — this is a
  kiosk device, it should always try to come back.

#### Message envelope (all WS messages, both directions)

```json
{
  "type": "string",
  "id": "string | null",
  "payload": { "...": "type-specific" },
  "timestamp": "2026-08-30T12:00:00.000Z"
}
```

- `type`: discriminator, see table below.
- `id`: correlation id. For `command_result`, equals the `id` returned by the originating
  `POST /commands/execute` or `/commands/confirm` call. `null` for unsolicited server pushes
  (e.g. periodic `status_update`).
- `timestamp`: ISO-8601 UTC, server clock, set at send time.

#### Message types

| `type` | Direction | `payload` shape | Purpose |
|---|---|---|---|
| `hello` | server→client | `{ "server_version": "string", "session_id": "string" }` | Sent immediately after a successful auth'd upgrade. |
| `status_update` | server→client | `SystemStatus` (§8) | Periodic (default 1s) push of CPU/GPU/RAM/temp/disk/network stats. |
| `now_playing_update` | server→client | `NowPlaying` | Pushed on media session change (track/app/play-state change), not polled. |
| `now_playing_update.payload` example | — | `{ "app": "Spotify", "title": "string", "artist": "string", "is_playing": true, "position_ms": 12345, "duration_ms": 210000, "album_art_url": "string \| null" }` | — |
| `connection_status` | server→client | `{ "online": true, "adapter": "Wi-Fi", "ssid": "string \| null" }` | PC's own network connectivity, distinct from the WS link itself. |
| `command_result` | server→client | `{ "command_id": "string", "status": "success\|error\|confirmation_required\|expired", "message": "string \| null" }` | Async resolution of a command issued via REST. |
| `ping` | server→client | `{}` | Heartbeat. |
| `pong` | client→server | `{}` | Heartbeat reply. |
| `subscribe` | client→server | `{ "channels": ["status", "now_playing", "connection"] }` | Optional: let client narrow which push channels it wants (battery/bandwidth saving); default is all. |
| `error` | server→client | `{ "code": "string", "message": "string" }` | Protocol-level error (bad message shape, unsubscribed channel, etc). |

Design note: `status_update` frequency (default 1000ms) and which stat fields are included
should be configurable server-side (see `config/service.json` in §7) so the PC owner can
lower tablet battery/network load if needed.

---

## 2. Authentication / pairing

### 2.1 Goals

- Zero manual JSON/config editing during normal pairing — the PC owner should never need to
  hand-copy a token into a file.
- A lost/reset tablet must be able to re-pair without any lingering access from the old
  token.
- Long-lived session so the kiosk doesn't re-pair on every reboot, but revocable per-device.

### 2.2 Pairing flow

1. On first run (or whenever the owner opens a "Pair a new device" screen in the PC tray
   app / local admin UI), the service generates a **pairing code**: a cryptographically
   random 6-character alphanumeric code (uppercase letters + digits, excluding visually
   ambiguous characters `0/O/1/I`), e.g. `7K4XQ9`, valid for **5 minutes** and **single-use**.
2. The PC displays this code plus a **QR code** encoding a pairing URI:
   ```
   launchpad://pair?ip=192.168.1.42&port=8787&code=7K4XQ9
   ```
   (If the tablet's browser/PWA can't handle a custom scheme, the QR instead encodes a plain
   HTTP URL the tablet's camera app or browser can open directly:
   `http://192.168.1.42:8787/pair?code=7K4XQ9`, which the PWA's own routing intercepts if
   installed, or which falls back to opening the pairing landing page in the browser.)
3. Tablet scans the QR (or the owner types the 6-char code manually into a "Pair" screen as
   a fallback for no-camera-access situations) and the frontend calls
   `POST /pairing/claim` with `{ "pairing_code": "7K4XQ9", "device_name": "Galaxy Tab A8" }`.
   `device_name` is client-supplied (editable, e.g. defaults to `navigator.userAgent`-derived
   guess) purely for the PC owner's own bookkeeping in the token list.
4. Server validates: code exists, not expired, not already claimed, request originates from
   an IP in the local subnet (§3). On success it:
   - Deletes/invalidates the pairing code immediately (single-use).
   - Mints a new **bearer token** (see format below), persists it in the token store.
   - Returns `{ "token": "...", "token_id": "...", "expires_at": null }`.
5. Frontend stores the token in `localStorage` (never in source, never bundled — see §7) and
   attaches it as `Authorization: Bearer <token>` on every subsequent REST call and as the
   WS subprotocol on connect.
6. If the pairing code expires or is wrong, `POST /pairing/claim` returns `410 Gone` (expired)
   or `401 Unauthorized` (wrong code) and the PC UI lets the owner regenerate a fresh code.

This requires zero manual file editing: the PC generates and displays the code/QR, the
tablet consumes it entirely through the UI.

### 2.3 Token format

- Format: opaque, high-entropy random token — 32 bytes from a CSPRNG
  (`crypto.randomBytes(32)`), base64url-encoded (no padding), e.g.
  `xQ9f2Kd8...` (43 chars). Not a JWT: there is no need for client-decodable claims, and an
  opaque token that must be looked up server-side makes revocation trivial and immediate
  (JWTs would need a blocklist anyway, which defeats their main advantage).
- Server stores only a **hash** of the token (`sha256`), never the raw value, in the token
  store (see §7 for storage file). Lookup on each request hashes the incoming token and
  compares against stored hashes (constant-time compare via `crypto.timingSafeEqual`).
- Each token record: `{ token_id (uuid), token_hash, device_name, created_at, last_seen_at }`.
  `token_id` (not the raw token, not the hash) is what appears in logs and in
  `GET /auth/tokens`.

### 2.4 Expiry policy

- Tokens are **long-lived by default (no fixed expiry / `expires_at: null`)** — this is a
  kiosk device that should stay paired indefinitely without nagging the owner, consistent
  with "local trusted device" threat model.
- Soft hygiene: server updates `last_seen_at` on every authenticated request. A scheduled
  local job (or on-demand from the PC tray UI) can flag/prune tokens unseen for e.g. 180 days,
  surfaced to the owner as "this device hasn't connected in 6 months, revoke?" — advisory,
  not automatic deletion, so a rarely-used but still-valid tablet isn't silently locked out.
- If stricter expiry is later desired, `expires_at` is already a field in the schema and can
  be populated (e.g. 90-day rolling expiry with silent refresh on use) without a breaking
  change.

### 2.5 Revocation

- `POST /auth/revoke` with a `token_id` removes that record from the token store immediately;
  any in-flight WS connection using that token is closed server-side with code `4401` on its
  next heartbeat check (server checks token validity on each ping cycle, not just at
  handshake, so revocation takes effect within one heartbeat interval, not just on reconnect).
- Primary revocation UX is a small local admin surface on the PC itself (system tray icon →
  "Paired Devices" → list with device name / last seen / Revoke button), calling
  `GET /auth/tokens` and `POST /auth/revoke` against `localhost`. This keeps revocation
  available even if the tablet is lost/stolen and can't be trusted to revoke itself.
- "Revoke all" (e.g. a tray menu "Unpair all devices") clears the entire token store —
  useful if the pairing code itself may have leaked.

### 2.6 Re-pairing after token loss

- If the tablet's `localStorage` is cleared (app reinstall, browser data wipe, factory
  reset) it simply has no token; the frontend detects `401` on its first request (or
  finds no stored token at all) and shows the "Pair this device" screen again. The owner
  generates a fresh pairing code on the PC and repeats §2.2. The old token (if the PC owner
  doesn't know it's now orphaned) can be cleaned up later via the "unseen for 180 days"
  hygiene flow or manually revoked.

---

## 3. Network binding

### 3.1 Bind address

- **Recommended: bind explicitly to the machine's LAN-facing IPv4 address** (e.g.
  `192.168.1.42`), not `0.0.0.0`, when that address is stable/discoverable at service start.
  Binding to a specific interface is the strongest guarantee — the OS itself will refuse
  connections on any other interface (loopback aside), so even a misconfigured firewall
  rule is a secondary defense, not the only one.
- Practical caveat: home LAN IPs can change (DHCP lease renewal) and Windows machines often
  have multiple adapters (Wi-Fi, Ethernet, virtual adapters from VPNs/VMs/Docker/Hyper-V).
  Hardcoding one IP at every boot is brittle. **Concrete approach**: at startup, enumerate
  `os.networkInterfaces()`, filter to non-internal IPv4 addresses whose address is in a
  private range (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), and bind to all of those
  explicitly (typically just one — the active Wi-Fi/Ethernet adapter). Explicitly exclude
  any adapter whose address looks like a VPN/virtual adapter if identifiable (best-effort;
  the subnet allowlist check in §3.3 is the real backstop). This is functionally
  "0.0.0.0 scoped down to private-range interfaces only," which is safer than a bare
  `0.0.0.0` bind (which would also accept traffic arriving via any future public interface,
  e.g. if the laptop later tethers a public IP or joins a public Wi-Fi with an unlucky
  routing setup) while staying resilient to DHCP changes.
- Do **not** bind to `0.0.0.0` unconditionally without the origin/IP allowlist in §3.3 — that
  allowlist is what actually makes an `0.0.0.0`-style bind acceptable as a fallback if
  interface enumeration is empty/fails at startup (e.g. bind to `0.0.0.0` but reject at the
  request layer, never purely trust the bind).

### 3.2 Windows Firewall guidance

- Ship the installer/first-run flow with a Windows Defender Firewall rule creation step
  (via `netsh advfirewall firewall add rule` or the `New-NetFirewallRule` PowerShell cmdlet,
  run once during setup, ideally with a UAC prompt the owner explicitly approves — do not
  silently escalate):
  ```
  New-NetFirewallRule -DisplayName "Launchpad Control Service" `
    -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8787 `
    -Profile Private
  ```
  Key point: **`-Profile Private` only** — never `Any` or `Public`. Windows tags each
  network adapter's connection profile as Private/Public/Domain; scoping the rule to
  `Private` means the port stays closed on the "Public" profile Windows applies to
  unfamiliar/coffee-shop networks, so even if the laptop is later used elsewhere the rule
  doesn't silently open the service to that network.
- If the user's home network is (incorrectly) marked "Public" in Windows' network settings,
  the app's setup flow should detect this (`Get-NetConnectionProfile`) and prompt the owner
  to either mark it Private (only if they trust it, which for a home LAN they should) or
  warn them the firewall rule won't apply there.
- No inbound rule is created for any profile other than Private; no outbound rules are
  needed (default Windows outbound is allow-all, and this service makes no outbound calls
  by design — see §10 no internet exposure).

### 3.3 Application-layer IP/origin allowlist (defense in depth)

Even though bind + firewall should already constrain exposure, the Express app additionally
validates on **every request**, before auth is even checked:

1. **Source IP check**: reject (`403`) any request whose remote address is not in the same
   private subnet as the server's bound interface (compute the server's `/24` — or the
   actual configured subnet mask if available — at startup, check `req.socket.remoteAddress`
   against it on each request). This catches misconfigurations (e.g. an accidentally-open
   `0.0.0.0` bind, or port-forwarding misconfigured on the router) as a second layer.
2. **Origin/Referer check** for browser-originated requests: if an `Origin` header is
   present, it must match the expected scheme+host+port the tablet is expected to hit
   (configurable, defaults to `http(s)://<bound-lan-ip>:<port>`); mismatches are rejected.
   This is weak on its own (headers are client-supplied) but cheap CSRF-adjacent hardening
   given the browser-based client.
3. Both checks are implemented as Express middleware run before the router, logging
   rejections (§6) since a rejection here is a stronger signal of misconfiguration or probing
   than an auth failure.

### 3.4 TLS note

- Plain HTTP/WS on the LAN is acceptable for this threat model (trusted household network,
  no internet exposure) and is the simpler default. If the implementer wants transport
  encryption anyway (defense against a compromised device *on* the LAN sniffing traffic,
  e.g. an untrusted IoT device or guest on the same Wi-Fi), a self-signed cert can be
  generated at first run and pinned by the PWA (the tablet would need to accept/trust it
  once). This is **optional hardening**, not required for v1 — flagged here so the
  implementer can pick it up later without an architecture change (the pairing QR payload
  in §2.2 already includes enough info to add an `https` toggle later).

---

## 4. Command model — allowlist, not shell exec

### 4.1 Core rule

The tablet **never** sends an executable path, a raw shell string, a URL string typed
free-form outside an allowlisted pattern, or any parameter that gets interpolated into a
shell command. Every command the tablet can issue references a **server-defined id** (or, for
links, a value validated against a server-defined pattern list) that the server maps to an
exact, pre-configured action. If an id/pattern doesn't exist in config, the request is
rejected with `404`/`400` — there is no "escape hatch" parameter anywhere in the schema.

### 4.2 Command categories

| Category | `command.type` | Tablet supplies | Server executes |
|---|---|---|---|
| Launch app | `launch_app` | `app_id` | Exact `exePath` + `args` from `config/apps.json`, via `child_process.execFile` (never `exec`/shell string interpolation — `execFile` does not invoke a shell, so shell metacharacters in args are inert). |
| Open link/file/folder | `open_link` | `link_id` | Exact `target` (URL, file path, or folder path) from `config/links.json`, opened via the OS default handler (`start` on Windows, invoked through `execFile('cmd.exe', ['/c','start','','<target>'])` or the `open`-style npm package configured to not accept arbitrary shell strings). |
| Media control | `media_control` | `action` (enum) | OS media session transport control (see §4.4). |
| Volume | `volume_set` | `level` (0-100) or `mute` (bool) | OS volume API (see §4.4). |
| Mic mute | `mic_mute` | `mute` (bool) | OS mic mute toggle (see §4.4). |
| Power action | `power_action` | `action` (enum: `lock`\|`sleep`\|`restart`\|`shutdown`) | Windows shutdown/lock APIs (see §4.5). **Always dangerous.** |
| Maintenance | `maintenance` | `task_id` | Exact pre-defined action from `config/maintenance.json` (see §4.6). May be flagged dangerous per-entry. |

### 4.3 Allowlist config shapes

`config/apps.json`:
```json
{
  "apps": [
    {
      "id": "chrome",
      "label": "Chrome",
      "icon": "chrome.png",
      "exePath": "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "args": [],
      "dangerous": false
    },
    {
      "id": "vscode",
      "label": "VS Code",
      "icon": "vscode.png",
      "exePath": "C:\\Users\\owner\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe",
      "args": ["--new-window"],
      "dangerous": false
    }
  ]
}
```

`config/links.json`:
```json
{
  "links": [
    {
      "id": "github",
      "label": "GitHub",
      "type": "url",
      "target": "https://github.com",
      "dangerous": false
    },
    {
      "id": "downloads-folder",
      "label": "Downloads",
      "type": "folder",
      "target": "C:\\Users\\owner\\Downloads",
      "dangerous": false
    },
    {
      "id": "budget-sheet",
      "label": "Budget.xlsx",
      "type": "file",
      "target": "C:\\Users\\owner\\Documents\\Budget.xlsx",
      "dangerous": false
    }
  ]
}
```
- Server validates `target` at config-load time (not per-request) to fail fast on typos:
  `url` entries must parse as `http`/`https` URLs; `file`/`folder` entries must exist on
  disk at load time (logged as a warning, not a crash, if missing — the PC owner may add
  the file later).

`config/maintenance.json`:
```json
{
  "commands": [
    {
      "id": "flush-dns",
      "label": "Flush DNS Cache",
      "exePath": "ipconfig.exe",
      "args": ["/flushdns"],
      "dangerous": false
    },
    {
      "id": "empty-recycle-bin",
      "label": "Empty Recycle Bin",
      "handler": "empty_recycle_bin",
      "dangerous": true
    }
  ]
}
```
- Two execution styles: `exePath`/`args` (runs a fixed, argument-frozen executable via
  `execFile`, e.g. `ipconfig /flushdns`), or `handler` (a named function implemented
  in-service, e.g. `empty_recycle_bin` calling a Windows API / `SHEmptyRecycleBin` via a
  native binding rather than shelling out) for actions that aren't a clean single exe
  invocation. Either way, **the tablet only ever supplies `task_id`** — never `exePath`,
  never `args`, never a `handler` name.

### 4.4 Media/volume/mic — OS session vs keystrokes

- **Preferred**: control via the OS-native media session APIs rather than synthetic
  keystrokes. On Windows, the most robust approach from Node.js is invoking a small
  PowerShell/`node-window-manager`-style helper, or (better) using Windows'
  `GlobalSystemMediaTransportControlsSessionManager` (WinRT API) via a native addon or a
  PowerShell bridge script (`Windows.Media.Control` namespace) to send Play/Pause/Next/
  Previous to the currently active media session — this is what lets the "now playing"
  metadata (§1.3 `now_playing_update`) be read too, so the same subsystem serves both
  read and write.
- **Fallback** (simpler, if the WinRT bridge proves too heavy for v1): synthetic media-key
  virtual key codes (`VK_MEDIA_PLAY_PAUSE`, `VK_MEDIA_NEXT_TRACK`, `VK_MEDIA_PREV_TRACK`,
  `VK_MEDIA_STOP`) sent via a native `SendInput` call (through a small native module or a
  PowerShell `Add-Type`-based helper). This is explicitly called out as a fallback, not the
  primary recommendation, because it can't report now-playing metadata and is a blunter
  instrument — but it is still scoped (only these 4 fixed key codes are ever sendable, never
  arbitrary keystrokes) so it does not violate the "no arbitrary exec" rule.
- **Volume**: use the Windows Core Audio API (`IAudioEndpointVolume`) via a native binding
  (e.g. the `loudness` or `node-audio-windows`-style npm packages) to set system volume
  0-100 and mute directly — precise, no synthetic key-repeat needed.
- **Mic mute**: same Core Audio API, targeting the default capture endpoint
  (`IAudioEndpointVolume` on the recording device) rather than the render device.
- Implementer note: pick one concrete npm package for each at implementation time; this
  spec's requirement is only that the mechanism be a scoped OS API call, never a shell
  command built from tablet input.

### 4.5 Power actions

- `lock`: `LockWorkStation()` via `user32.dll` (native call, e.g. through `ffi-napi` or a
  tiny compiled helper), or simply `execFile('rundll32.exe', ['user32.dll,LockWorkStation'])`
  — a fixed, argument-frozen invocation, not shell-interpolated.
- `sleep`: `execFile('rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0'])` (fixed
  args).
- `restart`: `execFile('shutdown.exe', ['/r', '/t', '0'])` (fixed args).
- `shutdown`: `execFile('shutdown.exe', ['/s', '/t', '0'])` (fixed args).
- All four are `dangerous: true` unconditionally (not configurable off) — see §5.

### 4.6 Example incoming command request

`POST /commands/execute`
```json
{
  "type": "launch_app",
  "app_id": "chrome"
}
```

`POST /commands/execute` (power action)
```json
{
  "type": "power_action",
  "action": "shutdown"
}
```

Response shape (non-dangerous, executes immediately):
```json
{
  "id": "cmd_9f1a2b3c",
  "status": "accepted"
}
```
`202 Accepted` — actual success/failure is pushed via WS `command_result` once the OS call
resolves (app launches are not instantaneous; volume/lock calls typically resolve fast
enough to also return `200`+`status:"success"` synchronously if the implementer prefers —
either is acceptable, but the WS `command_result` push must fire in both cases so the UI has
one consistent code path to show toasts/errors).

Rejection example (unknown id):
```json
{ "error": { "code": "UNKNOWN_APP_ID", "message": "No app configured with id 'steam'" } }
```
`404 Not Found`.

---

## 5. Dangerous-command confirmation

### 5.1 Why server-side, not just frontend

The frontend's own "Are you sure?" dialog is a UX nicety, not a security control — a
compromised or buggy frontend, a stray double-tap race, or a future automation script hitting
the API directly could fire a `shutdown` with no dialog at all. The server must independently
enforce a two-step confirmation for anything flagged `dangerous: true` (power actions always;
maintenance/app/link entries optionally, per their config flag).

### 5.2 Flow

1. Client `POST /commands/execute` with a dangerous command (e.g.
   `{ "type": "power_action", "action": "shutdown" }`).
2. Server recognizes it's dangerous, does **not** execute it, and responds `200 OK`:
   ```json
   {
     "status": "confirmation_required",
     "confirm_token": "cf_8a3e...",
     "expires_in_seconds": 10,
     "command_summary": "Shut down this PC"
   }
   ```
   `confirm_token` is a fresh random opaque token (16 bytes, base64url), stored server-side
   in an in-memory map keyed by token → `{ command, token_id (of the bearer that issued it), created_at }`,
   with a default TTL of **10 seconds** (configurable via `config/service.json`,
   `dangerousConfirmWindowSeconds`).
3. Client immediately shows its own confirmation dialog (defense-in-depth layering — the UI
   confirmation still happens, it just isn't the only gate) and, if confirmed by the user
   within the window, calls:
   ```
   POST /commands/confirm
   { "confirm_token": "cf_8a3e..." }
   ```
4. Server validates: token exists, not expired, not already used, and — importantly — the
   confirming request's bearer token matches the `token_id` that originally requested it
   (prevents one paired device's dangerous command from being confirmable by a different
   paired device's stray request). On success, executes the original command and responds
   `200` with `{ "status": "accepted", "id": "cmd_..." }`, then pushes `command_result` over
   WS as usual.
5. If the window expires before confirmation, the token is deleted and a late
   `POST /commands/confirm` returns `410 Gone` / `{"error":{"code":"CONFIRMATION_EXPIRED"}}`
   — client must restart from step 1.
6. Confirm tokens are single-use: a second `/commands/confirm` with the same token after
   success returns `409 Conflict`.

### 5.3 Configurability

`config/service.json` exposes `dangerousConfirmWindowSeconds` (default `10`) so the owner can
loosen it slightly (e.g. to 20s) if they find the kiosk's touch response too tight, but there
is a hard server-side ceiling (e.g. 60s max, enforced regardless of config) so a misconfigured
value can't effectively disable the protection.

---

## 6. Rate limiting & logging

### 6.1 Rate limiting

Implemented as Express middleware using a per-token sliding-window counter (in-memory,
e.g. via a small map of `token_id → timestamps[]`, pruned on each check — no need for
Redis at this scale/single-process deployment).

| Scope | Limit | Window | Notes |
|---|---|---|---|
| General authenticated REST (per `token_id`) | 60 requests | 60s | Covers status polls, config fetches, non-dangerous commands. |
| `POST /commands/execute` where command is `dangerous` | 5 requests | 60s | Stricter — dangerous command *attempts*, not confirmations. |
| `POST /commands/confirm` | 10 requests | 60s | Generous enough for legitimate retries after a typo'd/expired token, still bounded. |
| `POST /pairing/claim` (per source IP, since no token exists yet) | 10 requests | 5 min | Blocks brute-forcing the 6-char pairing code (which is also single-use + 5-min expiry, but layered limiting matters since the code space is only ~30 bits). |
| WS `subscribe` / reconnect attempts (per IP) | 20 | 60s | Basic reconnect-storm protection. |

- Exceeding a limit returns `429 Too Many Requests` with
  `{"error":{"code":"RATE_LIMITED","message":"..."}}` and a `Retry-After` header.
- Rate-limit state is per-process memory; a service restart resets counters, which is
  acceptable for this threat model (a restart already requires local access to the PC).

### 6.2 Logging

- **What's logged** (one structured JSON line per event, local rotating file):
  - Every authenticated request: `timestamp, source_ip, token_id, method, path, status_code, latency_ms`.
  - Every command execution attempt: the above plus `command_type, command_target_id (app_id/link_id/task_id/action), dangerous (bool), result (success/error/rejected)`.
  - Full dangerous-confirmation trail: the initial `execute` request (as
    `confirmation_required`), the issued `confirm_token`'s id (not the raw token — log the
    first 8 chars only or a hash, same principle as bearer tokens), the subsequent `confirm`
    call (accepted/expired/mismatched-token/reused), and final execution result — so a full
    audit trail exists for every shutdown/restart/sleep ever triggered from the tablet.
  - Auth failures (`401`) and IP/origin-allowlist rejections (`403` from §3.3), since these
    are the most security-relevant signal (probing, stale tokens, misconfig).
  - Pairing events: code generated, code claimed (success/failure/expired), token revoked.
- **What's never logged**: raw bearer tokens, raw pairing codes (log only a masked form,
  e.g. last 2 chars, for owner troubleshooting — "code ending in ...X9 was claimed"), raw
  confirm tokens, file contents, any request body field not in the allowlist above.
- **Storage**: local file only, e.g. `%LOCALAPPDATA%\Launchpad\logs\service.log`, JSON-lines
  format for easy grep/parsing. Never transmitted anywhere.
- **Rotation**: daily rotation + size cap, e.g. rotate at midnight or 10MB (whichever first),
  keep last 14 files, delete older automatically (simple to implement with `rotating-file-stream`
  or a small manual check-on-write; no external log service). Total worst-case disk use
  bounded at ~140MB.

---

## 7. Secrets handling

- **Tablet-side**: the bearer token lives **only** in the browser's `localStorage` (or, if
  packaged as an installed PWA, the equivalent origin-scoped storage) after the pairing
  exchange in §2.2. It is never hardcoded in frontend source, never baked into the PWA build
  artifact, and never committed to git — the frontend source contains zero secrets; a fresh
  install/clone of the frontend has no token until a human re-pairs it through the UI.
- **Server-side**: all secrets/state — the token store (hashed tokens + metadata), active
  pairing codes, the dangerous-confirm-token map (in-memory, doesn't need persistence) — live
  in a local state file, e.g. `%LOCALAPPDATA%\Launchpad\state\tokens.json`, **outside the
  project/repo directory** so it can never accidentally be committed, and additionally the
  repo's `.gitignore` should exclude any `*.local.json`/`state/`/`.env` patterns as defense
  in depth in case a future contributor points the state path into the repo during dev.
  Config files that are *not* secret (`apps.json`, `links.json`, `maintenance.json`,
  `service.json`) can live in the repo's `config/` directory as templates/defaults, but any
  machine-specific values a given owner fills in (real file paths, real exe paths) should be
  treated as local-only overrides, not committed with real personal paths if this repo is
  ever made public — recommend a `config/apps.local.json` override pattern (gitignored) that
  merges over the tracked defaults, so example/sample configs can stay in git while the
  owner's real paths don't.
- No secret ever appears in a URL that would be logged verbatim (see §1.3's WS auth
  recommendation to prefer the subprotocol header over a query string for exactly this
  reason) and no secret is ever included in an error message or crash report.
- `.gitignore` (repo root, already present) must include at minimum:
  ```
  config/*.local.json
  state/
  *.log
  .env
  ```

---

## 8. System stats reporting

### 8.1 Recommended approach

**Primary: the `systeminformation` npm package.** It's pure-JS/cross-platform, actively
maintained, and covers everything needed in one dependency: `si.currentLoad()` (CPU %),
`si.cpuTemperature()`, `si.mem()` (RAM), `si.graphics()` (GPU load/mem, and temperature where
exposed by the driver), `si.fsSize()` / `si.disksIO()`, `si.networkStats()` /
`si.networkInterfaces()`, `si.battery()` (not relevant for a desktop PC but harmless), and
`si.currentLoad()` per-core if the UI ever wants a breakdown. It shells out to
WMI/PowerShell/`wmic` internally on Windows where needed but presents a single consistent,
already-parsed JS API, which is much less implementation/maintenance burden than hand-rolling
WMI queries — a fallback most of `systeminformation` is *already* handling internally.

### 8.2 Graceful degradation

- Not all fields are available on all hardware (notably **GPU temperature** — many consumer
  GPU drivers don't expose this to WMI/generic APIs, and it's essentially never available for
  integrated graphics). The service must **never let a missing field become a thrown error**.
  Wrap each `systeminformation` call in a per-metric try/catch (or just check the returned
  field for `undefined`/`NaN`) and normalize missing data to explicit `null` in the
  `SystemStatus` payload, with the frontend contract being: **any stat field may be `null`
  and the UI must render a "—" / "unavailable" state for it rather than break.**
- `SystemStatus` shape (used both as `GET /status` response and WS `status_update.payload`):
  ```json
  {
    "cpu": { "usage_percent": 23.4, "temp_c": 54.0 },
    "gpu": { "usage_percent": 12.0, "temp_c": null, "mem_used_mb": 1024, "mem_total_mb": 8192 },
    "ram": { "used_mb": 8192, "total_mb": 16384, "usage_percent": 50.0 },
    "disk": [ { "mount": "C:", "used_gb": 240.1, "total_gb": 512.0 } ],
    "network": { "adapter": "Wi-Fi", "rx_kbps": 120.5, "tx_kbps": 15.2, "connected": true },
    "audio": { "volume_percent": 65, "muted": false, "mic_muted": false },
    "uptime_seconds": 543210
  }
  ```
- Polling cadence for the periodic WS `status_update` push: default 1000ms for cheap fields
  (CPU/RAM/network), but temperature/GPU queries (which can be slower syscalls) can be
  fetched on a slower cadence internally (e.g. every 2-3s) and cached, so the 1s push doesn't
  become a bottleneck — this is an internal server implementation detail, not a contract
  change (the payload shape stays the same either way; a field may just repeat its last known
  value between its own refreshes).

---

## 9. Auto-start on Windows

### 9.1 Recommendation: Task Scheduler task at logon (not a Windows Service)

**Primary recommendation**: register a Task Scheduler task that runs at user logon
(`schtasks /create /sc onlogon /tn "Launchpad Control Service" /tr "...\launchpad-service.exe" /rl limited`,
or the equivalent `Register-ScheduledTask` PowerShell cmdlet with a logon trigger), created
during first-run setup (with the owner's explicit consent, not silently).

Why this over a full Windows Service:
- A Windows Service requires installer-level admin rights to register (`sc create`), runs
  under the SYSTEM account or a dedicated service account by default (broader privilege than
  needed — this app only needs the interactively logged-in user's session context, notably
  for things like `LockWorkStation()` and media-session APIs, which are tied to the
  interactive desktop session and are awkward or impossible to reach cleanly from a Session-0
  SYSTEM service on modern Windows).
- A Task Scheduler logon task runs in the user's own session with the user's own privileges
  (no elevation needed beyond what the owner already has), which is exactly the right
  privilege level for this app (it should not be able to do anything the logged-in owner
  couldn't already do by hand) and keeps setup a simple, revocable, user-scoped registration
  rather than a system-wide service install.
- It's also trivially removable by the owner via the standard Task Scheduler GUI, and doesn't
  persist across a full OS reinstall or need a driver-style uninstaller.

**Alternative (simpler, mention only)**: a plain shortcut in the
`shell:startup` folder (`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`) pointing
at the service executable. Even lower friction to set up (literally copy a `.lnk` file, no
`schtasks` invocation needed) and is a fine fallback if the implementer wants to avoid the
Task Scheduler API entirely, but it's slightly less robust: Startup-folder items run with a
noticeable delay after other login processes and have historically been more likely to be
flagged/disabled by third-party "startup optimizer" utilities than a registered scheduled
task. Task Scheduler is the primary recommendation because it's still admin-light (a
per-user, non-elevated task with `/rl limited` needs no UAC prompt to register) while being
the more "proper"/durable mechanism Windows itself exposes for this exact use case.

Explicitly **not** recommended for v1: a full installer-driven Windows Service — too much
privilege and complexity for what's a single-user local kiosk-controller.

---

## 10. Threat model summary

### 10.1 What this design defends against

- **Internet exposure**: service binds only to private-range LAN interfaces (§3.1),
  Windows Firewall rule scoped to the `Private` profile only (§3.2), and an
  application-layer subnet/origin allowlist rejects any request whose source isn't on the
  local LAN even if binding/firewall were somehow bypassed (§3.3). The service makes no
  outbound internet calls itself.
- **Arbitrary command execution**: every tablet-issuable command resolves to a pre-defined,
  config-driven id → exact executable path/args or a named in-process handler (§4); there is
  no code path anywhere that interpolates client-supplied strings into a shell command.
  `execFile` (not `exec`) is used throughout specifically to avoid shell metacharacter
  injection even within the fixed, allowlisted args.
- **Unauthorized access / token theft**: opaque, high-entropy (256-bit) bearer tokens,
  stored server-side only as salted-free SHA-256 hashes (so a stolen state file doesn't
  directly yield usable tokens... note: this is a mitigation, not a guarantee — see residual
  risks), constant-time comparison to avoid timing side-channels, per-device revocation, and
  a short-lived single-use pairing code (5 min, single claim) so the pairing window itself is
  narrow (§2).
- **Replay / brute-force / abuse**: sliding-window rate limits per token and per source IP,
  with stricter limits on dangerous-command attempts and pairing-code claims specifically
  (§6.1).
- **Accidental or malicious dangerous actions**: server-enforced two-step confirmation
  (separate short-lived confirm token, bound to the same requesting device, 10s default
  window) for shutdown/restart/sleep and any config-flagged dangerous maintenance action —
  this holds even if the frontend's own confirmation dialog is bypassed, skipped, or the API
  is hit directly by something other than the intended UI (§5).
- **Audit / forensics**: local structured logs capture the full lifecycle of every command
  and every dangerous-confirmation exchange, with token ids (not raw tokens) so a compromise
  investigation doesn't itself leak credentials (§6.2).

### 10.2 Residual risks / trust assumptions

- **Trusts any device on the LAN that obtains a valid token.** This design does not attempt
  device attestation beyond "has a bearer token issued through the pairing flow." Anyone who
  can complete the pairing flow (i.e., anyone who can see the PC's screen/QR code during the
  5-minute pairing window, or who guesses the 6-char code within that window and under the
  rate limit) becomes a fully trusted client. This is intentional and appropriate for a
  household-LAN kiosk use case, not for a shared/untrusted network.
- **Does not defend against a compromised PC OS.** If the Windows machine itself is already
  compromised (malware, another local user with access), this service adds no additional
  protection — it's a control surface *of* the PC, not a security boundary *around* it.
- **Does not defend against a compromised or malicious device already on the LAN.** A
  rogue device on the same Wi-Fi (e.g. a compromised IoT gadget, or an untrusted guest) could
  in principle sniff plaintext HTTP/WS traffic (§3.4 notes TLS as optional future hardening)
  or attempt to brute-force pairing codes within the rate limit; the household is assumed to
  trust its own LAN as a boundary, consistent with the project's stated scope.
- **Token storage on the server is hash-only for the token itself, but the plaintext token
  briefly exists in transit and in the tablet's `localStorage` indefinitely.** A rooted/
  compromised tablet, or physical access to an unlocked tablet with browser dev tools, can
  extract the stored token. Mitigation is revocation (§2.5), not prevention — this is a
  standard bearer-token trust tradeoff, accepted here given the kiosk/local-device context.
- **No device attestation / no mTLS.** Anything that can reach the LAN and has a token is
  indistinguishable from the "real" tablet to the server. Acceptable for a single-tablet
  household kiosk; would need revisiting if the project ever expanded to a shared/multi-user
  or higher-sensitivity environment.
- **Rate limiting is in-memory and per-process**, so a service restart clears counters —
  a local attacker who can trigger service restarts could reset their own rate-limit budget,
  but triggering a restart already requires local PC access, at which point far more direct
  attacks are available to them anyway.
- **Confirmation window is a mitigation, not a lock.** A device with a stolen valid token
  can still request a dangerous action and confirm it within the window; the confirmation
  step defends against UI bugs/bypass/accidental taps and non-UI API misuse, not against a
  fully trusted-but-malicious token holder.
