'use strict';

/**
 * Pairing code store per architecture-security.md §2.2.
 *
 * In-memory only (a pairing code is meaningless after a restart anyway —
 * the owner just generates a fresh one). Codes are 6 chars, uppercase
 * letters + digits, excluding visually ambiguous 0/O/1/I, single-use,
 * default 5-minute TTL (config/service.json pairingCodeTtlSeconds).
 */

const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

function generateCode(length = 6) {
  let out = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

class PairingStore {
  constructor({ ttlSeconds = 300, logger }) {
    this.ttlSeconds = ttlSeconds;
    this.logger = logger;
    this.current = null; // { code, createdAt, expiresAt, used }
  }

  generate() {
    const code = generateCode();
    const now = Date.now();
    this.current = {
      code,
      createdAt: now,
      expiresAt: now + this.ttlSeconds * 1000,
      used: false,
    };
    return { code, expires_at: new Date(this.current.expiresAt).toISOString(), ttl_seconds: this.ttlSeconds };
  }

  /**
   * Attempt to claim a code. Returns:
   *  - { ok: true } if valid, not expired, not used (also marks it used)
   *  - { ok: false, reason: 'no_code' | 'expired' | 'invalid' | 'used' }
   */
  claim(code) {
    if (!this.current) return { ok: false, reason: 'no_code' };
    if (this.current.used) return { ok: false, reason: 'used' };
    if (Date.now() > this.current.expiresAt) return { ok: false, reason: 'expired' };
    if (typeof code !== 'string' || code.toUpperCase() !== this.current.code) {
      return { ok: false, reason: 'invalid' };
    }
    this.current.used = true;
    return { ok: true };
  }

  currentInfo() {
    if (!this.current || this.current.used || Date.now() > this.current.expiresAt) return null;
    return {
      code: this.current.code,
      expires_at: new Date(this.current.expiresAt).toISOString(),
    };
  }
}

module.exports = { PairingStore, generateCode };
