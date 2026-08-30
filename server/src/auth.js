'use strict';

/** Bearer-token auth middleware per architecture-security.md §2.3. */

function extractBearer(req) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    return header.slice('Bearer '.length).trim();
  }
  return null;
}

function buildAuthMiddleware({ tokenStore, logger }) {
  return (req, res, next) => {
    const raw = extractBearer(req);
    const record = tokenStore.verify(raw);
    if (!record) {
      logger?.warn('auth failed: invalid or missing token', { path: req.originalUrl, source_ip: req.socket.remoteAddress });
      return res.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Missing or invalid bearer token.' } });
    }
    tokenStore.touch(record.token_id);
    req.auth = { tokenId: record.token_id, deviceName: record.device_name };
    next();
  };
}

module.exports = { buildAuthMiddleware, extractBearer };
