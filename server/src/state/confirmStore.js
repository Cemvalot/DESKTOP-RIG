'use strict';

/**
 * Dangerous-command confirm-token store per architecture-security.md §5.
 * In-memory only, keyed by opaque token -> { command, token_id, createdAt, expiresAt, used }.
 */

const crypto = require('crypto');

class ConfirmStore {
  constructor({ windowSeconds = 10, maxWindowSeconds = 60 }) {
    this.windowSeconds = Math.min(windowSeconds, maxWindowSeconds);
    this.maxWindowSeconds = maxWindowSeconds;
    this.map = new Map();
    // Periodic sweep of expired entries so the map doesn't grow unbounded.
    this._sweepInterval = setInterval(() => this._sweep(), 30_000).unref();
  }

  _sweep() {
    const now = Date.now();
    for (const [token, rec] of this.map.entries()) {
      if (now > rec.expiresAt) this.map.delete(token);
    }
  }

  issue({ command, tokenId }) {
    const token = 'cf_' + crypto.randomBytes(16).toString('base64url');
    const now = Date.now();
    const rec = {
      command,
      tokenId,
      createdAt: now,
      expiresAt: now + this.windowSeconds * 1000,
      used: false,
    };
    this.map.set(token, rec);
    return { confirmToken: token, expiresInSeconds: this.windowSeconds };
  }

  /**
   * Validate + consume a confirm token.
   * Returns { ok: true, command } or { ok: false, reason: 'not_found' | 'expired' | 'used' | 'token_mismatch' }
   */
  consume(token, requestingTokenId) {
    const rec = this.map.get(token);
    if (!rec) return { ok: false, reason: 'not_found' };
    if (rec.used) return { ok: false, reason: 'used' };
    if (Date.now() > rec.expiresAt) {
      this.map.delete(token);
      return { ok: false, reason: 'expired' };
    }
    if (rec.tokenId !== requestingTokenId) {
      return { ok: false, reason: 'token_mismatch' };
    }
    rec.used = true;
    return { ok: true, command: rec.command };
  }
}

module.exports = { ConfirmStore };
