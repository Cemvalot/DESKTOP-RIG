'use strict';

/**
 * Pairing flow per architecture-security.md §2.2, plus the dependency-free
 * pairing-surface approach described in this server's implementation brief:
 * GET /pairing/current (unauthenticated, LAN-only) exposes the current
 * active code + a plain pairing URL, and the code/URL are also printed
 * prominently to the console at startup / on regeneration. No heavyweight
 * QR-image dependency is added — manual 6-char entry is the primary path,
 * consistent with the frontend's pairing screen (per its own brief).
 */

const express = require('express');
const { rateLimitMiddleware } = require('../rateLimit');

function buildPairingRouter({ pairingStore, tokenStore, limiters, logger, pcLanAddress, port, scheme, onClaimed }) {
  const router = express.Router();

  // POST /api/v1/pairing/claim — pairing code, not bearer.
  router.post(
    '/pairing/claim',
    rateLimitMiddleware(limiters.pairingClaim, (req) => req.socket.remoteAddress || 'unknown', logger),
    (req, res) => {
      const { pairing_code, device_name } = req.body || {};
      if (typeof pairing_code !== 'string') {
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'pairing_code is required.' } });
      }
      const result = pairingStore.claim(pairing_code);
      if (!result.ok) {
        const maskedTail = pairing_code.slice(-2);
        logger.info('pairing claim failed', { reason: result.reason, code_ending_in: maskedTail, source_ip: req.socket.remoteAddress });
        if (result.reason === 'expired') {
          return res.status(410).json({ error: { code: 'PAIRING_CODE_EXPIRED', message: 'Pairing code expired.' } });
        }
        return res.status(401).json({ error: { code: 'PAIRING_CODE_INVALID', message: 'Pairing code invalid or already used.' } });
      }
      const { token, token_id } = tokenStore.mint({ deviceName: device_name });
      logger.info('pairing claim succeeded', { token_id, device_name, source_ip: req.socket.remoteAddress });
      res.status(200).json({ token, token_id, expires_at: null });
      // Fix for docs/test-report.md Bug #3: without this, GET /pairing/current
      //404s for up to 30s after a successful claim (only the interval tick
      // regenerated a fresh code). Dev/first-run convenience only — see the
      // comment on ensurePairingCode in index.js.
      if (typeof onClaimed === 'function') onClaimed();
    }
  );

  // GET /pairing/current — unauthenticated, LAN-only (subject to the same
  // network-guard middleware mounted globally), returns the currently
  // active code + plain pairing URL for a PC-side display to show.
  router.get('/pairing/current', (req, res) => {
    const info = pairingStore.currentInfo();
    if (!info) {
      return res.status(404).json({ error: { code: 'NO_ACTIVE_CODE', message: 'No active pairing code. Generate one from the PC.' } });
    }
    const pairingUrl = `${scheme || 'http'}://${pcLanAddress || '<pc-ip>'}:${port}/pair?code=${info.code}`;
    res.status(200).json({ code: info.code, expires_at: info.expires_at, pairing_url: pairingUrl });
  });

  return router;
}

module.exports = { buildPairingRouter };
