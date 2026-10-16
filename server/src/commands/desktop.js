'use strict';

/**
 * Remote keyboard + trackpad control (docs/architecture-security.md §11).
 *
 * `ydotool` is the standard uinput-based input-injection tool for
 * Wayland/Hyprland (xdotool-style tools don't work under Wayland at all).
 * Installed and verified live on this machine — see server/README.md
 * "Virtual keyboard / trackpad" for setup steps on a fresh machine.
 *
 * - Mouse move is relative-only (touch-drag deltas map directly onto it);
 *   click sends a synthetic button down+up. Scroll is a documented TODO —
 *   ydotool 1.0.x has no verified wheel/scroll subcommand on this build, so
 *   rather than guess at an unverified CLI invocation it fails cleanly.
 * - Keyboard: printable text goes through `ydotool type` (it resolves the
 *   actual keystrokes, including shift, internally — the frontend just
 *   sends literal characters, never a keycode). Non-printable keys (Enter,
 *   Backspace, arrows, etc.) go through `ydotool key` against a fixed,
 *   server-side allowlist of raw Linux keycodes (`SPECIAL_KEYS` below) — the
 *   tablet only ever supplies a symbolic name like 'Enter', never a keycode
 *   or arbitrary key sequence, matching architecture-security.md §4.1's
 *   allowlist-not-shell-exec rule.
 *
 * Every real invocation goes through `execFile` with a fixed argv — no
 * tablet-supplied string is ever interpolated into a shell command. `type`'s
 * text argument is untrusted user input by design (it's literally "what the
 * user typed on the virtual keyboard"), but `execFile` never invokes a
 * shell, so there is no metacharacter-injection risk regardless of content.
 */

const { execFile } = require('child_process');

function simulatedDelayMs() {
  return 15 + Math.floor(Math.random() * 35); // input needs to feel fast even mocked
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function run(cmd, args, { timeout = 4000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(new Error(stderr?.toString().trim() || error.message), { code: error.code }));
        return;
      }
      resolve(stdout);
    });
  });
}

const YDOTOOL_CLICK_CODES = { left: '0xC0', right: '0xC1', middle: '0xC2' };
const CTRL_KEY = 29;

// Raw Linux input-event-codes.h keycodes (see /usr/include/linux/input-event-codes.h)
// for the non-printable keys the virtual keyboard exposes. Printable
// characters (letters, digits, punctuation, space) never go through this
// map — they're sent as literal text via `ydotool type`, which resolves
// shift/keymap internally.
const SPECIAL_KEYS = {
  Enter: 28,
  Backspace: 14,
  Tab: 15,
  Escape: 1,
  Delete: 111,
  ArrowUp: 103,
  ArrowDown: 108,
  ArrowLeft: 105,
  ArrowRight: 106,
};

// Fixed, named shortcuts exposed by the tablet. The client never sends raw
// keycodes or an arbitrary modifier sequence; it can only select one of these
// allowlisted combinations.
const SHORTCUTS = {
  'Ctrl+A': [CTRL_KEY, 30],
  'Ctrl+B': [CTRL_KEY, 48],
  'Ctrl+C': [CTRL_KEY, 46],
  'Ctrl+D': [CTRL_KEY, 32],
  'Ctrl+E': [CTRL_KEY, 18],
  'Ctrl+F': [CTRL_KEY, 33],
  'Ctrl+G': [CTRL_KEY, 34],
  'Ctrl+H': [CTRL_KEY, 35],
  'Ctrl+I': [CTRL_KEY, 23],
  'Ctrl+J': [CTRL_KEY, 36],
  'Ctrl+K': [CTRL_KEY, 37],
  'Ctrl+L': [CTRL_KEY, 38],
  'Ctrl+M': [CTRL_KEY, 50],
  'Ctrl+N': [CTRL_KEY, 49],
  'Ctrl+O': [CTRL_KEY, 24],
  'Ctrl+P': [CTRL_KEY, 25],
  'Ctrl+Q': [CTRL_KEY, 16],
  'Ctrl+R': [CTRL_KEY, 19],
  'Ctrl+S': [CTRL_KEY, 31],
  'Ctrl+T': [CTRL_KEY, 20],
  'Ctrl+U': [CTRL_KEY, 22],
  'Ctrl+V': [CTRL_KEY, 47],
  'Ctrl+W': [CTRL_KEY, 17],
  'Ctrl+X': [CTRL_KEY, 45],
  'Ctrl+Y': [CTRL_KEY, 21],
  'Ctrl+Z': [CTRL_KEY, 44],
};

const WINDOW_ACTIONS = {
  close: ['dispatch', 'hl.dsp.window.close()'],
  fullscreen: ['dispatch', 'hl.dsp.window.fullscreen({ action = "toggle", mode = "fullscreen" })'],
  screen1: ['dispatch', 'hl.dsp.focus({ monitor = 0 })'],
  screen2: ['dispatch', 'hl.dsp.focus({ monitor = 1 })'],
};

class DesktopController {
  constructor({ mockExec, logger, moveSensitivity = 1.5 }) {
    this.mockExec = mockExec;
    this.logger = logger;
    // Touch deltas arrive as raw CSS-pixel drag distance on the tablet's
    // trackpad surface, which has no fixed relationship to the PC's real
    // pointer-acceleration curve — this multiplier is the owner's tuning
    // knob (config/service.json `remoteDesktop.moveSensitivity`) rather
    // than something baked into the frontend, so it can be adjusted
    // without a frontend redeploy.
    this.moveSensitivity = moveSensitivity;
    // A tap creates one WS message. Without serialization, a quick run of
    // taps starts several ydotool processes at once and their events race,
    // producing missing or reordered characters. Keep one keyboard stream.
    this.keyboardQueue = Promise.resolve();
  }

  _enqueueKeyboard(operation) {
    const next = this.keyboardQueue.then(operation, operation);
    // Keep the internal chain recoverable after a rejected command while
    // returning the real result/error to the caller.
    this.keyboardQueue = next.catch(() => {});
    return next;
  }

  async moveCursor({ dx, dy }) {
    if (this.mockExec) {
      await sleep(simulatedDelayMs());
      this.logger.info('mockExec: cursor move', { dx, dy });
      return { ok: true };
    }
    if (process.platform !== 'linux') {
      throw new Error('Trackpad control is only implemented for this Linux (Omarchy) build.');
    }
    try {
      const scaledDx = Math.round(dx * this.moveSensitivity);
      const scaledDy = Math.round(dy * this.moveSensitivity);
      if (!scaledDx && !scaledDy) return { ok: true };
      await run('ydotool', ['mousemove', '-x', String(scaledDx), '-y', String(scaledDy)]);
      return { ok: true };
    } catch (err) {
      throw ydotoolError(err);
    }
  }

  async click({ button = 'left' } = {}) {
    if (this.mockExec) {
      await sleep(simulatedDelayMs());
      this.logger.info('mockExec: click', { button });
      return { ok: true };
    }
    if (process.platform !== 'linux') {
      throw new Error('Trackpad control is only implemented for this Linux (Omarchy) build.');
    }
    const code = YDOTOOL_CLICK_CODES[button];
    if (!code) throw new Error(`Unknown click button: ${button}`);
    try {
      await run('ydotool', ['click', code]);
      return { ok: true };
    } catch (err) {
      throw ydotoolError(err);
    }
  }

  async scroll({ dy }) {
    if (this.mockExec) {
      await sleep(simulatedDelayMs());
      this.logger.info('mockExec: scroll', { dy });
      return { ok: true };
    }
    // TODO(real-linux): ydotool's wheel/scroll support isn't verified on
    // the 1.0.4 build available for this machine — see README TODO rather
    // than shipping an unverified invocation.
    throw new Error('scroll: real ydotool wheel support not yet wired up (see README TODO)');
  }

  /** Types literal text (letters/digits/punctuation/space) from the virtual keyboard. */
  async typeText(text) {
    if (typeof text !== 'string' || !text) return { ok: true };
    return this._enqueueKeyboard(async () => {
      if (this.mockExec) {
        await sleep(simulatedDelayMs());
        this.logger.info('mockExec: type', { length: text.length });
        return { ok: true };
      }
      if (process.platform !== 'linux') {
        throw new Error('Virtual keyboard is only implemented for this Linux (Omarchy) build.');
      }
      try {
        await run('ydotool', ['type', '--key-delay=4', '--key-hold=8', '--', text]);
        return { ok: true };
      } catch (err) {
        throw ydotoolError(err);
      }
    });
  }

  /** Presses one named non-printable key from the fixed SPECIAL_KEYS allowlist. */
  async pressKey(key) {
    const code = SPECIAL_KEYS[key];
    if (!code) throw new Error(`Unknown key: ${key}`);
    return this._enqueueKeyboard(async () => {
      if (this.mockExec) {
        await sleep(simulatedDelayMs());
        this.logger.info('mockExec: key press', { key });
        return { ok: true };
      }
      if (process.platform !== 'linux') {
        throw new Error('Virtual keyboard is only implemented for this Linux (Omarchy) build.');
      }
      try {
        await run('ydotool', ['key', `${code}:1`, `${code}:0`]);
        return { ok: true };
      } catch (err) {
        throw ydotoolError(err);
      }
    });
  }

  /** Presses one fixed Ctrl shortcut without accepting arbitrary keycodes. */
  async pressShortcut(shortcut) {
    const codes = SHORTCUTS[shortcut];
    if (!codes) throw new Error(`Unknown shortcut: ${shortcut}`);
    return this._enqueueKeyboard(async () => {
      if (this.mockExec) {
        await sleep(simulatedDelayMs());
        this.logger.info('mockExec: shortcut', { shortcut });
        return { ok: true };
      }
      if (process.platform !== 'linux') {
        throw new Error('Keyboard shortcuts are only implemented for this Linux (Omarchy) build.');
      }
      const [modifier, key] = codes;
      try {
        await run('ydotool', ['key', `${modifier}:1`, `${key}:1`, `${key}:0`, `${modifier}:0`]);
        return { ok: true };
      } catch (err) {
        throw ydotoolError(err);
      }
    });
  }

  /** Close or fullscreen the currently focused Hyprland window. */
  async windowAction(action) {
    const args = WINDOW_ACTIONS[action];
    if (!args) throw new Error(`Unknown window action: ${action}`);
    return this._enqueueKeyboard(async () => {
      if (this.mockExec) {
        await sleep(simulatedDelayMs());
        this.logger.info('mockExec: window action', { action });
        return { ok: true };
      }
      if (process.platform !== 'linux') {
        throw new Error('Window controls are only implemented for this Linux (Hyprland) build.');
      }
      try {
        const output = String(await run('hyprctl', args)).trim();
        // Hyprland 0.56's Lua dispatcher can report a parse/runtime error in
        // stdout while still returning exit code 0. Treat anything other than
        // its documented success response as a real error for the tablet UI.
        if (output !== 'ok') throw new Error(output || `Window action '${action}' failed.`);
        return { ok: true };
      } catch (err) {
        throw new Error(err.message || `Window action '${action}' failed.`);
      }
    });
  }
}

function ydotoolError(err) {
  if (err.code === 'ENOENT') {
    return new Error('ydotool is not installed — see server/README.md "Virtual keyboard / trackpad" for setup steps.');
  }
  return new Error(err.message.includes('ydotoold') || /connect/i.test(err.message)
    ? 'ydotoold (the ydotool background daemon) is not running — see server/README.md "Virtual keyboard / trackpad".'
    : err.message);
}

module.exports = { DesktopController };
