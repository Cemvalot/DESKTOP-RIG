# Home Assistant module (stub)

Status: **disabled by default**, not implemented against a live instance.
`config/service.json` → `modules.homeassistant.enabled` gates whether this
module is even required — the core server never imports it when the flag is
false.

## What it would need to become real

1. Config additions (owner-supplied, should live in a gitignored
   `config/service.local.json` override, never committed):
   - `baseUrl` (e.g. `http://homeassistant.local:8123`)
   - `longLivedAccessToken` (HA's own bearer token — a *secret*, never in
     `config/service.json` itself)
2. Implement `getStates()` as a `fetch(baseUrl + '/api/states', { headers: { Authorization: 'Bearer ' + token } })`.
3. Implement `callService(domain, service, data)` as a `POST` to
   `baseUrl + '/api/services/' + domain + '/' + service'`.
4. Wire the Smart Home screen's tile actions (`config/smarthome.json`) to
   call `callService` with the right domain/service per tile type (e.g.
   `light.turn_on` with `brightness_pct`).
5. Add basic connection-health checking so the frontend's "Not connected"
   placeholder state (design-system.md §15.6) can flip to live once
   `getStates()` succeeds at startup.

This is a small, self-contained follow-up — no core server redesign
required, since `server/src/routes` already has a place to add
`/api/v1/smarthome/*` routes that would call into this module.
