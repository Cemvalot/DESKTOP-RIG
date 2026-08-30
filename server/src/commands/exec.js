'use strict';

/**
 * OS execution layer. Every real invocation goes through `execFile` only —
 * never `exec`, never shell-string interpolation — per
 * architecture-security.md §4.1/§4.2/§10.1.
 *
 * mockExec mode (reconciliation.md §4 "Dev-mode exec safety"): this repo is
 * developed on Linux, but the real actions here (shutdown.exe, rundll32.exe,
 * cmd.exe start, ipconfig.exe, Core Audio, WinRT media session) are
 * Windows-only and would simply throw/ENOENT on Linux. When mockExec is
 * active (auto-enabled off win32, or via config/service.json `mockExec:
 * true`), the real child_process call is replaced with a logged no-op that
 * still returns a realistic, correctly-shaped result after a small
 * simulated delay — so the full command flow (allowlist validation, dangerous
 * confirmation, WS command_result push, history) can be exercised end to end
 * without Windows hardware. mockExec is NEVER silently active when
 * process.platform === 'win32' unless the config flag explicitly says so.
 */

const { execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function simulatedDelayMs() {
  return 80 + Math.floor(Math.random() * 220); // 80-300ms, "realistic" async feel
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Runs a short-lived CLI command to completion and captures output — for
// utility commands that actually exit on their own (e.g. `resolvectl
// flush-caches`, `gio trash --empty`), as opposed to launching a GUI app
// (see runExeFile below, which must NOT wait for those to exit).
function runToCompletion(exePath, args = [], { timeout = 10_000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(exePath, args, { timeout, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.toString().trim() || error.message));
        return;
      }
      resolve(stdout?.toString() ?? '');
    });
  });
}

class Executor {
  constructor({ mockExec, logger }) {
    this.mockExec = mockExec;
    this.logger = logger;
    this._gameModeOn = false; // in-memory toggle state for the Linux toggle_game_mode handler
    if (mockExec) {
      logger.info('mockExec ACTIVE — OS-level command execution is stubbed (no real OS calls will be made)', {
        platform: process.platform,
      });
    } else {
      logger.info('mockExec inactive — commands will invoke real OS executables/APIs', {
        platform: process.platform,
      });
    }
  }

  /**
   * Run a fixed executable with a fixed argument array. Returns
   * { ok, code, stdout, stderr, mocked }.
   *
   * Uses spawn+detached+unref rather than waiting for the process to exit.
   * This matters a lot for launch_app/open_link/launch_game: the thing
   * being launched (Steam, a browser, a file manager) is a long-running GUI
   * app that doesn't exit on its own — the original execFile-with-timeout
   * implementation would wait up to 15s and then SIGTERM the freshly-
   * launched app out from under the user. Resolving as soon as the child
   * has actually started (the 'spawn' event) correctly reports "did this
   * launch" without blocking on "did it finish" — which is also the right
   * behavior for the short power-action scripts (lock/reboot/shutdown),
   * since the tablet shouldn't wait around for a reboot script to return.
   */
  async runExeFile({ exePath, args = [], label }) {
    if (this.mockExec) {
      const delay = simulatedDelayMs();
      this.logger.info('mockExec: would execFile', { exePath, args, label });
      await sleep(delay);
      return { ok: true, code: 0, stdout: `[mockExec] simulated success for ${label || exePath}`, stderr: '', mocked: true };
    }
    return new Promise((resolve) => {
      let settled = false;
      const done = (result) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      let child;
      try {
        child = spawn(exePath, args, { detached: true, stdio: 'ignore', windowsHide: true });
      } catch (err) {
        this.logger.error('spawn threw', { exePath, args, label, error: err.message });
        done({ ok: false, code: 1, stdout: '', stderr: err.message, mocked: false });
        return;
      }
      // Safety net: if neither event fires (shouldn't happen), don't hang
      // the command forever — report best-effort success after a short wait.
      const safety = setTimeout(() => done({ ok: true, code: 0, stdout: '', stderr: '', mocked: false }), 3000);
      child.once('spawn', () => {
        clearTimeout(safety);
        child.unref();
        done({ ok: true, code: 0, stdout: '', stderr: '', mocked: false });
      });
      child.once('error', (err) => {
        clearTimeout(safety);
        this.logger.error('execFile failed to start', { exePath, args, label, error: err.message });
        done({ ok: false, code: err.code === 'ENOENT' ? 127 : 1, stdout: '', stderr: err.message, mocked: false });
      });
    });
  }

  /**
   * Named in-process handlers for actions that aren't a clean single exe
   * invocation (config/maintenance.json `handler` entries), per
   * architecture-security.md §4.3. Real Windows implementations are TODOs
   * (see server/README.md "Real vs mocked" table) — mockExec mode fully
   * exercises the flow.
   */
  async runHandler(handlerName) {
    const isLinux = process.platform === 'linux';
    // Real Linux implementations target Omarchy (Hyprland/Arch) specifically
    // — the `omarchy-*` commands used below are Omarchy's own first-class
    // CLI (confirmed present on this machine), not generic Linux tools.
    // On a non-Omarchy Linux box these would need swapping for raw
    // hyprctl/systemctl/wpctl equivalents — noted per-handler below.
    const knownHandlers = {
      flush_dns: {
        label: 'Flush DNS Cache',
        real: async () => {
          if (isLinux) {
            // systemd-resolved's cache flush (confirmed present as
            // `resolvectl` on this machine). No-op harmlessly if the
            // machine isn't using systemd-resolved.
            await runToCompletion('resolvectl', ['flush-caches']);
            return;
          }
          await runToCompletion('ipconfig.exe', ['/flushdns']);
        },
      },
      empty_recycle_bin: {
        label: 'Empty Recycle Bin',
        real: async () => {
          if (isLinux) {
            // `gio trash --empty` — GNOME's trash CLI (gio confirmed
            // installed), non-interactive.
            await runToCompletion('gio', ['trash', '--empty']);
            return;
          }
          // TODO(real-windows): call SHEmptyRecycleBinW via a native
          // addon (e.g. ffi-napi/koffi) or a small compiled helper.
          throw new Error('empty_recycle_bin: real Windows implementation not yet wired up (see README TODO)');
        },
      },
      restart_spotify: {
        label: 'Restart Spotify',
        real: async () => {
          if (isLinux) {
            // Best-effort kill (fine if it wasn't running), then relaunch.
            // Hardcodes /usr/bin/spotify rather than reading apps.json's
            // real config here — a small duplication accepted for now;
            // wiring this through the loaded apps config is a clean
            // follow-up if the path ever needs to move.
            await runToCompletion('pkill', ['-x', 'spotify']).catch(() => {});
            await sleep(500);
            spawn('/usr/bin/spotify', [], { detached: true, stdio: 'ignore' }).unref();
            return;
          }
          // TODO(real-windows): taskkill /IM Spotify.exe /F then relaunch
          // via the configured apps.json exePath.
          throw new Error('restart_spotify: real Windows implementation not yet wired up (see README TODO)');
        },
      },
      clear_temp_files: {
        label: 'Clear Temp Files',
        real: async () => {
          if (isLinux) {
            // Scoped deliberately conservative: the user's own thumbnail
            // cache, not a system-wide /tmp sweep (which can yank files out
            // from under other running processes). Uses fs.rm directly —
            // no shell, no risk of a malformed path expanding unexpectedly.
            const dir = path.join(os.homedir(), '.cache', 'thumbnails');
            await fs.promises.rm(dir, { recursive: true, force: true });
            await fs.promises.mkdir(dir, { recursive: true });
            return;
          }
          // TODO(real-windows): recursively delete contents of %TEMP%
          // using fs.rm with care (never a shell rm -rf string).
          throw new Error('clear_temp_files: real Windows implementation not yet wired up (see README TODO)');
        },
      },
      // Added by lead reconciliation (docs/reconciliation.md) to close the
      // command-contract gap the frontend subagent flagged in
      // docs/frontend-notes.md #2 — these back Gaming/System screen actions
      // that had no allowlist entry yet.
      open_task_manager: {
        label: 'Task Manager',
        real: async () => {
          if (isLinux) {
            // No native "Task Manager" window on Hyprland — the closest
            // real equivalent is a terminal running btop (both confirmed
            // installed). runExeFile-style detached launch, not
            // runToCompletion — this needs to stay open.
            const child = spawn('foot', ['-e', 'btop'], { detached: true, stdio: 'ignore' });
            child.unref();
            return;
          }
          // TODO(real-windows): execFile('taskmgr.exe', [])
          throw new Error('open_task_manager: real Windows implementation not yet wired up (see README TODO)');
        },
      },
      take_screenshot: {
        label: 'Screenshot',
        real: async () => {
          if (isLinux) {
            // fullscreen+save skips the interactive slurp region-picker —
            // a remotely-triggered screenshot has no one at the PC to draw
            // a selection box. Saves to XDG_PICTURES_DIR per the script.
            await runToCompletion('omarchy-capture-screenshot', ['fullscreen', 'save']);
            return;
          }
          // TODO(real-windows): capture the primary display (e.g. via a
          // small native/PowerShell helper using System.Drawing) and save
          // to a configured screenshots folder; return the saved path.
          throw new Error('take_screenshot: real Windows implementation not yet wired up (see README TODO)');
        },
      },
      open_controller_tools: {
        label: 'Controller Tools',
        real: async () => {
          if (isLinux) {
            // No universal Linux controller-config panel; Steam's own
            // settings (where controller config lives) is the closest real
            // equivalent given Steam is already the confirmed gaming hub
            // here.
            spawn('steam', ['steam://open/settings'], { detached: true, stdio: 'ignore' }).unref();
            return;
          }
          // TODO(real-windows): execFile('cmd.exe', ['/c','start','','joy.cpl'])
          throw new Error('open_controller_tools: real Windows implementation not yet wired up (see README TODO)');
        },
      },
      toggle_game_mode: {
        label: 'Game Mode',
        real: async () => {
          if (isLinux) {
            // No OS-level "Game Mode" toggle on Linux. Closest real,
            // meaningful action: switch Omarchy's power profile to
            // performance (toggling based on last-known state kept on the
            // executor instance — reset to 'ac' baseline on server
            // restart, which is an acceptable simplification). Not every
            // machine's power-profiles-daemon exposes a 'performance'
            // tier (this one only offers power-saver/balanced) — check
            // first and fail with a clear, honest message rather than
            // silently no-op'ing or blindly calling a doomed command.
            const available = (await runToCompletion('omarchy-powerprofiles-list', [])).split('\n').map((s) => s.trim()).filter(Boolean);
            if (!available.includes('performance')) {
              throw new Error(`toggle_game_mode: no 'performance' power profile available on this hardware (has: ${available.join(', ') || 'none'})`);
            }
            this._gameModeOn = !this._gameModeOn;
            await runToCompletion('omarchy-powerprofiles-set', ['ac', this._gameModeOn ? 'performance' : 'balanced']);
            return;
          }
          // TODO(real-windows): Game Mode is a Windows Settings toggle with
          // no documented public API/registry contract for silent
          // toggling — likely needs a UI-automation approach.
          throw new Error('toggle_game_mode: real Windows implementation not yet wired up (see README TODO)');
        },
      },
      toggle_perf_overlay: {
        label: 'Performance Overlay',
        real: async () => {
          if (isLinux) {
            // TODO(real-linux): no overlay tool (e.g. MangoHud) is
            // installed on this machine to drive — install it and wire a
            // real toggle (MangoHud reads a runtime toggle key by default,
            // or can be driven via its config file) as a follow-up.
            throw new Error('toggle_perf_overlay: no overlay tool (e.g. MangoHud) installed — see README TODO');
          }
          // TODO(real-windows): toggle a specific overlay (e.g. Xbox Game
          // Bar's FPS overlay via its own hotkey simulation, or a
          // third-party overlay's CLI) — vendor-specific.
          throw new Error('toggle_perf_overlay: real Windows implementation not yet wired up (see README TODO)');
        },
      },
      start_screen_recording: {
        label: 'Start Screen Recording',
        real: async () => {
          if (isLinux) {
            // --fullscreen skips the interactive monitor/region picker for
            // the same reason take_screenshot does (no one's at the PC).
            // The script itself toggles start/stop based on whether
            // gpu-screen-recorder is already running.
            await runToCompletion('omarchy-capture-screenrecording', ['--fullscreen'], { timeout: 15_000 });
            return;
          }
          // TODO(real-windows): drive Xbox Game Bar's record hotkey via
          // SendInput, or shell out to a configured OBS Studio instance
          // through the obs module (see server/src/modules/obs) once
          // enabled.
          throw new Error('start_screen_recording: real Windows implementation not yet wired up (see README TODO)');
        },
      },
      stop_screen_recording: {
        label: 'Stop Screen Recording',
        real: async () => {
          if (isLinux) {
            // --stop-recording makes this a no-op (exit 1, caught below)
            // rather than accidentally starting a new recording if one
            // wasn't already running.
            await runToCompletion('omarchy-capture-screenrecording', ['--fullscreen', '--stop-recording'], { timeout: 15_000 }).catch(
              () => {}
            );
            return;
          }
          // TODO(real-windows): counterpart to start_screen_recording.
          throw new Error('stop_screen_recording: real Windows implementation not yet wired up (see README TODO)');
        },
      },
    };

    const handler = knownHandlers[handlerName];
    if (!handler) {
      return { ok: false, code: 1, stdout: '', stderr: `Unknown handler: ${handlerName}`, mocked: this.mockExec };
    }

    if (this.mockExec) {
      const delay = simulatedDelayMs();
      this.logger.info('mockExec: would run handler', { handlerName, label: handler.label });
      await sleep(delay);
      return { ok: true, code: 0, stdout: `[mockExec] simulated success for handler '${handlerName}'`, stderr: '', mocked: true };
    }

    try {
      await handler.real();
      return { ok: true, code: 0, stdout: `handler '${handlerName}' completed`, stderr: '', mocked: false };
    } catch (err) {
      this.logger.error('handler failed', { handlerName, error: err.message });
      return { ok: false, code: 1, stdout: '', stderr: err.message, mocked: false };
    }
  }
}

module.exports = { Executor };
