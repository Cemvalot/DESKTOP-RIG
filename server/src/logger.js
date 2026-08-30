'use strict';

/**
 * Structured JSON-lines logger with simple size+daily rotation.
 * Per architecture-security.md §6.2:
 *  - one JSON object per line
 *  - rotate at midnight OR at logMaxSizeMb (whichever first)
 *  - keep last `logRetentionDays` files, delete older
 *  - NEVER log: raw bearer tokens, raw pairing codes, raw confirm tokens,
 *    file contents, or any request body field not explicitly allowlisted.
 *
 * Dev note: production should point logDir at
 * %LOCALAPPDATA%\Launchpad\logs (see config.js resolveDataDir); on this
 * Linux dev box it defaults to server/logs/ instead.
 */

const fs = require('fs');
const path = require('path');

class Logger {
  constructor({ logDir, maxSizeMb = 10, retentionDays = 14 }) {
    this.logDir = logDir;
    this.maxBytes = maxSizeMb * 1024 * 1024;
    this.retentionDays = retentionDays;
    this.currentDate = null;
    this.stream = null;
    this.currentPath = null;
    fs.mkdirSync(this.logDir, { recursive: true });
    this._rotateIfNeeded();
  }

  _dateStr(d = new Date()) {
    return d.toISOString().slice(0, 10); // YYYY-MM-DD
  }

  _rotateIfNeeded(force = false) {
    const today = this._dateStr();
    let needsNewFile = force || today !== this.currentDate || this.stream === null;

    if (!needsNewFile && this.currentPath && fs.existsSync(this.currentPath)) {
      const { size } = fs.statSync(this.currentPath);
      if (size >= this.maxBytes) needsNewFile = true;
    }

    if (!needsNewFile) return;

    if (this.stream) this.stream.end();

    this.currentDate = today;
    // Include a time suffix so a same-day size-rotation doesn't collide.
    const suffix = force || (this.currentPath && fs.existsSync(this.currentPath) && fs.statSync(this.currentPath).size >= this.maxBytes)
      ? `-${Date.now()}`
      : '';
    this.currentPath = path.join(this.logDir, `service-${today}${suffix}.log`);
    this.stream = fs.createWriteStream(this.currentPath, { flags: 'a' });
    this._prune();
  }

  _prune() {
    try {
      const files = fs
        .readdirSync(this.logDir)
        .filter((f) => f.startsWith('service-') && f.endsWith('.log'))
        .map((f) => ({ f, t: fs.statSync(path.join(this.logDir, f)).mtimeMs }))
        .sort((a, b) => b.t - a.t);
      const cutoff = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000;
      for (const { f, t } of files) {
        if (t < cutoff) {
          fs.unlinkSync(path.join(this.logDir, f));
        }
      }
    } catch (err) {
      // Never let log pruning crash the service.
      // eslint-disable-next-line no-console
      console.error('[logger] prune failed:', err.message);
    }
  }

  log(event) {
    this._rotateIfNeeded();
    const line = JSON.stringify({ ts: new Date().toISOString(), ...event });
    this.stream.write(line + '\n');
  }

  info(msg, fields = {}) {
    this.log({ level: 'info', msg, ...fields });
    // Also mirror to console in dev for visibility.
    // eslint-disable-next-line no-console
    console.log(`[info] ${msg}`, Object.keys(fields).length ? fields : '');
  }

  warn(msg, fields = {}) {
    this.log({ level: 'warn', msg, ...fields });
    // eslint-disable-next-line no-console
    console.warn(`[warn] ${msg}`, Object.keys(fields).length ? fields : '');
  }

  error(msg, fields = {}) {
    this.log({ level: 'error', msg, ...fields });
    // eslint-disable-next-line no-console
    console.error(`[error] ${msg}`, Object.keys(fields).length ? fields : '');
  }
}

/** Mask a secret value for troubleshooting logs: keep only the last 2 chars. */
function maskSecret(value) {
  if (!value || typeof value !== 'string') return null;
  if (value.length <= 2) return '**';
  return `...${value.slice(-2)}`;
}

module.exports = { Logger, maskSecret };
