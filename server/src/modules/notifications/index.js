'use strict';

/**
 * PC notifications panel — STUB ONLY.
 * Status: disabled by default (config/service.json `modules.notifications.enabled`).
 *
 * Flagged in reconciliation.md as one of the two lowest-priority optional
 * modules, and one of the two with the largest security surface
 * (notification content crossing the trust boundary from PC to tablet) if
 * done carelessly — left as a clearly-labeled TODO rather than rushed.
 *
 * Documented extension point: a new WS message type `notification_push`
 * (server->client), payload shape TBD but should at minimum be
 * `{ id, app, title, body, timestamp }`. Would require hooking into the
 * Windows notification listener API (`UserNotificationListener`, WinRT),
 * which needs the "Notifications" capability + user consent — nontrivial,
 * hence left unimplemented.
 *
 * Documented interface a real implementation must provide:
 *   - start(onNotification: (notification) => void): void
 *   - stop(): void
 */

class NotificationsModule {
  constructor({ config, logger }) {
    this.config = config;
    this.logger = logger;
    this.enabled = false;
  }

  start(_onNotification) {
    throw new Error('NotificationsModule.start() not implemented — this is a stub (see modules/notifications/README.md).');
  }

  stop() {
    // no-op stub
  }
}

module.exports = { NotificationsModule };
