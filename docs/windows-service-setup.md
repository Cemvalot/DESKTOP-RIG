# Windows setup: firewall + auto-start

Written by the server subagent as a new doc (does not edit
`architecture-security.md`/`reconciliation.md`), covering the concrete
setup steps for architecture-security.md §3.2 (firewall) and §9
(auto-start). Run these on the actual Windows PC that will host the
service — they cannot be executed from this Linux dev environment.

## 1. Install

1. Copy the `server/` directory (or a packaged build of it) onto the
   Windows PC, e.g. `C:\Launchpad\server\`.
2. Install Node.js 18+ on the PC if not already present.
3. From an ordinary (non-admin) terminal:
   ```
   cd C:\Launchpad\server
   npm install
   ```
4. Fill in real machine-specific paths as `config/*.local.json` overrides
   (never edit the tracked `config/*.json` with real personal paths) —
   e.g. `config/apps.local.json`:
   ```json
   { "apps": [ { "id": "chrome", "exePath": "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" } ] }
   ```
   Only fields you want to override need to be present; unlisted fields
   fall back to the tracked defaults, and unlisted apps stay as-is (note:
   the current merge is per top-level array — see `src/config.js`
   `deepMerge`; a `.local.json` entry with the same `apps` array will
   currently replace the whole array since JSON arrays aren't deep-merged
   element-by-element — simplest safe practice is to put your *entire*
   real `apps`/`links` list in the `.local.json` file rather than a
   partial one).

## 2. Windows Firewall rule (Private profile only)

Run once during setup, in a PowerShell window the owner explicitly
approves (UAC prompt is expected and fine — do not script around it):

```powershell
New-NetFirewallRule -DisplayName "Launchpad Control Service" `
  -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8787 `
  -Profile Private
```

Verify the home network is actually profiled as **Private** (not Public):

```powershell
Get-NetConnectionProfile
```

If it shows `Public` for the adapter Launchpad will run on, either:

- Change it to Private (only if you trust this network — a home LAN
  should qualify):
  ```powershell
  Set-NetConnectionProfile -InterfaceAlias "<adapter name>" -NetworkCategory Private
  ```
- Or leave it Public and understand the firewall rule above will **not**
  open the port on it (the service will still bind, but Windows Firewall
  blocks inbound access from that profile — this is the safe default).

Never scope the rule to `Any` or `Public`.

## 3. Auto-start: Task Scheduler logon task (recommended)

Per architecture-security.md §9, a Task Scheduler logon task (not a full
Windows Service) is recommended — it runs in the interactive user's own
session with the user's own privileges, which is what `LockWorkStation()`
and the media-session APIs need, and needs no elevation to register.

### Option A — `schtasks` (simplest, one command)

```
schtasks /create /sc onlogon /tn "Launchpad Control Service" ^
  /tr "\"C:\Program Files\nodejs\node.exe\" \"C:\Launchpad\server\src\index.js\"" ^
  /rl limited
```

- `/rl limited` = run with the standard (non-elevated) privileges of the
  logged-in user — no UAC prompt needed to register this task.
- Adjust the `node.exe` path to match your Node install
  (`where node` in a terminal shows it).

### Option B — `Register-ScheduledTask` (PowerShell, more configurable)

```powershell
$action = New-ScheduledTaskAction -Execute "C:\Program Files\nodejs\node.exe" `
  -Argument "C:\Launchpad\server\src\index.js" `
  -WorkingDirectory "C:\Launchpad\server"
$trigger = New-ScheduledTaskTrigger -AtLogOn
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -RunLevel Limited
Register-ScheduledTask -TaskName "Launchpad Control Service" `
  -Action $action -Trigger $trigger -Principal $principal
```

### Removing it later

Standard Task Scheduler GUI (`taskschd.msc`) → find "Launchpad Control
Service" → Delete. Or:

```powershell
Unregister-ScheduledTask -TaskName "Launchpad Control Service" -Confirm:$false
```

### Alternative (simpler, lower-robustness fallback)

Copy a shortcut to the service's start command into
`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`. Fine as a quick
fallback; per architecture-security.md §9 it's slightly less robust
(delayed startup, more likely to be flagged by "startup optimizer" tools)
than the Task Scheduler approach above.

## 4. First run

Start the service manually once to confirm it works before relying on
auto-start:

```
cd C:\Launchpad\server
node src\index.js
```

You should see the bound LAN interface(s), `mockExec inactive` (confirming
real Windows execution is active, not mocked), and a pairing code printed
to the console. Open `http://<pc-lan-ip>:8787/health` from another device
on the same LAN to confirm reachability, then pair the tablet using the
printed 6-character code.
