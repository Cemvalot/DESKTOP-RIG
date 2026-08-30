'use strict';

/**
 * Bearer token store per architecture-security.md §2.3 / §7.
 *
 * - Tokens are opaque, 256-bit (crypto.randomBytes(32)), base64url encoded.
 * - Only a SHA-256 hash of the token is ever persisted; the raw token is
 *   returned to the client exactly once (at mint time) and never stored.
 * - Lookup hashes the incoming token and does a constant-time compare
 *   (crypto.timingSafeEqual) against stored hashes.
 * - Persisted as JSON under <stateDir>/tokens.json — stateDir is local,
 *   gitignored, outside the repo in production (%LOCALAPPDATA%\Launchpad\state)
 *   per §7; falls back to server/state/ in Linux dev (see config.js).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function sha256(input) {
  return crypto.createHash('sha256').update(input).digest();
}

function base64urlEncode(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

class TokenStore {
  constructor({ stateDir, logger }) {
    this.stateDir = stateDir;
    this.logger = logger;
    this.filePath = path.join(stateDir, 'tokens.json');
    this.tokens = new Map(); // token_id -> record (token_hash: Buffer)
    this._dirty = false;
    fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    this._load();
    // Debounced persistence so last_seen_at updates on every request don't
    // hammer disk I/O.
    this._flushInterval = setInterval(() => this._flushIfDirty(), 5000).unref();
  }

  _load() {
    if (!fs.existsSync(this.filePath)) return;
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      for (const rec of parsed.tokens || []) {
        this.tokens.set(rec.token_id, {
          ...rec,
          token_hash: Buffer.from(rec.token_hash, 'hex'),
        });
      }
    } catch (err) {
      this.logger?.error('token store: failed to load, starting empty', { error: err.message });
    }
  }

  _flushIfDirty() {
    if (!this._dirty) return;
    this._persist();
  }

  _persist() {
    const serializable = {
      tokens: Array.from(this.tokens.values()).map((rec) => ({
        ...rec,
        token_hash: rec.token_hash.toString('hex'),
      })),
    };
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(serializable, null, 2), { mode: 0o600 });
    fs.renameSync(tmpPath, this.filePath);
    this._dirty = false;
  }

  /** Mint a new token. Returns { token (raw, one-time), token_id, record }. */
  mint({ deviceName }) {
    const raw = crypto.randomBytes(32);
    const token = base64urlEncode(raw);
    const token_id = crypto.randomUUID();
    const now = new Date().toISOString();
    const record = {
      token_id,
      token_hash: sha256(token),
      device_name: deviceName || 'Unknown device',
      created_at: now,
      last_seen_at: now,
      expires_at: null,
    };
    this.tokens.set(token_id, record);
    this._persist();
    return { token, token_id, record };
  }

  /** Look up a token record by raw token value using constant-time compare. */
  verify(rawToken) {
    if (!rawToken || typeof rawToken !== 'string') return null;
    const incomingHash = sha256(rawToken);
    for (const record of this.tokens.values()) {
      if (
        record.token_hash.length === incomingHash.length &&
        crypto.timingSafeEqual(record.token_hash, incomingHash)
      ) {
        return record;
      }
    }
    return null;
  }

  touch(token_id) {
    const record = this.tokens.get(token_id);
    if (!record) return;
    record.last_seen_at = new Date().toISOString();
    this._dirty = true;
  }

  revoke(token_id) {
    const existed = this.tokens.delete(token_id);
    if (existed) this._persist();
    return existed;
  }

  revokeAll() {
    const count = this.tokens.size;
    this.tokens.clear();
    this._persist();
    return count;
  }

  list() {
    return Array.from(this.tokens.values()).map(({ token_id, device_name, created_at, last_seen_at }) => ({
      token_id,
      device_name,
      created_at,
      last_seen_at,
    }));
  }

  get(token_id) {
    return this.tokens.get(token_id) || null;
  }
}

module.exports = { TokenStore };
