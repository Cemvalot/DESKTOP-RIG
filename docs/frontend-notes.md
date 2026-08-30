# Frontend notes (for the lead)

Written by the frontend implementation subagent after building out
`frontend/` in full against `design-system.md`, `architecture-security.md`,
and `reconciliation.md`. See `frontend/README.md` for the full
implementation summary, file structure, and provider-switching
instructions. This file is only the items worth flagging back.

## Gaps found in the contract docs (not edited — flagging per reconciliation.md §3)

1. **`architecture-security.md` §1.2's endpoint table has no path for
   Gaming's game-library/recent/favorites data or Smart Home's tile
   config.** Only `/config/apps`, `/config/links`, `/config/maintenance`
   are listed, but `config/games.json` and `config/smarthome.json` clearly
   need the same runtime-fetch treatment (reconciliation.md §2 says
   "`config/games.json` stays the presentation-layer source... the
   frontend reads to build the Gaming screen," implying a fetch path
   exists). The live provider guesses `/api/v1/config/games` and
   `/api/v1/config/smarthome` following the established convention —
   please confirm/add these two rows to the server's route table.

2. **No command contract exists for several pieces of "required content"**
   listed in the original brief: Game Mode toggle, Perf Overlay toggle,
   Controller Tools, Screenshot, Screen Recording (start/stop), Open Task
   Manager. `architecture-security.md` §4.2's command table and
   `config/maintenance.json`'s seed only cover flush-dns/empty-recycle-bin/
   restart-spotify/clear-temp. The frontend sends these as `maintenance`
   commands with proposed `task_id`s (listed in `frontend/README.md`
   "Known gaps" §2) — they'll 404 against the real server until
   `config/maintenance.json` gets matching entries and the server's
   maintenance handler map is extended. This was a deliberate choice
   (frontend must not invent its own allowlist) rather than an oversight.

3. **No endpoint/field for the PC's display name** (`config/service.json`'s
   `pcName`) is exposed over the live API — not in `/status`, not in
   `/health`. The frontend falls back to a locally-cached guess. Consider
   adding `pc_name` to `GET /health` (it's already unauthenticated and
   fairly low-sensitivity) or `/status`.

4. **Media "output device" and "source app" are uncontrollable per the
   spec as written** — §4.4 only controls the OS's *currently active*
   media session, with no device-enumeration or output-switching command.
   The Media screen's Output selector and Source chips are rendered as
   informational only (not wired to any command) to avoid faking control
   that doesn't exist server-side. If per-device output switching is
   wanted, it needs a new command type + Core Audio device-enumeration
   support on the server.

## Everything else

No other issues found — `design-system.md` and `architecture-security.md`
were internally consistent and detailed enough to implement without
further guesswork. All layout numbers in §15's wireframes were followed
faithfully (adjusted only where the literal ASCII proportions didn't
actually fit real font/padding math at 1232×632 — e.g. System screen's
Quick Actions/Maintenance rows are chip-style like Smart Home's Scenes
rather than 96px square tiles, since the wireframe's own bracket notation
`[Flush DNS] [Restart Spotify]` reads as chips, not action tiles, and 96px
tiles for 4+ maintenance items literally don't fit under the row height
the wireframe implies).
