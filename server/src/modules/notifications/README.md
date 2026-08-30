# Notifications module (stub)

Status: **disabled by default**. `config/service.json` → `modules.notifications.enabled`.

Largest security surface of the optional modules: notification *content*
(potentially including message previews from other apps) would cross the
trust boundary from the PC to the tablet. Left unimplemented deliberately
rather than rushed — see reconciliation.md §1.

## What it would need to become real

1. Windows `UserNotificationListener` (WinRT) requires the app to declare
   the notification listener capability and the user to grant consent via
   Windows Settings — this alone is a meaningful chunk of platform-specific
   work needing a native/WinRT bridge (similar to the media-session bridge
   documented in `server/src/commands/media.js`).
2. Add a `notification_push` WS message type (server→client) to the
   envelope defined in architecture-security.md §1.3, payload
   `{ id, app, title, body, timestamp }`.
3. Add a content filter/allowlist (e.g. only forward notifications from
   apps the owner explicitly opts in per-app) before ever pushing to the
   tablet — do not forward everything by default given the security
   surface noted above.
4. Wire `start()` to call the WS broadcast helper already used for
   `status_update`/`now_playing_update` in `server/src/ws/server.js`.
