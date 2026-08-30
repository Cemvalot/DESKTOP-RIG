'use strict';

const express = require('express');

function buildStatusRouter({ statsService }) {
  const router = express.Router();

  // GET /api/v1/status — Bearer. One-shot SystemStatus snapshot (§8).
  router.get('/status', async (req, res) => {
    const status = await statsService.getStatus();
    res.status(200).json(status);
  });

  return router;
}

module.exports = { buildStatusRouter };
