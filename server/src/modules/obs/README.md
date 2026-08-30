# OBS Studio module (stub)

Status: **disabled by default**. `config/service.json` → `modules.obs.enabled`.

The `obs` app tile in `config/apps.json` already just launches OBS via the
normal `launch_app` command path — that part is real and works today. This
module is only for *deeper* control (scene switching, start/stop recording,
start/stop streaming) beyond simply opening the app.

## What it would need to become real

1. Add dependency `obs-websocket-js` (justify in server/README.md's
   dependency list if picked up).
2. Config additions: `modules.obs.host` (default `localhost`),
   `modules.obs.port` (default `4455`), `modules.obs.password` (obs-websocket
   v5 auth password — secret, gitignored override file only).
3. Implement `connect()` using the package's `OBSWebSocket` client,
   `getSceneList()`/`setCurrentScene()` via the `GetSceneList`/
   `SetCurrentProgramScene` requests, and recording/streaming via
   `StartRecord`/`StopRecord`/`ToggleStream`.
4. Add `/api/v1/obs/*` routes gated behind `modules.obs.enabled`.

Self-contained — no core redesign needed.
