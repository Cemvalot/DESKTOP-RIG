'use strict';

/**
 * Discord mute/deafen integration — STUB ONLY.
 * Status: disabled by default (config/service.json `modules.discord.enabled`).
 * Would use Discord's local RPC (IPC) API, which requires the user to
 * authorize a registered Discord application (client ID) the first time.
 * No authorized Discord app / live session available in this dev
 * environment.
 *
 * Documented interface a real implementation must provide:
 *   - async connect(): Promise<void>   (opens local RPC IPC connection)
 *   - async setSelfMute(muted: boolean): Promise<void>
 *   - async setSelfDeaf(deafened: boolean): Promise<void>
 */

class DiscordModule {
  constructor({ config, logger }) {
    this.config = config;
    this.logger = logger;
    this.enabled = false;
  }

  async connect() {
    throw new Error('DiscordModule.connect() not implemented — this is a stub (see modules/discord/README.md).');
  }

  async setSelfMute(_muted) {
    throw new Error('DiscordModule.setSelfMute() not implemented — this is a stub.');
  }

  async setSelfDeaf(_deafened) {
    throw new Error('DiscordModule.setSelfDeaf() not implemented — this is a stub.');
  }
}

module.exports = { DiscordModule };
