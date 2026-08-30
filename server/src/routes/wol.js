'use strict';

/**
 * Wake-on-LAN endpoint per reconciliation.md §1. Bearer-gated, not
 * dangerous. No-ops cleanly (400) if disabled in config.
 */

const express = require('express');
const { sendMagicPacket } = require('../wol');

function buildWolRouter({ config, logger }) {
  const router = express.Router();

  router.post('/wol', async (req, res) => {
    const wol = config.service.wakeOnLan || {};
    if (!wol.enabled) {
      return res.status(400).json({ error: { code: 'WOL_DISABLED', message: 'Wake-on-LAN is disabled in config/service.json.' } });
    }
    try {
      const result = await sendMagicPacket({ macAddress: wol.macAddress, broadcastAddress: wol.broadcastAddress });
      logger.info('wol magic packet sent', { mac_tail: wol.macAddress?.slice(-5), token_id: req.auth.tokenId });
      res.status(200).json({ sent: true });
    } catch (err) {
      logger.error('wol send failed', { error: err.message });
      res.status(500).json({ error: { code: 'WOL_FAILED', message: err.message } });
    }
  });

  return router;
}

module.exports = { buildWolRouter };
