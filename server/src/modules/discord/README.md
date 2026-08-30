# Discord module (stub)

Status: **disabled by default**. `config/service.json` → `modules.discord.enabled`.

## What it would need to become real

1. Register a Discord application (client ID) at
   https://discord.com/developers/applications for local RPC authorization.
2. Add dependency `discord-rpc` (or a maintained fork — the original is
   unmaintained; verify before adopting) to open a local IPC connection to
   the running Discord client.
3. Config addition: `modules.discord.clientId`.
4. Implement `connect()` to authorize once (user approves a one-time
   prompt in the Discord client), then `setSelfMute`/`setSelfDeaf` via the
   RPC `SET_VOICE_SETTINGS` command.
5. Add `/api/v1/discord/*` routes gated behind `modules.discord.enabled`.

Flagged in reconciliation.md as one of the two lowest-priority optional
items alongside notifications/clipboard.
