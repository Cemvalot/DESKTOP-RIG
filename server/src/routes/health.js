'use strict';

const express = require('express');
const pkg = require('../../package.json');

function buildHealthRouter({ config } = {}) {
  const router = express.Router();
  // Deliberately unauthenticated and minimal — see architecture-security.md §1.2 note.
  // pc_name is added per docs/frontend-notes.md #3: low-sensitivity (just a
  // label the owner chose) and useful pre-pairing so the tablet can show
  // "which PC am I pairing with" before it has a token.
  router.get('/health', (req, res) => {
    res.status(200).json({
      status: 'ok',
      version: pkg.version,
      pc_name: config?.service?.pcName ?? null,
    });
  });
  return router;
}

module.exports = { buildHealthRouter };
