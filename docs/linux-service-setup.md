# Auto-starting the server on Linux (Omarchy)

This is the Linux equivalent of `docs/windows-service-setup.md` — it makes
the Launchpad server start automatically when you log in (or, optionally,
even before login), instead of you having to run `node src/index.js` by
hand every time.

Uses a **systemd user service** — the same privilege-scoping reasoning as
the Windows Task Scheduler approach: it runs as your own user, with your
own permissions, not as `root` and not as a system-wide service. It can't
do anything your own login session couldn't already do, it's trivially
removable, and it doesn't need `sudo` to set up (only the optional
"start before login" step below needs one `loginctl` command).

## 1. Create the service file

```bash
mkdir -p ~/.config/systemd/user
```

Create `~/.config/systemd/user/launchpad.service`:

```ini
[Unit]
Description=Launchpad PC control service
After=graphical-session.target pipewire.service
Wants=graphical-session.target

[Service]
Type=simple
WorkingDirectory=%h/Projects/launchpad/server
ExecStart=/usr/bin/node src/index.js
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
```

Adjust `WorkingDirectory` if your copy of the project lives somewhere
other than `~/Projects/launchpad`. Check `which node` if `/usr/bin/node`
isn't right for your system (`command -v node`).

## 2. Enable and start it

```bash
systemctl --user daemon-reload
systemctl --user enable --now launchpad.service
```

`--now` starts it immediately as well as enabling it for future logins.
Check it's running and see the same startup output (pairing code, LAN
address) it would print if you ran it by hand:

```bash
systemctl --user status launchpad.service
journalctl --user -u launchpad.service -f
```

(`-f` follows the log live — useful for grabbing the pairing code on
first setup. Press `Ctrl+C` to stop following, the service keeps running.)

## 3. (Optional) Start it even before you log in

By default, a systemd **user** service only starts once you actually log
in to a graphical session (`After=graphical-session.target` above). Since
this is a desktop machine you'll typically be logged into anyway, that's
normally fine and is what most of the command handlers assume (some,
like the screenshot/screen-recording ones, need a real Hyprland session to
target). If you want it running even before login — e.g. so the tablet can
still see live system stats while the machine sits at a login screen —
enable **lingering** for your user:

```bash
loginctl enable-linger $(whoami)
```

This tells systemd to start your user services at boot rather than waiting
for a login. Commands that need the graphical session (app launches,
screenshots, lock/audio control) will still only work correctly once you've
actually logged in — lingering just means the service *process* itself
comes up earlier, not that every feature works pre-login.

## Managing it

```bash
systemctl --user stop launchpad.service      # stop it now
systemctl --user restart launchpad.service   # restart (e.g. after editing config/*.json)
systemctl --user disable launchpad.service   # stop auto-starting at login
loginctl disable-linger $(whoami)             # undo step 3, if you enabled it
```

Removing it entirely: run the `disable` command above, then delete
`~/.config/systemd/user/launchpad.service` and run
`systemctl --user daemon-reload`.

## Logs

The service's own structured logs still go to `server/logs/` as usual (see
`server/README.md`). `journalctl --user -u launchpad.service` shows
systemd's view (stdout/stderr, start/stop/crash events) — useful if the
service fails to start at all, before it's gotten far enough to write its
own log file.
