'use strict';

/**
 * Direct media convenience endpoints per architecture-security.md §1.2
 * (/media/control, /media/volume, /media/mic, /media/now-playing). These
 * resolve synchronously against MediaController — none of these actions
 * are ever dangerous, so no two-step confirmation applies. They are also
 * reachable as command types (media_control/volume_set/mic_mute) via the
 * generic /commands/execute path (§4.2) for a unified command-history code
 * path; both routes share the same MediaController instance/state.
 */

const crypto = require('crypto');
const express = require('express');

function buildMediaRouter({ mediaController, commandHistory, logger }) {
  const router = express.Router();

  router.post('/media/control', async (req, res) => {
    const { action } = req.body || {};
    const validActions = ['play', 'pause', 'next', 'previous', 'stop', 'toggle'];
    if (!validActions.includes(action)) {
      return res.status(400).json({ error: { code: 'INVALID_MEDIA_ACTION', message: `action must be one of ${validActions.join(', ')}` } });
    }
    const id = 'cmd_' + crypto.randomBytes(6).toString('hex');
    try {
      await mediaController.mediaControl(action);
      commandHistory.push({ id, type: 'media_control', target_id: action, dangerous: false, status: 'success', timestamp: new Date().toISOString(), latency_ms: 0 });
      res.status(200).json({ accepted: true, id });
    } catch (err) {
      logger.error('media control failed', { action, error: err.message });
      res.status(500).json({ error: { code: 'MEDIA_CONTROL_FAILED', message: err.message } });
    }
  });

  router.post('/media/volume', async (req, res) => {
    const { level, mute } = req.body || {};
    if (typeof level !== 'number' && typeof mute !== 'boolean') {
      return res.status(400).json({ error: { code: 'INVALID_VOLUME_REQUEST', message: 'Provide numeric level (0-100) or boolean mute.' } });
    }
    if (typeof level === 'number' && (level < 0 || level > 100)) {
      return res.status(400).json({ error: { code: 'INVALID_VOLUME_LEVEL', message: 'level must be 0-100.' } });
    }
    try {
      const result = await mediaController.setVolume({ level, mute });
      res.status(200).json(result);
    } catch (err) {
      logger.error('volume set failed', { error: err.message });
      res.status(500).json({ error: { code: 'VOLUME_SET_FAILED', message: err.message } });
    }
  });

  router.post('/media/mic', async (req, res) => {
    const { mute } = req.body || {};
    if (typeof mute !== 'boolean') {
      return res.status(400).json({ error: { code: 'INVALID_MIC_REQUEST', message: 'mute (boolean) is required.' } });
    }
    try {
      const result = await mediaController.setMicMute(mute);
      res.status(200).json(result);
    } catch (err) {
      logger.error('mic mute failed', { error: err.message });
      res.status(500).json({ error: { code: 'MIC_MUTE_FAILED', message: err.message } });
    }
  });

  router.get('/media/now-playing', (req, res) => {
    res.status(200).json(mediaController.getNowPlaying());
  });

  return router;
}

module.exports = { buildMediaRouter };
