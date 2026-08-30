# Launchpad — Integration & Test Report

Performed by the integration/testing subagent against a live instance
(`cd server && node src/index.js`, frontend served from the same origin at
`http://127.0.0.1:8787/`, Linux dev box, `mockExec` auto-engaged). Two
throwaway test scripts are kept in `tests/` (`api-test.js`, `api-test-part2.js`)
— run with `node tests/api-test.js` / `LAUNCHPAD_TOKEN=<token> node tests/api-test-part2.js`
against a running server.

**Overall verdict: core system is solid — every command, the confirm flow,
rate limiting, and the config/auth contract all work correctly end to end.
One high-severity frontend bug was found (stale/invalid token → infinite
reconnect loop instead of re-pairing) plus a few smaller issues. See "Bugs
found" below.**

---

## 1. Pass/fail checklist

### Commands, end to end (via `tests/api-test.js` + `api-test-part2.js`, live server, real HTTP)

| Command | Result |
|---|---|
| `launch_app` (browser, steam, spotify) | PASS (202, mockExec logs correct `execFile` args) |
| `launch_app` unknown id | PASS (404 `UNKNOWN_APP_ID`) |
| `open_link` (url: github, folder: downloads, folder: desktop) | PASS |
| `open_link` unknown id | PASS (404 `UNKNOWN_LINK_ID`) |
| `launch_game` valid `steam_app_id` | PASS (202, mocked `steam://rungameid/570`) |
| `launch_game` non-numeric `steam_app_id` (`"rm -rf /"`) | PASS (400 `INVALID_STEAM_APP_ID`, regex enforced server-side) |
| `media_control` play/pause/next/previous/stop | PASS (all 200) |
| `volume_set` level=42, mute=true/false | PASS |
| `mic_mute` true/false | PASS |
| `power_action` lock/sleep/restart/shutdown | PASS — **all four** return `confirmation_required` with a `confirm_token`, never execute directly |
| `power_action` confirm → executes | PASS (mockExec logs exact `rundll32.exe`/`shutdown.exe` args per spec §4.5) |
| `power_action` confirm_token reuse | PASS (409 `CONFIRMATION_ALREADY_USED`) |
| `maintenance` — all 11 entries (incl. the 7 newly-added: open-task-manager, take-screenshot, open-controller-tools, toggle-game-mode, toggle-perf-overlay, start/stop-screen-recording) | PASS (non-dangerous → 202; dangerous `empty-recycle-bin`/`clear-temp` → confirm flow → 200) |
| `maintenance` unknown id | PASS (404 `UNKNOWN_TASK_ID`) |
| Dangerous confirm — Cancel (never call `/confirm`) | PASS — command never executes; a late `/confirm` on an abandoned dangerous request also 410s once its window passes |
| Dangerous confirm — expiry | PASS (410 `CONFIRMATION_EXPIRED` after the configured 10s window; UI dialog also self-closes cleanly on its own countdown, see §3 below) |
| Rate limit — dangerous execute (5/min) | PASS (429 on the 6th+ rapid dangerous request, `Retry-After` header present and correct) |
| Rate limit — WS reconnect (20/min) | PASS, but see Bug #1 — this limit gets tripped *unintentionally* by the reconnect-loop bug |
| Unauthorized — no token / garbage token / revoked token | PASS — all three cleanly 401 `INVALID_TOKEN` at the API level |
| Pairing — claim, single-use enforcement, `/health`+`/pairing/current` | PASS |

52+ individual assertions passed at the API layer (57 raw checks in
`api-test.js`; 5 apparent "failures" there were a test-script rate-limit
collision, not real bugs — see the script's own output — confirmed clean
on rerun with a fresh token in `api-test-part2.js`, 6/6 passed).

### UI / browser-driven checks

| Area | Result |
|---|---|
| 1280×800 canvas render, all 5 screens, no overflow/scroll | PASS (see §2 — literal window resize wasn't achievable in this environment, verified via the app's fixed internal 1280×800 canvas instead) |
| Tab bar taps switch all 5 screens | PASS |
| Swipe-to-navigate (drag gesture) | PASS — dragged from Home → Gaming, transform+opacity transition, active-tab indicator updated correctly |
| Confirmation dialog — visual (§15.7 spec match) | PASS — warning icon, live "Expires in Ns" countdown, Cancel large/left, danger action small/right/red |
| Confirmation dialog — Confirm executes | PASS — full round trip verified via server logs (execute → confirmation_required → confirm → mockExec → command executed → toast → history refresh) |
| Confirmation dialog — Cancel / natural expiry | PASS functionally (command never executes either way) — minor UX note, see §4 |
| Double-tap protection | PASS — a genuine `double_click` gesture on the Steam launch tile produced **exactly one** `launch_app` execute request server-side, not two (verified via server request log) |
| Connection-lost overlay (server killed) | PASS — overlay appears within ~1s, matches §15.8 (pulsing ring, "Reconnecting to DESKTOP-RIG…", live "Last connected Ns ago", Retry Now), no blank screen, no console errors |
| Reconnect after transient outage (valid token preserved) | PASS — server restarted, client reconnected automatically once the server came back, returned to last-active tab, status data resumed |
| Reconnect after invalid/stale token | **FAIL — see Bug #1** |
| Unauthorized command → frontend shows pairing screen | **FAIL — see Bug #1** (stuck reconnecting instead) |
| Memory — server RSS | PASS-ish, informational: ~97MB steady RSS, ~2% CPU idle-to-light-use (see §5) |
| Memory — browser JS heap | PASS — ~2.1MB used, no growth after 20 rapid tab-switch cycles |
| Console errors across a full click-through | PASS — zero new errors during legitimate use (pairing, all 5 screens, Settings, dialogs, disconnect/reconnect); the only console exceptions logged were the ones caused by Bug #1 itself |
| Command history drawer | **FAIL — see Bug #3** |

---

## 2. 1280×800 viewport note

The `resize_window` browser-automation tool had no effect in this
environment (Hyprland tiling WM — repeated resize requests from 1280×800
up to 1600×1000 and down to 900×600 were all silently ignored; the browser
window stayed pinned at its tiled size). This is an environment limitation,
not an app issue.

Instead this was verified structurally: `frontend/src/app.js`'s
`fitToViewport()` renders the app's `#app` root at a **fixed native
1280×800px box** (`offsetWidth`/`offsetHeight` confirmed as exactly
`1280`/`800`, `overflow: hidden` on both axes, `scrollWidth`/`scrollHeight`
match to within 1px) and then applies a single `transform: scale()` to
`document.body` to fit whatever the real viewport is. This means the
1280×800 grid is *always* rendered at its true design resolution
internally, regardless of the host window size — the "no overflow/scroll
at 1280×800" property holds by construction, not by accident, and was
visually confirmed on all 5 screens (screenshots taken at the (scaled)
viewport show no clipped panels or cut-off content on Home, Gaming, Media,
System, or Smart Home).

---

## 3. Automation-click quirk — investigation and conclusion

**This turned out to be a real, reproducible frontend bug, not purely an
automation-tool artifact — flagging it as the most important secondary
finding after Bug #1.**

### What was tested
Repeated `computer` tool `left_click`/`double_click` calls at verified
dead-center coordinates (cross-checked via `document.elementFromPoint`
immediately before each click) on buttons inside the swipeable content
area (Home's "Lock" button, a Home "Steam" launch tile), compared against
calling `.click()` directly via JS on the same element.

### Results
- `element.click()` (JS): **6/6 reliable**, dialog/command always fired.
- `computer.left_click`/`double_click` (CDP synthetic mouse dispatch) on
  buttons **inside** `#screens-viewport`: intermittently failed to fire the
  button's click handler at all (roughly 2 failures out of 3 clean trials
  on the Lock button, plus a failed Steam-tile trial) — no error, the tap
  simply produced no `click` event, confirmed via a temporary
  `addEventListener('click', …)` probe that never fired.
- `computer.left_click` on the **tab bar** (outside `#screens-viewport`,
  e.g. Home/Gaming/Media/System/Smart Home cells): **6/6 reliable**, zero
  failures across all navigation during this test pass.
- Real drag gestures (`left_click_drag` for swipe-nav) inside the viewport:
  reliable.

### Root cause found
`frontend/src/app.js`'s swipe-navigation gesture handler:
```js
viewport.addEventListener("pointerdown", (e) => {
  if (isInteractiveTarget(e.target)) return;
  dragging = true;
  ...
  viewport.setPointerCapture(e.pointerId);
});
```
`isInteractiveTarget()` only excludes `input[type="range"]` and
edit-mode tiles — **not** ordinary buttons/tiles/chips (Power cluster,
Launch tiles, Quick Actions, Maintenance chips, Media transport, Smart
Home toggles — i.e. almost every actionable control in the app, since all
5 screens live inside `#screens-viewport`). Confirmed via a monkey-patch on
`Element.prototype.setPointerCapture` that **every** pointerdown on the
Lock button does call `setPointerCapture` on `#screens-viewport`, which per
the Pointer Events spec retargets the subsequent `pointerup`/compatibility
`mouseup` to the capturing element instead of the tapped button — which is
a plausible, and empirically well-correlated, mechanism for the resulting
`click` event failing to reach the button's own handler. The behavior was
timing-sensitive (not 100% reproducible every time), consistent with a
race between gesture-capture and the browser's own down/up-target-based
click synthesis.

### Does this affect a real finger tap on the real tablet?
**Plausibly yes — this is not purely a CDP/mouse-simulation artifact.**
`setPointerCapture` and its event-retargeting behavior are part of the
generic W3C Pointer Events spec and apply identically regardless of
whether the pointer is a mouse, pen, or touch input; Chrome's Android
WebView implements this uniformly. Since the capture is armed
unconditionally on **every** pointerdown anywhere in the content area,
every screen's buttons are theoretically exposed to the same
race — including the Home/System **Lock/Restart/Shutdown** power cluster,
which is exactly the kind of control where a silently-swallowed tap would
be most noticeable (and, ironically, least harmful, since the confirm
dialog wouldn't open on a swallowed tap — no accidental shutdown risk, just
a "nothing happened, I have to tap again" annoyance).

**Recommendation for the lead:** either (a) broaden
`isInteractiveTarget()` to exclude any element matching
`button, .tile, .chip, [role="button"]` (not just range inputs/edit-mode
tiles), or — more robust and future-proof — (b) defer the
`setPointerCapture()` call until the drag has actually moved past a small
threshold (e.g. ~8px), which is the standard pattern for disambiguating a
tap from a swipe and fixes this for every current and future control
without an exclusion list to maintain.

---

## 4. Bugs found

### Bug #1 — HIGH — Invalid/stale bearer token leaves the app stuck in an infinite "Reconnecting…" loop instead of showing the pairing screen

**Repro:** Have a `launchpad.token` in `localStorage` that the server no
longer recognizes (e.g. the state file was cleared/lost, or the token was
revoked, or — realistically — the PC's Launchpad service was reinstalled).
Load the app with `launchpad.providerMode = 'live'`.

**Expected** (architecture-security.md §2.6, and explicitly called out in
this task's own test brief): the app detects the invalid token and shows
the pairing screen again.

**Actual:** the app gets stuck permanently on the full-screen "Reconnecting
to DESKTOP-RIG…" overlay, periodically flashing a spurious green
"Reconnected" toast, and never recovers or offers re-pairing. Confirmed via
console: repeated uncaught `ProviderError: Missing or invalid bearer
token.` exceptions from every screen's data-fetching call
(`getApps`/`getMaintenanceCommands`/etc., all originating in
`liveProvider.js:94` `apiFetch`).

**Root cause (three compounding issues, all in `frontend/src/`):**
1. `frontend/src/data/liveProvider.js`'s `isPaired()` only checks whether a
   token *string exists* in `localStorage`, never whether the server still
   considers it valid — so `frontend/src/app.js`'s pairing gate
   (`if (!provider.isPaired()) { …show pairing screen… }`) is skipped
   entirely for a stale-but-present token.
2. The server's WS upgrade handshake completes (sends the HTTP 101 /
   fires the client's `open` event) **before** it checks the token and
   closes with code `4401` — confirmed directly:
   `open at T`, `close code=4401 reason=invalid_token at T+5ms`. Because
   `liveProvider.js`'s `open` handler unconditionally resets
   `backoffMs = 1000` and calls `setConnectionState("connected")` (which
   triggers the "Reconnected" toast) before the close arrives, this
   produces a rapid **connected → reconnecting** flicker on every attempt.
3. `liveProvider.js`'s WS `close` handler doesn't inspect the close code at
   all — it calls `scheduleReconnect()` unconditionally, so it can never
   distinguish "the token is bad, stop and re-pair" (codes `4401`/`4403`)
   from "the network blipped, keep retrying" (any other close). Combined
   with point 2 always resetting `backoffMs` back to 1000 right before
   scheduling, **the exponential backoff never actually grows** — server
   logs show reconnect attempts roughly every 1–2 seconds indefinitely
   instead of the spec'd 1s→30s ramp, which is frequent enough that it
   eventually trips the server's own WS-reconnect rate limiter
   (`ws upgrade rejected: rate limited`, 20/min) — a second-order symptom
   of the same root cause.

**Impact:** any tablet whose paired token becomes invalid (service
reinstall, state-file loss, manual revocation from the PC side, or simply
this Linux dev environment's non-persistent-by-default local state) is
left in a completely dead, unrecoverable UI state with no way back to
pairing short of a manual `localStorage.clear()` — this is a real
kiosk-reliability issue, not just an edge case, since re-pairing after
token loss is an explicitly documented, expected flow (§2.6).

**Not fixed** (non-trivial, spans the pairing gate + WS lifecycle logic in
two files — recommend the lead reviews the reconnect state machine as a
whole rather than a one-line patch). Suggested direction: have the WS
`close` handler check `event.code` and, on `4401`/`4403`, clear the stored
token and re-run the pairing gate instead of scheduling a reconnect; and/or
have `apiFetch` centrally react to any `401` by doing the same, rather than
only ever throwing.

### Bug #2 — MEDIUM — Command History drawer never shows history via the live provider (response key mismatch)

`server/src/routes/commands.js`'s `GET /api/v1/commands/history` returns
`{ "history": [...] }`, but `frontend/src/data/liveProvider.js`'s
`getCommandHistory()` reads `data.commands` (`return data.commands ||
data;`). Since `data.commands` is always `undefined`, this falls back to
returning the whole response object (not an array), and the History
drawer always renders "No commands yet." regardless of actual history —
confirmed live: executed a Lock (confirmed) and a Steam launch through the
UI, then opened the drawer; server had `history: [...]` with entries (and
`GET /commands/history` returned 200 both times) but the drawer showed
empty. This endpoint's shape isn't defined in `architecture-security.md`
(it's a reconciliation.md-added feature with no specified contract), so
neither side is "wrong" per a written spec — just a mismatch between two
independent guesses. **Not fixed** — flagging for the lead to pick one key
name and align both sides (or have the frontend accept `data.history ||
data.commands || []`).

### Bug #3 — LOW — Pairing code takes up to 30s to regenerate after being claimed/expired

`server/src/index.js`'s dev-convenience auto-regeneration
(`setInterval(ensurePairingCode, 30_000)`) only checks/regenerates every
30 seconds, so `GET /pairing/current` returns `404 NO_ACTIVE_CODE` for up
to 30s immediately after a code is claimed — contradicting the server
README's own claim that it "auto-regenerates one whenever the active code
expires or gets used" (implying immediacy). Minor since this only affects
the dev-convenience auto-pairing-code display, not the pairing security
model itself, and not user-facing on a real deployment (a real PC-tray
"Pair a new device" action would generate on demand). **Not fixed** — a
one-line change (regenerate immediately inside the `claim()` success path
rather than only on the 30s tick) would close this if the lead wants it.

### Minor observations (not filed as bugs)

- The confirmation dialog's natural countdown-expiry path (`remaining <= 0
  → close(false)`) is visually identical to an explicit Cancel — no toast
  or message distinguishes "you ran out of time" from "you tapped
  Cancel." Functionally safe (command never executes either way), just a
  small clarity gap.
- Observed the toast "Lock command sent." fire twice for a single
  confirmed Lock command in one trial. Didn't chase this down further
  given time budget — worth a quick spot-check of `runCommand()`'s
  success-toast path for a possible double-emit (optimistic + WS
  `command_result`-driven).

---

## 5. Resource usage (informational — this is a Linux dev box standing in for a 3GB tablet, not representative tablet numbers)

| Metric | Value |
|---|---|
| Node server RSS, idle | ~97 MB |
| Node server CPU, idle/light use | ~2% |
| Browser tab JS heap used | ~2.1 MB |
| Browser tab JS heap total (reserved) | ~3.4 MB |
| JS heap after 20 rapid tab-switch cycles | ~2.2 MB (no meaningful growth — no obvious leak) |

Nothing here suggests a leak or runaway resource use; the frontend's
no-framework/no-build vanilla JS approach is living up to its lightweight
goal. Server RSS (~97MB) is comfortably within budget for any real
Windows PC this would run on, and is irrelevant to the 3GB tablet (which
only runs the browser tab, not the server).

---

## 6. Recommended improvements (priority order)

1. **Fix Bug #1** (stale-token reconnect loop) — highest priority, this is
   a real kiosk-reliability gap for an explicitly-documented recovery path.
2. **Fix the click-suppression root cause** (§3) by narrowing when
   `setPointerCapture` is armed on the swipe viewport — even though the
   real-tablet impact is unconfirmed (vs. proven for CDP automation), the
   mechanism is spec-general enough that it's worth closing defensively
   given how cheap the fix is (a drag-distance threshold).
3. **Align the command-history response shape** (Bug #2) — trivial fix,
   currently a fully-dead feature over the live provider.
4. Low priority: pairing-code regeneration lag (Bug #3), the
   expiry-vs-cancel dialog clarity gap, and the possible duplicate toast.

## 7. Files

- `tests/api-test.js`, `tests/api-test-part2.js` — throwaway Node scripts
  exercising the full command matrix, auth, confirm flow, and rate limits
  against a live server (`node tests/api-test.js`, then
  `LAUNCHPAD_TOKEN=<token> node tests/api-test-part2.js` for the
  rate-limit-window-sensitive tests).
- No source files were modified — no bug found here was trivial/isolated
  enough to fix inline per this task's instructions (Bug #2 came closest,
  but its "correct" side is genuinely ambiguous with no written contract
  to arbitrate it, so it's left for the lead to pick a convention).
