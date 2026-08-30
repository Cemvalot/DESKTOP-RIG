'use strict';

const express = require('express');

function buildConfigRouter({ config }) {
  const router = express.Router();

  // GET /api/v1/config/apps — Bearer.
  router.get('/config/apps', (req, res) => {
    // Never leak exePath/args to the tablet — those are server-internal
    // allowlist details, the frontend only needs id/label/icon/tags.
    const apps = (config.apps.apps || []).map(({ id, label, icon, dangerous, tags }) => ({ id, label, icon, dangerous, tags }));
    res.status(200).json({ apps });
  });

  // GET /api/v1/config/links — Bearer.
  router.get('/config/links', (req, res) => {
    const links = (config.links.links || []).map(({ id, label, icon, type, dangerous }) => ({ id, label, icon, type, dangerous }));
    res.status(200).json({ links });
  });

  // GET /api/v1/config/maintenance — Bearer.
  router.get('/config/maintenance', (req, res) => {
    const commands = (config.maintenance.commands || []).map(({ id, label, icon, dangerous }) => ({ id, label, icon, dangerous }));
    res.status(200).json({ commands });
  });

  // GET /api/v1/config/games — Bearer.
  // Added per docs/reconciliation.md / docs/frontend-notes.md #1 — the
  // presentation-layer source for the Gaming screen's library/recent/
  // favorites rails. Games are launched via the `launch_game` command
  // (steam_app_id extracted client-side from `launch.target`), so it's
  // safe to pass the full games.json shape through as-is — nothing here
  // is a server secret or exec path.
  router.get('/config/games', (req, res) => {
    res.status(200).json({
      library: config.games.library || [],
      recentlyPlayed: config.games.recentlyPlayed || [],
      favorites: config.games.favorites || [],
    });
  });

  // GET /api/v1/config/smarthome — Bearer.
  // Added per docs/reconciliation.md §1 — placeholder tile/scene config for
  // the Smart Home screen. `connected` stays false until a real Home
  // Assistant module is enabled (see server/src/modules/homeassistant).
  router.get('/config/smarthome', (req, res) => {
    res.status(200).json({
      connected: !!(config.service.modules && config.service.modules.homeassistant && config.service.modules.homeassistant.enabled),
      tiles: config.smarthome.tiles || {},
      scenes: config.smarthome.scenes || [],
    });
  });

  return router;
}

module.exports = { buildConfigRouter };
