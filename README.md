# Launchpad

Launchpad is a local-network tablet dashboard for controlling a PC. It runs
as a small Node.js server and a dependency-free web app (PWA) that can be
opened on a tablet, phone, or desktop browser.

## What it does

- Launches configured desktop applications, games, and links.
- Shows CPU, GPU, RAM, temperature, and network status.
- Controls system volume, microphone mute, and media playback.
- Shows the current track, artist, duration, and album/video artwork.
- Provides lock, restart, and shutdown actions with confirmation dialogs.
- Supports Home, Gaming, Media, System, and Smart Home tabs.
- Uses a WebSocket for live updates and automatically reconnects.

## Requirements

- Node.js 18 or newer (Node 26 is used on the development PC).
- A PC and tablet on the same trusted LAN/Wi-Fi network.
- Linux: `playerctl` for media control and MPRIS metadata:

  ```bash
  sudo pacman -S --needed playerctl
  ```

Windows and Linux are supported. The current machine-specific setup is
Omarchy/Arch Linux.

## Start the server

From the repository root:

```bash
cd server
npm install
npm start
```

The terminal prints the LAN address and a six-character pairing code, for
example:

```text
Pairing URL: http://192.168.1.102:8787/pair?code=ABC123
```

Keep this terminal running. The server listens on port `8787` and also binds
to `127.0.0.1` for local testing.

## Open it on the tablet

1. Connect the tablet to the same network as the PC.
2. Open Chrome and visit `http://PC_LAN_IP:8787/`.
3. Enter the pairing code printed by `npm start`.
4. Install/add the page to the tablet home screen if you want fullscreen PWA
   mode. Fully Kiosk Browser can also be configured with the same URL.

For this machine the URL is normally:

```text
http://192.168.1.102:8787/
```

The pairing code expires after five minutes. Restarting the server generates a
new code. Pairing tokens are stored in the server state directory and remain
valid until revoked.

## Firewall

On a Linux PC using UFW, allow only the trusted home subnet:

```bash
sudo ufw allow from 192.168.1.0/24 to any port 8787 proto tcp
sudo ufw status
```

Do not expose port 8787 directly to the public internet. On Windows, create a
Private-profile inbound rule only; see `docs/windows-service-setup.md`.

## Configure applications

Tracked `config/apps.json` contains portable/example entries. Put real paths
for one machine in the ignored override file `config/apps.local.json`:

```json
{
  "apps": [
    {
      "id": "terminal",
      "label": "Terminal",
      "icon": "terminal",
      "exePath": "/usr/bin/foot",
      "args": [],
      "dangerous": false,
      "tags": ["home"]
    }
  ]
}
```

The current Linux override includes Steam, Discord, Chrome, Spotify, Files,
Terminal, Codex CLI, Claude CLI, ChatGPT, and Steam Library. CLI tools are
launched inside `foot` so their interactive terminal UI is visible.

After changing configuration, restart `npm start`. Local override files are
ignored by Git and must not contain credentials in tracked files.

## Development

The frontend is plain HTML/CSS/JavaScript and needs no build step. The server
serves it directly from `frontend/`:

```bash
cd frontend
python3 -m http.server 8899
```

For a standalone UI demo, open `http://localhost:8899/`; it uses the mock
provider by default. The live provider is selected by the paired dashboard and
uses `/api/v1/*` plus `/ws`.

## Tests and checks

Install server dependencies first, then run the API test against a running
server:

```bash
cd server
npm install
cd ..
node tests/api-test.js
```

`tests/api-test-part2.js` requires a token supplied through
`LAUNCHPAD_TOKEN`. Never commit that token.

## Security model

- The tablet must pair before calling authenticated API routes.
- Bearer tokens are stored hashed on the server; raw tokens are not logged.
- Dangerous commands use a separate confirmation step and short-lived token.
- LAN/private-subnet and request-origin checks run before command execution.
- `config/*.local.json`, `.env`, logs, state, and dependencies are ignored by
  `.gitignore`.
- This is intended for a trusted home network, not an internet-facing service.

## Troubleshooting

### `EADDRINUSE` on port 8787

Another Launchpad server is already running. Check it with:

```bash
lsof -nP -iTCP:8787 -sTCP:LISTEN
```

Stop that process or reuse the already-running server instead of starting a
second copy.

### Tablet cannot connect

Confirm the PC IP with the address printed at startup, verify both devices
are on the same Wi-Fi/LAN, and check the UFW rule. Use the exact `http://`
URL and port `8787`.

### Media says nothing is playing

Make sure Spotify, Chrome/YouTube, or another MPRIS player is actively playing
and that `playerctl metadata` returns a player. Install `playerctl` on Arch
Linux if needed.

### Apps do not launch

Check the executable path in `config/apps.local.json`, confirm it is
executable, and restart the server after editing the file. Codex and Claude
are expected to launch through `/usr/bin/foot`.

## Further documentation

- `docs/tablet-setup.md` — fullscreen/PWA, kiosk, and tablet setup.
- `docs/adding-apps-and-commands.md` — configuration schema and extensions.
- `docs/architecture-security.md` — API, authentication, and command model.
- `server/README.md` — server internals and platform implementation details.
- `frontend/README.md` — frontend structure and provider contract.
