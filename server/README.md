# Launchpad Server

Node.js (Express + `ws`) PC control service for the Launchpad tablet
dashboard. Implements `architecture-security.md` (the authoritative
implementation contract) plus the `launch_game` command type and optional
module stubs from `reconciliation.md`. This directory (`server/`) is owned
by the server subagent — see `docs/reconciliation.md` §3 for directory
ownership.

## Requirements

- Node.js >= 18 (developed/tested against Node 26).
- No build step. CommonJS, no bundler.

## Setup

```bash
cd server
npm install
npm start        # same as: node src/index.js
```

On start the service:

1. Loads `config/*.json` from the repo-root `config/` directory (read-only
   from the server's perspective — see "Config schema additions" below for
   the one field this server adds).
2. Enumerates private-range LAN interfaces (`os.networkInterfaces()`) and
   binds an HTTP server to each of them, **plus always binds `127.0.0.1`**
   (loopback) — architecture-security.md §2.5 expects a local PC-tray admin
   surface to call `/auth/tokens`/`/auth/revoke` against `localhost`, and
   loopback is also what you'll use for local dev/curl testing.
3. Generates and prints a 6-character pairing code + plain pairing URL to
   the console, and auto-regenerates one whenever the active code expires
   or gets used (dev convenience so `npm start` is immediately testable
   without a PC-tray "Pair a new device" UI existing yet — see
   `GET /pairing/current`).
4. Starts the WebSocket hub at `/ws` and the periodic `status_update` /
   `connection_status` pushes.

## Config

Reads (never writes) the lead-owned files in `../config/`:
`service.json`, `apps.json`, `links.json`, `maintenance.json`, `games.json`,
`profiles.json`, `smarthome.json`.

**Override pattern** (per architecture-security.md §7): drop a
`config/<name>.local.json` next to any tracked config file and it is
deep-merged over the tracked defaults at load time — use this for real
machine-specific paths (real `exePath`s, real Windows usernames) so they
never need to be committed. `config/*.local.json` is gitignored.

**Dev-mode path handling**: `service.json`'s `logDir`/`stateDir` are
Windows-styled (`%LOCALAPPDATA%\Launchpad\...`) for production. On this
Linux dev box (or if `%LOCALAPPDATA%` isn't set even on Windows), the
server falls back to `server/logs/` and `server/state/` instead — see
`src/config.js`'s `resolveDataDir()`. In production on Windows, point these
at `%LOCALAPPDATA%\Launchpad\logs` / `\state` as the spec recommends (they
already do, by default, in `config/service.json`).

### Config schema addition made by this subagent

Added a `modules` section to `config/service.json` (additive only, nothing
existing was removed/restructured), per reconciliation.md §1's explicit
request:

```json
"modules": {
  "homeassistant": { "enabled": false },
  "obs": { "enabled": false },
  "discord": { "enabled": false },
  "notifications": { "enabled": false },
  "clipboard": { "enabled": false }
}
```

The server also defaults this in code (`src/config.js`) if the key is ever
missing, so it never crashes regardless. **Lead: please review this
addition** — it's the one change made to a file outside `server/`.

## Dependencies (kept minimal, justified)

| Package | Why |
|---|---|
| `express` | REST routing/middleware, per architecture-security.md's own stack assumption. |
| `ws` | WebSocket server for `/ws`. |
| `systeminformation` | System stats (§8) — single cross-platform dependency instead of hand-rolled WMI/PowerShell parsing. |

No audio/media-control native binding was added (see "Real vs mocked"
below) — packages like `loudness`/`node-audio-windows` need prebuilt
native binaries that are Windows/Mac-only and would break `npm install` on
this Linux dev box, so volume/mic/media-transport control is implemented as
a documented `execFile`-based PowerShell-bridge plan (TODO, not yet wired)
with a fully-working `mockExec` implementation standing in today. No QR
image library was added either — see "Pairing surface" below.

## Real vs `mockExec`-stubbed vs. module-stubbed

The real PC being controlled turned out to be this machine — Omarchy
(Hyprland/Arch Linux), not Windows — so both platforms now have real
command implementations, not just Windows. **mockExec** is auto-enabled
only for a platform with no real implementation at all (anything that
isn't `win32` or `linux`), or when `config/service.json`'s `mockExec: true`
is set explicitly (useful for a side-effect-free test run even on a
supported platform — put it in `config/service.local.json` so it doesn't
land in git). Confirmed in `src/config.js`:
`mockExec = service.mockExec === true || !['win32','linux'].includes(process.platform)`.
When active, every OS-level call logs what it *would* have run and returns
a realistic delayed success instead of actually invoking anything.

| Area | Status | Notes |
|---|---|---|
| `launch_app`, `open_link`, `launch_game` | **Real on both Windows and Linux** | `runExeFile` now uses `spawn`+`detached`+`unref` rather than waiting for the process to exit (the original `execFile`-with-15s-timeout implementation would have killed a freshly-launched GUI app mid-launch on Linux, where launched apps don't exit on their own the way `cmd.exe /c start` does on Windows). Linux uses `xdg-open` for links/games, real `exePath`s from `config/apps.local.json` for apps. **Verified live**: launching "Files" from the actual dashboard UI opened a real Nautilus window; `open_link` opened Nautilus directly on `~/Downloads`. |
| `power_action` (lock/sleep/restart/shutdown) | **Real on both** | Linux: `omarchy-system-lock` / `systemctl suspend` / `omarchy-system-reboot` / `omarchy-system-shutdown` (Omarchy's own first-class commands — close app windows gracefully, show an OSD). **Verified live**: `lock`, through the full two-step confirm flow via the real API, genuinely locked the session (confirmed via `omarchy-hyprland-session-locked`). `sleep`/`restart`/`shutdown` were **not** live-tested for obvious reasons (would have killed the dev session) — verified by code/mapping review only; test one deliberately when ready. |
| `maintenance` — all 11 entries | **Real on Linux** (Windows: `flush-dns`/`open_link`-style real, the rest still TODO) | See `src/commands/exec.js`'s `knownHandlers` — every handler now branches on `process.platform`. Linux specifics: `flush_dns`→`resolvectl flush-caches`, `empty_recycle_bin`→`gio trash --empty`, `restart_spotify`→`pkill -x spotify` + relaunch, `clear_temp_files`→clears `~/.cache/thumbnails` via `fs.rm` (deliberately scoped, not a system-wide `/tmp` sweep), `open_task_manager`→`foot -e btop`, `take_screenshot`→`omarchy-capture-screenshot fullscreen save`, `open_controller_tools`→Steam settings, `toggle_game_mode`→`omarchy-powerprofiles-set` (checks `omarchy-powerprofiles-list` first and fails honestly if no `performance` tier exists on the hardware — it doesn't on this machine), `start`/`stop_screen_recording`→`omarchy-capture-screenrecording --fullscreen[--stop-recording]`. `toggle_perf_overlay` stays a documented TODO (no overlay tool like MangoHud installed here). **Verified live**: `flush-dns`, `take-screenshot` (real file appeared in `~/Pictures`), `open-controller-tools` all succeeded for real; `toggle-game-mode` failed with a clear, honest error (no `performance` profile on this hardware) rather than a silent no-op or crash. |
| `volume_set`, `mic_mute` | **Real on Linux** (Windows: still TODO/mocked) | `LinuxMediaController` in `src/commands/media.js`. Volume: resolves the real sink via `omarchy-audio-output-sink` (follows through any DSP/EQ passthrough), then `pactl set-sink-volume`/`set-sink-mute` directly (Omarchy's own volume wrapper only supports relative +N/-N steps, not the absolute level the tablet's slider needs). Mic: `pactl set-source-mute @DEFAULT_SOURCE@` — note `wpctl`'s `@DEFAULT_AUDIO_SOURCE@` alias (what Omarchy's own mic-mute keybind script uses) failed to resolve on this machine ("'-1' is not a valid ID" from WirePlumber's default-nodes-api) even though a real input device exists; `pactl`'s own default-source resolution worked reliably instead, so that's what's used. **Verified live**: volume set to 42%, confirmed via `wpctl get-volume`, restored to 65%; mic mute set true then false, confirmed via `pactl get-source-mute` both ways. |
| `media_control` (play/pause/next/prev/stop/toggle) + now-playing | **Real on Linux, but `playerctl` is not installed on this machine** | Wired to MPRIS via `playerctl` (the standard tool for this), with a 1.5s poll loop (`_pollNowPlaying`) that only fires `now_playing_update` on an actual track/app/play-state change, not on every position tick, per architecture-security.md §1.3. Album art is left `null` — MPRIS art URLs are local filesystem paths on the PC, not reachable from the tablet, and serving them would need a small proxy endpoint (follow-up, not implemented). **To make this real**: `sudo pacman -S playerctl`. Until then, media commands fail cleanly (`spawn playerctl ENOENT`, confirmed via a live curl test) rather than lying about success — Home/Media screens correctly show "Nothing playing" instead of fake data. |
| System stats (`/status`, `status_update`) | **Real everywhere** | `systeminformation` runs fine on Linux and Windows; verified live (real CPU/RAM/disk/network/temp numbers, including through the actual dashboard UI). |
| Wake-on-LAN | **Real everywhere** | Plain UDP broadcast via `dgram`, no OS-specific code — not gated by mockExec. |
| Virtual keyboard (type + special keys) | **Real on Linux** (`ydotool` installed + `ydotool.service` enabled 2026-08-30) | `typeText`/`pressKey` in `src/commands/desktop.js`, backed by `ydotool type`/`ydotool key`. `mockExec` mode fully exercises the flow either way. |
| Trackpad cursor move / click | **Real on Linux** (same `ydotool` setup) | See "Virtual keyboard / trackpad" below. **Verified live**: a WS `pointer_input` round-trip through the running server actually moved the real cursor (confirmed via `hyprctl cursorpos` before/after) and clicked, with no error. `moveCursor`/`click` throw a clear, honest error (not a crash, not a silent no-op) if `ydotool`/`ydotool.service` is ever missing; `mockExec` mode also fully exercises the flow. |
| Trackpad scroll | **TODO, all platforms** | `ydotool` 1.0.4 (the version in this distro's `extra` repo) has no verified wheel/scroll subcommand — rather than ship an unverified invocation, this is a documented TODO in `src/commands/desktop.js`; mockExec always succeeds so the gesture flow itself is testable today. |
| Home Assistant / OBS / Discord / notifications / clipboard | **Module stubs, disabled by default** | `server/src/modules/<name>/` — see each module's own `README.md` for what real integration would need. Never imported/invoked unless `config/service.json` → `modules.<name>.enabled: true`. |

### Linux-specific config

`config/apps.local.json` and `config/links.local.json` (gitignored, deep-merged
over the tracked `config/apps.json`/`links.json` examples per the existing
`.local.json` override pattern — see `docs/adding-apps-and-commands.md`)
hold this machine's real paths: Steam, Discord (via
`omarchy-launch-webapp`), Chrome, Spotify, Nautilus, foot. The tracked
`config/apps.json`/`links.json` are left as Windows-flavored examples/
documentation of the schema; a Windows deployment would use them as-is or
with its own `.local.json` overrides, following the exact same pattern.

## Pairing surface (no QR image dependency)

Per this server's implementation brief, no heavyweight QR-image npm
dependency was added. Instead:

- `GET /pairing/current` (unauthenticated, LAN-only, subject to the same
  network-guard middleware as everything else) returns
  `{ code, expires_at, pairing_url }` for the currently active code.
  Available both at `/api/v1/pairing/current` and aliased at
  `/pairing/current` (root) for a simple PC-side companion display.
- The code + plain pairing URL are also printed prominently to the
  console/terminal at startup and whenever a fresh code is generated.
- The 6-char manual-entry path (`POST /api/v1/pairing/claim`) is fully
  implemented and is the primary path, consistent with the frontend
  pairing screen's own brief (manual entry as primary, camera/QR as a nice
  extra it can add later against the same endpoint).

## Network binding & Windows Firewall

The service enumerates `os.networkInterfaces()` at startup, binds to every
non-internal private-range IPv4 address found (typically the one active
Wi-Fi/Ethernet adapter) **plus loopback**, and falls back to `0.0.0.0` with
the application-layer allowlist as the real gate if no private-range
interface is found. Every request is additionally checked against a
source-IP allowlist and (if present) an `Origin` header allowlist before
auth is even checked — see `src/network.js`.

On the Windows install, open the port on the **Private** firewall profile
only:

```powershell
New-NetFirewallRule -DisplayName "Launchpad Control Service" `
  -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8787 `
  -Profile Private
```

Never `-Profile Any` or `Public`. If the home network is (incorrectly)
marked "Public" in Windows, check with:

```powershell
Get-NetConnectionProfile
```

and either change it to Private (only if genuinely trusted) or be aware the
firewall rule above won't apply there.

## Auto-start on Windows

See `docs/windows-service-setup.md` (this subagent's own new doc) for the
full Task Scheduler logon-task registration steps, per
architecture-security.md §9.

## Logging

Structured JSON-lines, one event per line, written to `logDir` (see
"Config" above for the dev-vs-prod path). Rotates daily or at
`logMaxSizeMb` (whichever first), keeps `logRetentionDays` files. Never
logs raw bearer tokens, raw pairing codes, raw confirm tokens, or request
body fields outside the allowlisted set — see `src/logger.js` and every
route's log calls for what's actually written.

## Virtual keyboard / trackpad

The dashboard's dedicated "Desktop" tab is a control-only remote input surface — a full
on-screen keyboard (types on the PC) plus a small trackpad (drag to move the cursor, tap to
left-click, two-finger tap to right-click). It never shows the PC's
screen — an earlier iteration also mirrored the display via `grim`, but that was cut in favor
of exactly this: keyboard + trackpad, nothing else, no live screenshot leaving the PC. See
`docs/architecture-security.md` §11 for the full protocol/config addendum.

Both the keyboard and the trackpad need `ydotool` — the standard uinput-based input-injection
tool for Wayland/Hyprland (the X11-era `xdotool` doesn't work under Wayland at all). **Now
installed and enabled on this machine** (2026-08-30) — verified live: `ydotool mousemove`/
`ydotool click` both moved/clicked the real cursor directly, and a full round-trip through the
running server (WS `pointer_input` → `DesktopController` → `ydotool`) moved the real cursor
with no error. To set this up on a fresh machine:

```bash
sudo pacman -S ydotool
systemctl --user enable --now ydotool   # NOT a system unit — `ydotoold` is packaged as the
                                         # user unit `ydotool.service`, not `ydotoold.service`
```

The Arch package's own post-install hint says to also run `usermod -aG input $USER` (then
re-log in) — worth doing for portability, but on this machine `/dev/uinput` already carried an
ACL granting the `cemv` user direct rw access, so `ydotool.service` worked immediately without
it. If `ydotool mousemove`/`click` fail with a permission error on a different machine, that's
the thing to check (`getfacl /dev/uinput` — group `input` or your user needs rw).

Once `ydotool.service` is running, keyboard/cursor/click work with no server code changes
needed — `src/commands/desktop.js` already calls `ydotool type`, `ydotool key`, `ydotool
mousemove`, and `ydotool click` with fixed argv (never a shell string; `type`'s text argument is
literally what the user typed on the virtual keyboard, but `execFile` never invokes a shell, so
there's no metacharacter-injection risk regardless of content). Scroll stays a TODO (see the
table above) until `ydotool`'s wheel/scroll support is verified — 1.0.4 (the version installed
here) has no confirmed subcommand for it.

The only tuning knob is `config/service.json` → `remoteDesktop.moveSensitivity` (default
`1.5`) — see `docs/architecture-security.md` §11.2.

## Double-clap workspace launcher (Linux)

When the server runs on this Omarchy machine, it listens to the default
microphone through `parec`. Two sharp claps 180–850 ms apart launch Spotify,
Visual Studio Code, and a Foot terminal running Codex CLI. A five-second
cooldown prevents duplicate launches. Audio is analyzed as raw PCM in memory
and is never stored or transmitted.

Override detector timing, sensitivity, or disable it with
`service.clapTrigger` in `config/service.local.json`, for example:

```json
{
  "clapTrigger": { "enabled": false, "minPeak": 9000, "maxGapMs": 1000 }
}
```

## HTTPS / tablet voice trigger

The tablet PWA can launch apps by voice (browser `SpeechRecognition`), which
Chrome only permits on a secure context — so hitting the server by LAN IP
needs HTTPS, not just `localhost`. Generate a self-signed cert/key pair into
`server/certs/` (git-ignored) and the server picks it up automatically on
next start, no config changes needed:

```sh
mkdir -p server/certs
openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
  -keyout server/certs/launchpad-key.pem \
  -out server/certs/launchpad-cert.pem \
  -subj "/CN=launchpad.local"
```

The tablet's browser will need to accept the self-signed cert once. To
override the paths, or force HTTPS off despite certs being present, set
`https` / `tlsKeyPath` / `tlsCertPath` under `service` in
`config/service.local.json`.

## Verified locally (Linux dev box, mockExec auto-engaged)

Run `npm install && npm start` from `server/`, then (from another
terminal):

```bash
curl -s http://127.0.0.1:8787/health
curl -s http://127.0.0.1:8787/pairing/current
# claim the code returned above:
curl -s -X POST http://127.0.0.1:8787/api/v1/pairing/claim \
  -H 'Content-Type: application/json' \
  -d '{"pairing_code":"<CODE>","device_name":"Test Tab A8"}'
# use the returned token as $TOKEN for everything else:
curl -s http://127.0.0.1:8787/api/v1/status -H "Authorization: Bearer $TOKEN"
curl -s -X POST http://127.0.0.1:8787/api/v1/commands/execute \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"type":"launch_app","app_id":"browser"}'
```

All of the above (plus the dangerous two-step confirm flow, unauthorized
rejection, rate-limit trip, and a WS `hello`→`status_update` round trip)
were actually run against a live instance during implementation — see the
final report to the lead for the exact verified output.

## Directory layout

```
server/
  package.json
  README.md
  src/
    index.js              # entrypoint — wires everything together
    config.js              # loads config/*.json, resolves logDir/stateDir
    logger.js               # JSON-lines logger + rotation
    rateLimit.js            # sliding-window limiter
    network.js               # LAN interface enumeration + IP/origin guard
    auth.js                   # bearer auth middleware
    wol.js                     # Wake-on-LAN (dgram magic packet)
    state/
      tokenStore.js            # bearer tokens (hashed, persisted)
      pairingStore.js            # pairing codes (in-memory)
      confirmStore.js              # dangerous-command confirm tokens
      commandHistory.js              # last-50 ring buffer
    commands/
      index.js                       # allowlist resolver/dispatcher
      exec.js                          # execFile + mockExec + handlers
      media.js                           # volume/mic/media transport control
    stats/
      systemStats.js                       # systeminformation wrapper, §8 shape
    ws/
      server.js                              # /ws hub: auth, heartbeat, pushes
    routes/
      health.js, pairing.js, auth.js, status.js,
      config.js, commands.js, media.js, wol.js
    modules/
      homeassistant/, obs/, discord/, notifications/, clipboard/
        index.js (documented stub interface) + README.md (integration plan)
  logs/    (gitignored, created at runtime)
  state/   (gitignored, created at runtime)
```
