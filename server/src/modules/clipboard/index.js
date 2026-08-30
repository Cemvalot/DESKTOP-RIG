'use strict';

/**
 * Clipboard transfer — STUB ONLY.
 * Status: disabled by default (config/service.json `modules.clipboard.enabled`).
 *
 * Flagged in reconciliation.md as one of the two lowest-priority optional
 * modules, and one of the two with the largest security surface (arbitrary
 * clipboard content crossing the trust boundary in either direction) if
 * done carelessly — left as a clearly-labeled TODO rather than rushed.
 *
 * Documented extension point: a new WS message type `clipboard_sync`
 * (bidirectional), payload shape TBD but should at minimum be
 * `{ direction: "to_pc"|"to_tablet", content_type: "text", content }`
 * with a strict size cap and text-only content type for v1 (no images/files
 * — that would meaningfully expand the attack surface for a first pass).
 *
 * Documented interface a real implementation must provide:
 *   - async readPcClipboard(): Promise<string>
 *   - async writePcClipboard(text: string): Promise<void>
 */

class ClipboardModule {
  constructor({ config, logger }) {
    this.config = config;
    this.logger = logger;
    this.enabled = false;
  }

  async readPcClipboard() {
    throw new Error('ClipboardModule.readPcClipboard() not implemented — this is a stub (see modules/clipboard/README.md).');
  }

  async writePcClipboard(_text) {
    throw new Error('ClipboardModule.writePcClipboard() not implemented — this is a stub.');
  }
}

module.exports = { ClipboardModule };
