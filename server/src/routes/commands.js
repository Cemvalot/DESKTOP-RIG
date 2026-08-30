'use strict';

/**
 * Command execution + dangerous-command confirmation routes, per
 * architecture-security.md §4/§5 and reconciliation.md §2 (launch_game).
 */

const crypto = require('crypto');
const express = require('express');
const { resolveCommand } = require('../commands');
const { rateLimitMiddleware } = require('../rateLimit');

function newCommandId() {
  return 'cmd_' + crypto.randomBytes(6).toString('hex');
}

function buildCommandsRouter({ config, executor, mediaController, confirmStore, commandHistory, wsHub, limiters, logger }) {
  const router = express.Router();
  const ctx = { executor, mediaController };

  async function executeAndPush({ resolved, commandId, tokenId }) {
    const startedAt = Date.now();
    let result;
    try {
      result = await resolved.run(ctx);
    } catch (err) {
      result = { ok: false, code: 1, stdout: '', stderr: err.message, mocked: executor.mockExec };
    }
    const latencyMs = Date.now() - startedAt;
    const status = result.ok ? 'success' : 'error';

    commandHistory.push({
      id: commandId,
      type: resolved.type,
      target_id: resolved.targetId,
      dangerous: resolved.dangerous,
      status,
      timestamp: new Date().toISOString(),
      latency_ms: latencyMs,
    });

    logger.info('command executed', {
      command_id: commandId,
      command_type: resolved.type,
      command_target_id: resolved.targetId,
      dangerous: resolved.dangerous,
      result: status,
      token_id: tokenId,
      latency_ms: latencyMs,
      mocked: !!result.mocked,
    });

    wsHub.pushCommandResult(tokenId, commandId, {
      command_id: commandId,
      status,
      message: result.ok ? (result.stdout || 'OK') : (result.stderr || 'Command failed'),
    });

    return { status, result };
  }

  // POST /api/v1/commands/execute — Bearer.
  router.post('/commands/execute', async (req, res) => {
    let resolved;
    try {
      resolved = resolveCommand(req.body, config);
    } catch (err) {
      logger.info('command rejected', { reason: err.code, body_type: req.body?.type, token_id: req.auth.tokenId });
      return res.status(err.status || 400).json({ error: { code: err.code || 'INVALID_REQUEST', message: err.message } });
    }

    if (resolved.dangerous) {
      const dangerousLimit = rateLimitMiddleware(limiters.dangerousExecute, (r) => r.auth.tokenId, logger);
      return dangerousLimit(req, res, () => {
        const { confirmToken, expiresInSeconds } = confirmStore.issue({ command: resolved, tokenId: req.auth.tokenId });
        logger.info('dangerous command requires confirmation', {
          command_type: resolved.type,
          command_target_id: resolved.targetId,
          token_id: req.auth.tokenId,
          confirm_token_id: confirmToken.slice(-8),
        });
        return res.status(200).json({
          status: 'confirmation_required',
          confirm_token: confirmToken,
          expires_in_seconds: expiresInSeconds,
          command_summary: resolved.summary,
        });
      });
    }

    const commandId = newCommandId();
    res.status(202).json({ id: commandId, status: 'accepted' });
    executeAndPush({ resolved, commandId, tokenId: req.auth.tokenId });
  });

  // POST /api/v1/commands/confirm — Bearer.
  router.post(
    '/commands/confirm',
    rateLimitMiddleware(limiters.confirm, (req) => req.auth.tokenId, logger),
    async (req, res) => {
      const { confirm_token } = req.body || {};
      if (typeof confirm_token !== 'string') {
        return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'confirm_token is required.' } });
      }
      const outcome = confirmStore.consume(confirm_token, req.auth.tokenId);
      if (!outcome.ok) {
        logger.info('confirm rejected', { reason: outcome.reason, token_id: req.auth.tokenId, confirm_token_id: confirm_token.slice(-8) });
        if (outcome.reason === 'expired') {
          return res.status(410).json({ error: { code: 'CONFIRMATION_EXPIRED', message: 'Confirmation window expired.' } });
        }
        if (outcome.reason === 'used') {
          return res.status(409).json({ error: { code: 'CONFIRMATION_ALREADY_USED', message: 'This confirm_token was already used.' } });
        }
        if (outcome.reason === 'token_mismatch') {
          return res.status(403).json({ error: { code: 'CONFIRMATION_TOKEN_MISMATCH', message: 'This confirm_token belongs to a different device.' } });
        }
        return res.status(404).json({ error: { code: 'CONFIRMATION_NOT_FOUND', message: 'Unknown confirm_token.' } });
      }

      const commandId = newCommandId();
      res.status(200).json({ status: 'accepted', id: commandId });
      executeAndPush({ resolved: outcome.command, commandId, tokenId: req.auth.tokenId });
    }
  );

  // GET /api/v1/commands/history — Bearer. Last 50 executed commands.
  router.get('/commands/history', (req, res) => {
    res.status(200).json({ history: commandHistory.list() });
  });

  // DELETE /api/v1/commands/history — Bearer. Explicitly clear the
  // in-memory recent-command list for every paired dashboard.
  router.delete('/commands/history', (req, res) => {
    const cleared = commandHistory.clear();
    logger.info('command history cleared', { token_id: req.auth.tokenId, cleared });
    res.status(200).json({ cleared });
  });

  return router;
}

module.exports = { buildCommandsRouter };
