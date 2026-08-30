'use strict';

/**
 * Home Assistant integration — STUB ONLY.
 *
 * Status: disabled by default (config/service.json `modules.homeassistant.enabled`).
 * Never imported/invoked by core server code when disabled. There is no
 * live Home Assistant instance available in this dev environment to
 * integrate against — see this module's README.md for what a real
 * integration would need.
 *
 * Documented interface a real implementation must provide:
 *   - async getStates(): Promise<Array<{ entity_id, state, attributes }>>
 *       Mirrors Home Assistant's `GET /api/states`.
 *   - async callService(domain, service, data): Promise<void>
 *       Mirrors `POST /api/services/<domain>/<service>`.
 */

class HomeAssistantModule {
  constructor({ config, logger }) {
    this.config = config;
    this.logger = logger;
    this.enabled = false; // this stub is never "enabled" for real — see README
  }

  async getStates() {
    throw new Error('HomeAssistantModule.getStates() not implemented — this is a stub (see modules/homeassistant/README.md).');
  }

  async callService(_domain, _service, _data) {
    throw new Error('HomeAssistantModule.callService() not implemented — this is a stub (see modules/homeassistant/README.md).');
  }
}

module.exports = { HomeAssistantModule };
