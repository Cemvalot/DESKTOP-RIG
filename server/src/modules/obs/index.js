'use strict';

/**
 * OBS Studio integration — STUB ONLY.
 * Status: disabled by default (config/service.json `modules.obs.enabled`).
 * Would use obs-websocket (the `obs-websocket-js` npm package) against a
 * running OBS instance with the obs-websocket plugin/v5 built-in enabled.
 * No live OBS instance available in this dev environment.
 *
 * Documented interface a real implementation must provide:
 *   - async connect(): Promise<void>
 *   - async getSceneList(): Promise<Array<{ sceneName }>>
 *   - async setCurrentScene(sceneName): Promise<void>
 *   - async startRecording(): Promise<void>
 *   - async stopRecording(): Promise<void>
 *   - async toggleStreaming(): Promise<void>
 */

class ObsModule {
  constructor({ config, logger }) {
    this.config = config;
    this.logger = logger;
    this.enabled = false;
  }

  async connect() {
    throw new Error('ObsModule.connect() not implemented — this is a stub (see modules/obs/README.md).');
  }

  async getSceneList() {
    throw new Error('ObsModule.getSceneList() not implemented — this is a stub.');
  }

  async setCurrentScene(_sceneName) {
    throw new Error('ObsModule.setCurrentScene() not implemented — this is a stub.');
  }

  async startRecording() {
    throw new Error('ObsModule.startRecording() not implemented — this is a stub.');
  }

  async stopRecording() {
    throw new Error('ObsModule.stopRecording() not implemented — this is a stub.');
  }

  async toggleStreaming() {
    throw new Error('ObsModule.toggleStreaming() not implemented — this is a stub.');
  }
}

module.exports = { ObsModule };
