# Launchpad — Frontend

Static, dependency-free PWA for the Galaxy Tab A8 kiosk dashboard. Plain
HTML/CSS/JS with ES modules — no framework, no bundler, no npm packages.
Implements the visual/interaction spec in `docs/design-system.md` and the
API contract in `docs/architecture-security.md` (see `docs/reconciliation.md`
for scope decisions).

## Running it locally (dev convenience only)

Any static file server works. From `frontend/`:

```sh
python3 -m http.server 8899
# or
node -e "require('http').createServer((q,s)=>require('node:fs').readFile('.'+decodeURIComponent(new URL(q.url,'http://x').pathname).replace(/\/$/,'/index.html'),(e,d)=>e?(s.writeHead(404),s.end()):s.end(d))).listen(8899)"
```

Then open `http://localhost:8899/index.html` in a Chromium-based browser at
1280×800 (or use DevTools device emulation). The app defaults to the **mock
provider**, so it is fully demoable with zero backend running.

Neither command is a project dependency — they're only used to serve the
already-static files during development. Nothing in `frontend/` requires a
build step; whatever is in the directory is exactly what ships.

## File structure

```
frontend/
  index.html            App shell (single page, fixed 1280×800 canvas)
  manifest.json          PWA manifest (fullscreen, landscape)
  service-worker.js      Offline app-shell caching (never caches /api or /ws)
  assets/icon.svg        SVG app icon (used at all manifest sizes)
  src/
    app.js               Bootstrap: chrome, tab/swipe nav, live-data fan-out
    data/
      provider.js         Provider CONTRACT (JSDoc) + shared Channel/error types
      mockProvider.js      Deterministic fake-data implementation (default)
      liveProvider.js       Real fetch/WebSocket implementation
      index.js              getProvider()/setProviderMode() — the ONE switch point
      seed/*.json            Bundled copies of config/*.json (mock fallback data)
    state/
      store.js             localStorage-backed settings/profile/layout/recents
      commands.js           runCommand() — the command+confirm+feedback orchestrator
    components/            Reusable UI: tiles, dialogs, toasts, nav, panels, icons
    screens/                home.js, gaming.js, media.js, system.js, smarthome.js
    styles/
      tokens.css            Verbatim design-system.md §17 token reference
      base.css, components.css, screens.css
```

## Data-provider abstraction (read this before wiring the real server)

Every screen/component talks to the PC exclusively through the provider
interface documented in `src/data/provider.js`. Nothing outside `src/data/`
calls `fetch`/`WebSocket` directly, and nothing in `frontend/` contains any
Windows-specific logic — commands are sent as the abstract shapes from
`architecture-security.md` §4 (`{type:'launch_app', app_id}`, etc.) and the
server resolves them.

- **Switch mock ↔ live**: `src/data/index.js` reads
  `localStorage['launchpad.providerMode']` (`'mock'` default, or `'live'`).
  Also exposed as a toggle in Settings → Developer disclosure (reloads the
  page after switching). Programmatically: `setProviderMode('live')` from
  `src/data/index.js`.
- **Entry point for server integration**: `getProvider()` in
  `src/data/index.js` returns whichever implementation is active. Both
  implementations satisfy the same method set — see the JSDoc contract at
  the top of `src/data/provider.js` for the full list (`init`, `isPaired`,
  `pair`, `revoke`, `getStatus`/`subscribeStatus`,
  `getNowPlaying`/`subscribeNowPlaying`, `subscribeConnection`,
  `subscribeCommandResult`, `getApps`/`getLinks`/`getMaintenanceCommands`/
  `getGames`/`getSmartHomeConfig`, `executeCommand`, `confirmCommand`,
  `mediaControl`, `setVolume`, `setMic`, `getCommandHistory`, `wol`,
  `getPcName`, `destroy`).
- **`liveProvider.js`** implements the real contract: REST calls to
  `/api/v1/...`, bearer token from `localStorage['launchpad.token']`, WS to
  `/ws` using the `Sec-WebSocket-Protocol: bearer.<token>` subprotocol per
  §1.3's recommendation, the message envelope (`type`/`id`/`payload`/
  `timestamp`), heartbeat pong replies, and exponential-backoff reconnect
  (1s → 30s cap). Override the server origin for dev via
  `localStorage['launchpad.serverBase'] = 'http://192.168.1.42:8787'`
  (`setServerBase()` export) if the frontend isn't served by the same
  process as the API.
- **`mockProvider.js`** simulates everything: CPU/GPU/RAM/temp drift, a
  looping fake now-playing track, ~250-900ms command latency with an ~8%
  simulated failure rate (for exercising failure states), and the same
  two-step `confirmation_required` → `confirm_token` flow the live server
  uses for dangerous commands.
- **Command lifecycle**: screens never call `executeCommand`/
  `confirmCommand` directly for anything user-facing — they call
  `runCommand(cmd, opts)` from `src/state/commands.js`, which drives the
  loading/success/failure tile states, the client confirmation dialog, the
  server's two-step confirm handshake, and haptic/sound feedback in one
  place.

## Config data

`config/apps.json`, `links.json`, `maintenance.json`, `games.json`,
`profiles.json`, `smarthome.json` are read at runtime — never hardcoded as
JS literals. The live provider fetches them from `/api/v1/config/*`; the
mock provider (and the live provider's `getGames`/`getSmartHomeConfig`,
where no REST path exists yet — see Known gaps) reads bundled copies in
`src/data/seed/*.json`, which are exact copies of the files in `config/`.
If the lead updates `config/*.json`, re-copy the changed file into
`src/data/seed/` to keep the mock demo in sync.

## What's implemented

- All 5 required screens, pixel/layout-matched to `design-system.md` §15's
  wireframes, fit 1280×800 with no scrolling.
- Persistent 5-tab bottom nav + top status strip; horizontal swipe between
  tabs (transform+opacity, 200ms, snap-back under 30% threshold).
- Confirmation dialogs for every dangerous command, wired to the server's
  two-step confirm flow (mock simulates it too).
- Toasts, loading/success/failure/disabled states, connection-lost overlay
  with auto-reconnect, idle/screensaver screen with burn-in position drift.
- Haptics (`navigator.vibrate`) + WebAudio-synthesized click, both
  toggleable in Settings.
- Settings panel: profile switcher, theme mode, haptics/sound, screen dim
  (Wake Lock + CSS overlay, explicitly labeled simulated), pairing status +
  re-pair, mock/live toggle (Developer disclosure), export/import of
  localStorage state as JSON.
- Profiles with per-profile Home layout + theme; night-profile dimmer
  accent via `[data-theme="night"]` token overrides (same token system, not
  a new palette); scheduled auto-switch via `profiles.json.themeSchedule`.
- Drag-and-drop "Edit Layout" mode (long-press a tile, or reorder while a
  grid is in edit mode) on Home/Gaming, persisted per-profile to
  localStorage.
- Favorites/recents tracked client-side from actual launches.
- Pairing screen: manual 6-char code entry (primary path) + opportunistic
  `BarcodeDetector` QR scan where the browser supports it; Wake-on-LAN
  button.
- Command history drawer (last few commands).
- PWA manifest + service worker (app-shell caching only; never caches
  `/api/*` or the WS upgrade).

## Known gaps / assumptions (flagged for the lead + server subagent)

1. **`getGames()` / `getSmartHomeConfig()` have no REST path in
   `architecture-security.md`'s endpoint table.** The live provider guesses
   `/api/v1/config/games` and `/api/v1/config/smarthome`, following the
   same convention as `/config/apps|links|maintenance`. Needs confirming
   (or adding) on the server side.
2. **Several Gaming/System actions have no defined command contract**:
   Game Mode toggle, Perf Overlay toggle, Controller Tools, Screenshot,
   Screen Recording, Open Task Manager. These are sent as `maintenance`
   commands with proposed `task_id`s (`toggle-game-mode`,
   `toggle-perf-overlay`, `open-controller-tools`, `take-screenshot`,
   `start-screen-recording`/`stop-screen-recording`,
   `open-task-manager`) that aren't yet in `config/maintenance.json`. The
   mock provider accepts them; the live provider will get a clean 404
   (`UNKNOWN_TASK_ID`) until the server config is extended — this is
   intentional (the frontend must not invent its own allowlist) rather
   than broken.
3. **Media "Output" device selector and "Source" chips are informational
   only.** §4.4 controls the currently-active OS media session, not a
   specific output device or app — there's no command to switch output
   hardware or force a source. Tapping the output chip shows a toast
   explaining this rather than silently no-op'ing.
4. **`getPcName()` has no dedicated endpoint** in the live provider (no
   field in `/status` or `/health` carries it); falls back to a
   `localStorage` value seeded during pairing metadata, or `"PC"`. Worth
   adding a `pc_name` field to `GET /status` or `/health` if the lead wants
   this fully live-accurate.
5. `config/service.json`'s `logDir`/`stateDir`/etc. are server-only fields;
   the frontend's bundled seed copy of `service.json` only reads `pcName`
   from it (mock provider) and otherwise ignores it.

## Verification performed

Served via `python3 -m http.server` and driven headlessly with Chromium
over the DevTools protocol (no npm test runner added). Confirmed: all 5
screens render within 1280×800 with no overflow/scrolling, tab-bar
navigation and swipe-to-navigate both work, a dangerous command
(`power_action: lock`) shows the confirmation dialog → confirm → success
toast → appears in the command history drawer, the Settings panel opens
with all sections, and the pairing screen renders correctly when the live
provider has no stored token. Zero console errors/exceptions across all of
the above.
