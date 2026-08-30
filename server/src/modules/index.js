'use strict';

/**
 * Optional module loader. Each module is imported/instantiated ONLY when
 * its config/service.json `modules.<name>.enabled` flag is true — per
 * reconciliation.md §1, disabled modules must never have their code path
 * run. Since none of these are enabled by default, `require()` still
 * happens (cheap, no side effects at require-time) but no instance is
 * created and nothing is invoked.
 */

function loadModules({ config, logger }) {
  const flags = config.service.modules || {};
  const loaded = {};

  if (flags.homeassistant?.enabled) {
    const { HomeAssistantModule } = require('./homeassistant');
    loaded.homeassistant = new HomeAssistantModule({ config, logger });
    logger.warn('modules.homeassistant.enabled=true but this module is a stub with no real backend — see server/src/modules/homeassistant/README.md');
  }
  if (flags.obs?.enabled) {
    const { ObsModule } = require('./obs');
    loaded.obs = new ObsModule({ config, logger });
    logger.warn('modules.obs.enabled=true but this module is a stub with no real backend — see server/src/modules/obs/README.md');
  }
  if (flags.discord?.enabled) {
    const { DiscordModule } = require('./discord');
    loaded.discord = new DiscordModule({ config, logger });
    logger.warn('modules.discord.enabled=true but this module is a stub with no real backend — see server/src/modules/discord/README.md');
  }
  if (flags.notifications?.enabled) {
    const { NotificationsModule } = require('./notifications');
    loaded.notifications = new NotificationsModule({ config, logger });
    logger.warn('modules.notifications.enabled=true but this module is a stub with no real backend — see server/src/modules/notifications/README.md');
  }
  if (flags.clipboard?.enabled) {
    const { ClipboardModule } = require('./clipboard');
    loaded.clipboard = new ClipboardModule({ config, logger });
    logger.warn('modules.clipboard.enabled=true but this module is a stub with no real backend — see server/src/modules/clipboard/README.md');
  }

  return loaded;
}

module.exports = { loadModules };
