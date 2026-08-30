# Lead reconciliation notes

Read after `design-system.md` and `architecture-security.md` (both canonical, no
conflicts found between them). This file resolves the handful of gaps between
the two specs and the full feature wishlist, and sets directory ownership for
the implementation subagents. It is the lead agent's design authority for
anything the other two docs don't already settle.

## 1. Scope decision: MVP core vs. optional modules

The full feature list in the project brief is large (drag-and-drop layout
editor, multi-PC support, QR pairing, Home Assistant, OBS, Discord, clipboard
transfer, command history, etc). Building all of it to production depth in one
pass would either blow the "keep the core light" requirement or ship shallow,
untested stubs everywhere. Split:

**Core (fully implemented, fully wired to the real server, testable end to end):**
- All 5 required screens (Home, Gaming, Media, System, Smart Home) per the
  wireframes in `design-system.md` §15.
- Data-provider abstraction (mock provider + live HTTP/WS provider), config
  driven from `config/*.json`.
- Pairing flow (6-char code + QR, per `architecture-security.md` §2), bearer
  token storage, revoke.
- Full command model: launch app, open link/file/folder, media control,
  volume, mic mute, power actions, maintenance — server-validated allowlist,
  two-step dangerous confirmation front and back.
- Live system stats via WS `status_update`, graceful `null` handling.
- Profiles (switch active profile, per-profile home layout + theme), theme
  auto-switch by time (`profiles.json.themeSchedule`).
- Idle/screensaver screen with burn-in drift.
- Connection-lost/reconnecting overlay, exponential-backoff reconnect.
- Rate limiting, structured local logging (server side).
- Haptic feedback (`navigator.vibrate`, feature-detected), sound feedback
  with an off switch (short synthesized click via WebAudio — no audio file
  assets to keep the bundle light).
- Wake-on-LAN: server exposes `POST /api/v1/wol` (bearer-gated, not
  dangerous) that sends a magic packet to `config/service.json`'s configured
  MAC when enabled — lets the tablet wake a sleeping PC, which the pure
  "PC-hosts-the-dashboard" model otherwise can't do. Off by default
  (`wakeOnLan.enabled: false`).
- Basic command history: server keeps the last 50 executed commands
  in-memory (mirrors the log file) and exposes `GET /api/v1/commands/history`;
  frontend shows the last few in a small drawer, not a dedicated screen.
- Favorites/recent apps: client-side only (localStorage), derived from what
  the user actually launches — no server changes needed.
- Drag-and-drop layout editing: implemented as a real "Edit Layout" mode on
  Home/Gaming (long-press or an explicit edit toggle enters it), reordering
  persisted to `localStorage` per profile and, if the PC-side admin surface
  is later opened, syncable back to `config/profiles.json`. v1 persists
  client-side only — this satisfies "user-editable button layout" without
  requiring a full round-trip config-writer API in the server (flagged as a
  clean extension point, see `POST /api/v1/config/layout` left undefined on
  purpose).
- Backup/restore + import/export of profiles: client-side JSON
  export/import of the localStorage layout+profile state (a "Export Config"
  / "Import Config" action in Settings) — no server round-trip needed since
  layout state is client-owned in v1.
- QR-code pairing: covered by core pairing flow above.
- Configurable dangerous-confirm timeout: already in `service.json`
  (`dangerousConfirmWindowSeconds`), surfaced read-only in the frontend
  confirmation dialog countdown.
- Screen brightness control for the tablet: **client-side only**, via the
  Screen Wake Lock API + a CSS dimming overlay class the user can toggle in
  Settings (real hardware brightness isn't reachable from a web app — this
  is documented as a soft/simulated dim, not true panel brightness).
- Offline interface caching: a service worker caches the app shell
  (HTML/CSS/JS/icons) so the tablet can still show cached UI immediately on
  reconnect after a network blip; it does not cache live data.

**Optional modules (scaffolded with a clean, isolated interface; disabled by
default; not deeply implemented against a real external account/service —
there's no live Home Assistant/OBS/Discord instance available in this
environment to integrate against):**
- Home Assistant integration — Smart Home screen renders its tiles from
  `config/smarthome.json` in a disabled/"Not connected" visual state (per
  design system §15.6's dashed placeholder card). Server has a stub module
  `server/modules/homeassistant/` with a documented interface
  (`getStates()`, `callService()`) and a `enabled: false` flag; wiring a real
  HA instance is a config change + implementing the two stub methods against
  the HA REST API, not a redesign.
- OBS Studio controls — `server/modules/obs/` stub (would use
  obs-websocket); `obs` app tile already in `config/apps.json` (just
  launches the app) — deeper scene/recording control via obs-websocket is
  the stub's job, disabled by default.
- Discord mute/deafen — `server/modules/discord/` stub (would use Discord's
  local RPC or a user-authorized bot); disabled by default.
- Music-service integrations beyond Spotify's OS media session (e.g. a
  direct Spotify Web API integration for richer library browsing) — out of
  scope for v1; the Media screen's "now playing" already works for Spotify
  via the OS media session per `architecture-security.md` §4.4, which covers
  the required feature without needing OAuth.
- PC notifications panel, clipboard transfer — `server/modules/notifications/`
  and `server/modules/clipboard/` stubs with a documented WS message-type
  extension point (`notification_push`, `clipboard_sync`) but no
  implementation — flagged as the two lowest-priority optional items in the
  brief and the two with the largest security surface (arbitrary clipboard
  content, notification content crossing the trust boundary) if done
  carelessly, so they're left as clearly-labeled TODOs rather than rushed.

Every optional module lives under `server/modules/<name>/`, is imported
conditionally based on a `modules.<name>.enabled` flag (new section to add to
`config/service.json` — implementers should add
`"modules": { "homeassistant": {"enabled": false}, "obs": {"enabled": false}, "discord": {"enabled": false} }`),
and never runs its code path when disabled. This satisfies "treat optional
integrations as separate modules; do not let them make the core dashboard
heavy or unreliable."

## 2. Gap fix: dynamic game launches vs. the static link allowlist

`architecture-security.md` §4 allowlists apps/links by static `id` resolved
to a fixed path — correct for the fixed app tiles, but `config/games.json`'s
library is meant to grow without editing `links.json` per game. Resolution:
add a **fourth command type**, `launch_game`, alongside `launch_app` /
`open_link`:

```json
{ "type": "launch_game", "steam_app_id": "570" }
```

Server validates `steam_app_id` against `^[0-9]{1,10}$` (numeric only, no
other characters can reach the shell) and then invokes exactly
`execFile('cmd.exe', ['/c','start','','steam://rungameid/' + steam_app_id])`
— same `execFile`-only, no-shell-interpolation rule as every other command.
This keeps games server-side-safe without requiring a `links.json` entry per
game, while `config/games.json` stays the presentation-layer source (labels,
icons, recently-played/favorites ordering) the frontend reads to build the
Gaming screen. Add this endpoint behavior to the server implementation;
`architecture-security.md` §4.2's table should be treated as extended with
this row (the security subagent's doc doesn't need a rewrite for one row —
noted here as the authoritative addition).

## 3. Directory ownership (no subagent overwrites another's files)

| Owner | Path | Contents |
|---|---|---|
| Frontend subagent | `frontend/` | All HTML/CSS/JS, PWA manifest, service worker, data providers (mock + live) |
| Server subagent | `server/` | Node.js Express+ws service, all command handlers, optional module stubs |
| Lead (already done) | `config/` | `apps.json`, `links.json`, `maintenance.json`, `service.json`, `games.json`, `profiles.json`, `smarthome.json` — subagents may *read* these and may propose additions via their final report, but the lead applies any config schema changes to avoid clobbering |
| Lead (already done) | `docs/design-system.md`, `docs/architecture-security.md`, `docs/reconciliation.md` | design/security contract |
| Later subagents | `docs/tablet-setup.md` (tablet subagent), `tests/` + `docs/test-report.md` (integration subagent) | own their own new files only |

Neither implementation subagent should edit `docs/design-system.md` or
`docs/architecture-security.md` — if either finds a genuine contract bug,
they report it back in their summary rather than editing the spec files
directly, since the lead needs a single reconciliation point.

## 4. Technology choices (locked by the lead)

- **Frontend**: vanilla HTML/CSS/JS, ES modules, **no framework, no build
  step**. Served as static files directly by the Node server (or any static
  server during dev). This is the lightest possible stack for a 3GB-RAM
  tablet and matches "avoid unnecessary dependencies." A service worker
  handles PWA offline shell caching.
- **Server**: Node.js + Express + `ws`, per `architecture-security.md`'s own
  assumption. Dependencies kept minimal: `express`, `ws`,
  `systeminformation`, plus whatever small native/audio helper the server
  subagent picks per §4.4 of the security doc (document the exact package
  chosen in the server's own README).
## 5. Post-build reconciliation (applied after frontend + server subagents reported back)

Both subagents flagged real, matching gaps in their final reports
(`docs/frontend-notes.md` + the server subagent's inline report). The lead
applied the following fixes directly (both subagents had already finished,
so no ownership conflict):

- Added `GET /api/v1/config/games` and `GET /api/v1/config/smarthome` to
  `server/src/routes/config.js`, matching the paths the frontend's live
  provider already assumed.
- Added `pc_name` to `GET /health`'s response (`server/src/routes/health.js`)
  sourced from `config/service.json.pcName` — low-sensitivity, useful
  pre-pairing.
- Extended `config/maintenance.json` (and the frontend's bundled seed copy)
  with 7 new non-dangerous entries the frontend was already sending and
  getting 404s for: `open-task-manager`, `take-screenshot`,
  `open-controller-tools`, `toggle-game-mode`, `toggle-perf-overlay`,
  `start-screen-recording`, `stop-screen-recording`. Added matching handler
  stubs to `server/src/commands/exec.js`'s `knownHandlers` map, following
  the exact `TODO(real-windows)` pattern the server subagent already used
  for `empty_recycle_bin`/`restart_spotify`/`clear_temp_files` — each is
  fully functional under `mockExec` today, with the real Windows call
  documented as a scoped follow-up.
- Media output-device selection and "source" chips: accepted as
  informational-only for v1, per the frontend's own reasoning (no
  device-enumeration/switching command exists in the architecture spec;
  inventing one wasn't in scope for this pass). Documented here as an
  intentional v1 limitation, not an oversight.
- Server subagent's three flagged decisions, reviewed and accepted:
  (1) always binding loopback alongside LAN interfaces, for the PC-tray
  "manage paired devices" surface described in architecture-security.md
  §2.5 — correct, the spec implied this without stating it explicitly;
  (2) `GET /health` implemented at the literal `/health` path (not
  `/api/v1/health`) — correct, matches the endpoint table's own row;
  (3) `/config/apps` strips `exePath`/`args` before returning to the
  tablet — approved, this is the right call (no reason to leak local
  filesystem paths to the client) and is now the standard the two new
  `/config/games`/`/config/smarthome` routes above also follow (no
  server-internal fields exposed).

Verified live after applying: server restarted, `/health` returns
`pc_name`, `/config/games` and `/config/smarthome` return the expected
shapes, and both `toggle-game-mode` and `take-screenshot` maintenance
commands are accepted (202) instead of 404.

## 6. Post-test-report fixes (applied after the integration/testing subagent's report)

`docs/test-report.md` found 1 HIGH bug, 1 real (non-automation-artifact) bug
from its click-quirk investigation, and 2 lower-severity bugs. The lead
fixed all four directly (both build subagents had finished, no ownership
conflict) and verified each fix live in the browser against the real server:

- **Bug #1 (HIGH) — stale/invalid token stuck the app in an infinite
  reconnect loop instead of returning to pairing.** Fixed in
  `frontend/src/data/liveProvider.js` (new `invalidateAuth()`, called from
  both the REST-401 path in `apiFetch` and the WS-close path when the code
  is `4401`/`4403`, replacing the old unconditional `scheduleReconnect()`)
  and `frontend/src/app.js` (`showPairingGate()` is now reusable — wired to
  `provider.subscribeAuthInvalid()`, not just the one-time startup check).
  Added `subscribeAuthInvalid(cb)` to the provider contract
  (`data/provider.js`) and a no-op implementation in `mockProvider.js`.
  While verifying this fix live, found and fixed a second-order gap it
  exposed: screens fetch their config data once at mount time with no
  reactive re-fetch, so a *reactive* re-pair (session went bad mid-session,
  as opposed to the initial pre-mount gate) left already-mounted screens
  permanently empty even with a fresh valid token. Fixed by having
  `showPairingGate({ reloadOnSuccess: true })` do a full `location.reload()`
  after a reactive re-pair succeeds (not the initial gate, which runs
  before anything mounts) — simple and robust since the fresh token is
  already in `localStorage` by then. Verified end-to-end twice in-browser:
  seeded an invalid token, confirmed the pairing screen appears (not stuck
  reconnecting), confirmed exactly one WS rejection in server logs (not a
  repeating flood), re-paired, confirmed all data (Launch grid, Now
  Playing, Status, Power) loads correctly after the reload.
- **Click-suppression bug (real, not just a CDP artifact) — `app.js`'s
  swipe handler called `setPointerCapture()` on every pointerdown anywhere
  in the content area, which per the Pointer Events spec could retarget
  the following click away from the tapped button.** Fixed by deferring
  capture until the pointer has actually moved past an 8px threshold (the
  standard tap-vs-swipe disambiguation distance) — a plain tap now never
  captures the pointer, so its click reaches the real target exactly as if
  no gesture handler were present. Verified: 4/4 automated clicks on the
  Home/System Lock button (including the confirm-dialog's own Lock button)
  succeeded after the fix, versus roughly 1/3 before it.
- **Bug #2 (MEDIUM) — Command History drawer response-key mismatch.**
  Server returns `{ history: [...] }`
  (`server/src/routes/commands.js`); frontend was reading `data.commands`.
  Fixed `liveProvider.js`'s `getCommandHistory()` to read `data.history`.
  Also fixed a secondary mismatch found in the same code path:
  `historyDrawer.js` read `item.target`, but the server's actual field is
  `target_id` — updated to check both (mock provider genuinely uses
  `target`). Verified via `curl` against a real executed command.
- **Bug #3 (LOW) — pairing code took up to 30s to regenerate after being
  claimed.** `server/src/routes/pairing.js` now accepts an `onClaimed`
  callback, invoked immediately after a successful claim; `index.js` wires
  it to the existing `ensurePairingCode()`. Verified via `curl`
  (`GET /pairing/current` returns a fresh code immediately after a claim,
  not after the next 30s tick).

Not fixed (left as documented, low-priority, cosmetic-only per the report):
the confirmation dialog's countdown-expiry looking identical to an explicit
Cancel, and the possible duplicate "command sent" toast on a single
confirmed dangerous command (not reproduced during verification, may be
intermittent — worth a follow-up look if it recurs).

## 7. Real Linux (Omarchy) command support

After the project was otherwise complete and deployed for a walkthrough,
the user clarified that the actual PC being controlled is this Omarchy
(Hyprland/Arch Linux) machine, not a Windows PC as the original brief
assumed. The user explicitly asked for real Linux command support (not
"support both" as a formal dual-platform abstraction, and not "stay
Windows-only") — implemented as a `process.platform === 'linux'` branch
alongside the existing Windows code wherever it mattered, rather than a
larger restructure. See `server/README.md`'s "Real vs mockExec-stubbed"
table for the full real-vs-mocked-vs-TODO breakdown per command, all
verified live against this actual machine (real windows opened, real
volume/mic changes confirmed via `wpctl`/`pactl`, a real screenshot file
appeared, a real session lock was triggered through the full two-step
confirm flow).

Two real bugs were found and fixed while wiring this up (not pre-existing
Linux-specific issues — both would have affected a real Windows deployment
too, just never exercised since Windows was always mockExec'd during
development):

- **`runExeFile` used to wait for the launched process to exit** (via
  `execFile` with a 15s timeout) before reporting success. This is fine for
  a short utility like `ipconfig /flushdns`, but wrong for launching a GUI
  app — Steam/a browser/a file manager don't exit on their own, so the
  original implementation would have waited the full 15s and then
  **SIGTERM'd the freshly-launched app**. Confirmed this would have broken
  every real `launch_app`/`open_link`/`launch_game` invocation on Linux
  (where launched processes don't self-detach the way some Windows GUI
  apps happen to). Fixed by switching to `spawn` with `detached: true` +
  `unref()`, resolving as soon as the child has actually started (the
  `spawn` event) rather than waiting for it to finish.
- Related: `config/links.json`'s file/folder existence check (`config.js`)
  only ever ran on `win32`, silently skipping validation everywhere else —
  now checks on Linux too when a target looks like a Linux path, so a
  typo'd real path in `apps.local.json`/`links.local.json` gets a warning
  instead of failing silently at launch time.

New/changed files for this addition: `server/src/commands/exec.js` (spawn
fix + Linux branches on every handler), `server/src/commands/index.js`
(`openTarget()` helper, Linux `power_action` exec map), `server/src/commands/media.js`
(`LinuxMediaController`, PipeWire/WirePlumber/playerctl-backed), `server/src/config.js`
(mockExec no longer forced on for Linux; link-existence check platform fix),
`server/src/index.js` (selects `LinuxMediaController` on `process.platform
=== 'linux'`), `config/maintenance.json` (`flush-dns` converted from a
Windows-specific `exePath` entry to a portable `handler` entry, since every
other maintenance action already used the OS-branching handler pattern —
this was a config-schema improvement, not personal-path leakage, so it's
tracked, not local-only), and two new gitignored local overrides,
`config/apps.local.json` / `config/links.local.json`, with this machine's
real paths.

One known gap, not fixed: `playerctl` isn't installed on this machine, so
real media transport control and now-playing metadata don't work yet
(`sudo pacman -S playerctl` closes this — left for the user rather than
installing a new system package without being asked).

- **Dev-mode exec safety**: this repo is being developed on a Linux
  workstation, but the server's command execution (`execFile('shutdown.exe'
  ...)` etc.) is Windows-only and will error on any other OS. The server
  **must** implement a `mockExec` mode (`config/service.json`'s `mockExec`
  flag, or auto-detected via `process.platform !== 'win32'`) where OS-level
  command execution is replaced with a logged no-op that still returns a
  realistic `command_result`. This is required for the integration/testing
  subagent to exercise the full command flow end-to-end without a Windows
  box, and does not weaken the real Windows behavior (mock mode is
  explicitly never the default when `process.platform === 'win32'`).
