# Adding apps, links, games, and commands

Everything the tablet can launch or run is defined in plain JSON files in
`config/`. There is no code to write and nothing to rebuild — edit the
file, save it, and restart the server (`node src/index.js` in `server/`).
The tablet always fetches the current list from the server, so it picks up
changes automatically once the server has restarted.

The tablet **never** sends a file path, executable, or raw command — only
an `id` you define here. If an `id` isn't in these files, the server
rejects the request. This is intentional (see
`docs/architecture-security.md` §4) — it's what keeps the tablet from ever
running arbitrary commands on the PC.

## Adding an app (`config/apps.json`)

```json
{
  "id": "vlc",
  "label": "VLC",
  "icon": "video",
  "exePath": "C:\\Program Files\\VideoLAN\\VLC\\vlc.exe",
  "args": [],
  "dangerous": false,
  "tags": ["home"]
}
```

- `id` — lowercase, hyphenated, unique. This is what the tablet references.
- `exePath` — the **exact, full path** to the executable on the PC. Use
  double backslashes (`\\`) in JSON.
- `args` — an array of command-line arguments, if the app needs any.
  Leave as `[]` if not.
- `tags` — controls where the tile shows up: include `"home"` to show it
  on the Home screen's Launch grid, `"gaming"` for the Gaming screen's
  Quick Launch. An app can have both tags.
- `dangerous` — leave `false` for normal apps. Only set `true` if launching
  it should require the confirmation dialog (rare for apps — mostly used
  for power actions and destructive maintenance tasks, see below).
- `icon` — an icon name from the sprite in `frontend/assets/`
  (`design-system.md` §7 lists the available icon set — `steam`, `discord`,
  `browser`, `spotify`, `folder`, `terminal`, `video`, `controller`, etc.).
  Using a name that doesn't exist just shows a blank icon, it won't error.

## Adding a link, file, or folder (`config/links.json`)

```json
{
  "id": "budget-sheet",
  "label": "Budget.xlsx",
  "icon": "folder",
  "type": "file",
  "target": "C:\\Users\\owner\\Documents\\Budget.xlsx",
  "dangerous": false
}
```

- `type` is `"url"`, `"file"`, or `"folder"`. The server opens it with the
  matching Windows default handler.
- For `type: "url"`, `target` must be a full `http://` or `https://` URL.
- For `file`/`folder`, use the exact path. If the path doesn't exist yet
  when the server starts, you'll see a warning in the logs — that's just a
  heads-up, not an error, in case you're adding the entry before the file
  exists.

## Adding a game (`config/games.json`)

```json
{ "id": "my-new-game", "label": "My New Game", "icon": null, "launch": { "type": "url", "target": "steam://rungameid/1234567" } }
```

Add the entry to `library`. To have it show up in "Recently Played" or
"Favorites" on the Gaming screen, add its `id` to the `recentlyPlayed` or
`favorites` arrays too. The number in `steam://rungameid/<id>` is the
game's Steam App ID — find it in the game's Steam store URL
(`store.steampowered.com/app/<id>/...`).

## Adding a maintenance command (`config/maintenance.json`)

Maintenance commands are for one-off utility actions (not full apps) —
things like clearing a cache or restarting a background app. There are two
ways to define one:

**A fixed executable + arguments** (works for anything runnable as a
single command with fixed args, like the built-in `flush-dns` example):

```json
{ "id": "open-notepad", "label": "Notepad", "icon": "terminal", "exePath": "notepad.exe", "args": [], "dangerous": false }
```

**A named handler** (for anything that isn't a single clean executable
call — e.g. "empty the recycle bin" isn't a program you run, it's a
Windows API call):

```json
{ "id": "my-task", "label": "My Task", "icon": "close", "handler": "my_task_handler", "dangerous": true }
```

A `handler` entry needs a matching implementation added to
`server/src/commands/exec.js`'s `knownHandlers` map (see the existing
`empty_recycle_bin`/`restart_spotify`/`clear_temp_files` entries there for
the pattern) — this is the one case that needs a small code change rather
than just a config edit, since a handler is real server-side logic, not
just "run this .exe". On a non-Windows dev machine (`mockExec` mode) any
handler you add works immediately as a simulated success, so you can wire
up the config and test the full command/confirmation flow before writing
the real Windows implementation.

- Set `"dangerous": true` for anything destructive or hard to undo
  (deleting files, restarting a service, etc.). Dangerous commands always
  require the two-step confirm dialog on the tablet — this can't be turned
  off per-command, only added.

## After editing a config file

1. Save the file.
2. Restart the server (`Ctrl+C`, then `node src/index.js` again — or, once
   it's set up per `docs/windows-service-setup.md`, just let the scheduled
   task restart it, or restart it from Task Scheduler).
3. Reload the dashboard on the tablet (pull down to refresh, or just
   reopen it) — no re-pairing needed, the new list appears immediately.

No frontend code needs to change for any of the above — the tablet always
renders whatever the server currently reports.
