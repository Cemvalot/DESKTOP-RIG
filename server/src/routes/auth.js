'use strict';

const express = require('express');

function buildAuthRouter({ tokenStore, logger }) {
  const router = express.Router();

  // POST /api/v1/auth/revoke — Bearer. Omit token_id to revoke self.
  router.post('/auth/revoke', (req, res) => {
    const targetId = req.body?.token_id || req.auth.tokenId;
    const existed = tokenStore.revoke(targetId);
    if (!existed) {
      return res.status(404).json({ error: { code: 'TOKEN_NOT_FOUND', message: 'No such token_id.' } });
    }
    logger.info('token revoked', { token_id: targetId, revoked_by: req.auth.tokenId });
    res.status(200).json({ revoked: true });
  });

  // GET /api/v1/auth/tokens — Bearer (intended for PC-console/local admin use).
  router.get('/auth/tokens', (req, res) => {
    res.status(200).json({ tokens: tokenStore.list() });
  });

  return router;
}

module.exports = { buildAuthRouter };
