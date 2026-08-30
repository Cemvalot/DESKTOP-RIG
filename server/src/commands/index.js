'use strict';

/**
 * Command allowlist resolver + executor per architecture-security.md §4 and
 * the launch_game addition from reconciliation.md §2.
 *
 * The tablet NEVER supplies an exePath, raw args, a shell string, or a
 * handler name — only an id/enum that is looked up against the loaded
 * config. If the id doesn't resolve, the request is rejected (404/400).
 * Every real OS call goes through Executor.runExeFile/runHandler, which use
 * execFile exclusively (never exec/shell interpolation).
 */

const STEAM_APP_ID_RE = /^[0-9]{1,10}$/;
const POWER_ACTIONS = new Set(['lock', 'sleep', 'restart', 'shutdown']);
const MEDIA_ACTIONS = new Set(['play', 'pause', 'next', 'previous', 'stop', 'toggle']);

// "Open this URL/file/folder/URI with the OS default handler, without
// blocking" — platform-specific because there's no portable single command
// for it. `start` (Windows) and `xdg-open` (Linux) both hand off to the
// right app and return immediately, which is exactly the semantics
// runExeFile's non-blocking spawn expects.
function openTarget(target) {
  if (process.platform === 'linux') {
    return { exePath: 'xdg-open', args: [target] };
  }
  return { exePath: 'cmd.exe', args: ['/c', 'start', '', target] };
}

function rejectionError(status, code, message) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

/**
 * Validate an incoming CommandRequest body against config. Returns a
 * resolved-command descriptor (never performs I/O) or throws a rejection
 * error with .status/.code set, matching architecture-security.md §4.6's
 * rejection shape.
 */
function resolveCommand(body, config) {
  if (!body || typeof body !== 'object' || typeof body.type !== 'string') {
    throw rejectionError(400, 'INVALID_REQUEST', 'Missing or invalid command type.');
  }

  switch (body.type) {
    case 'launch_app': {
      const app = (config.apps.apps || []).find((a) => a.id === body.app_id);
      if (!app) throw rejectionError(404, 'UNKNOWN_APP_ID', `No app configured with id '${body.app_id}'`);
      return {
        type: 'launch_app',
        targetId: app.id,
        dangerous: !!app.dangerous,
        summary: `Launch ${app.label}`,
        run: (ctx) => ctx.executor.runExeFile({ exePath: app.exePath, args: app.args || [], label: app.label }),
      };
    }

    case 'open_link': {
      const link = (config.links.links || []).find((l) => l.id === body.link_id);
      if (!link) throw rejectionError(404, 'UNKNOWN_LINK_ID', `No link configured with id '${body.link_id}'`);
      return {
        type: 'open_link',
        targetId: link.id,
        dangerous: !!link.dangerous,
        summary: `Open ${link.label}`,
        run: (ctx) => ctx.executor.runExeFile({ ...openTarget(link.target), label: link.label }),
      };
    }

    case 'launch_game': {
      const steamAppId = body.steam_app_id;
      if (typeof steamAppId !== 'string' || !STEAM_APP_ID_RE.test(steamAppId)) {
        throw rejectionError(400, 'INVALID_STEAM_APP_ID', 'steam_app_id must match ^[0-9]{1,10}$');
      }
      return {
        type: 'launch_game',
        targetId: steamAppId,
        dangerous: false,
        summary: `Launch Steam game ${steamAppId}`,
        run: (ctx) =>
          ctx.executor.runExeFile({ ...openTarget(`steam://rungameid/${steamAppId}`), label: `steam:${steamAppId}` }),
      };
    }

    case 'media_control': {
      if (!MEDIA_ACTIONS.has(body.action)) {
        throw rejectionError(400, 'INVALID_MEDIA_ACTION', `action must be one of ${[...MEDIA_ACTIONS].join(', ')}`);
      }
      return {
        type: 'media_control',
        targetId: body.action,
        dangerous: false,
        summary: `Media: ${body.action}`,
        run: async (ctx) => {
          const r = await ctx.mediaController.mediaControl(body.action);
          return { ok: true, code: 0, stdout: JSON.stringify(r), stderr: '', mocked: ctx.mediaController.mockExec };
        },
      };
    }

    case 'volume_set': {
      const hasLevel = typeof body.level === 'number';
      const hasMute = typeof body.mute === 'boolean';
      if (!hasLevel && !hasMute) {
        throw rejectionError(400, 'INVALID_VOLUME_REQUEST', 'Provide numeric level (0-100) or boolean mute.');
      }
      if (hasLevel && (body.level < 0 || body.level > 100)) {
        throw rejectionError(400, 'INVALID_VOLUME_LEVEL', 'level must be 0-100.');
      }
      return {
        type: 'volume_set',
        targetId: hasLevel ? `level:${body.level}` : `mute:${body.mute}`,
        dangerous: false,
        summary: 'Set volume',
        run: async (ctx) => {
          const r = await ctx.mediaController.setVolume({ level: body.level, mute: body.mute });
          return { ok: true, code: 0, stdout: JSON.stringify(r), stderr: '', mocked: ctx.mediaController.mockExec };
        },
      };
    }

    case 'mic_mute': {
      if (typeof body.mute !== 'boolean') {
        throw rejectionError(400, 'INVALID_MIC_REQUEST', 'mute (boolean) is required.');
      }
      return {
        type: 'mic_mute',
        targetId: `mute:${body.mute}`,
        dangerous: false,
        summary: 'Mic mute toggle',
        run: async (ctx) => {
          const r = await ctx.mediaController.setMicMute(body.mute);
          return { ok: true, code: 0, stdout: JSON.stringify(r), stderr: '', mocked: ctx.mediaController.mockExec };
        },
      };
    }

    case 'power_action': {
      if (!POWER_ACTIONS.has(body.action)) {
        throw rejectionError(400, 'INVALID_POWER_ACTION', `action must be one of ${[...POWER_ACTIONS].join(', ')}`);
      }
      const summaries = {
        lock: 'Lock this PC',
        sleep: 'Put this PC to sleep',
        restart: 'Restart this PC',
        shutdown: 'Shut down this PC',
      };
      // Linux (Omarchy) path: omarchy-system-lock/-reboot/-shutdown are
      // Omarchy's own commands (they close app windows gracefully first,
      // show an OSD, etc.) — confirmed present on this machine. `sleep`
      // has no Omarchy wrapper meant to be user-invoked directly (its
      // omarchy-system-sleep-lock script is designed to be called BY
      // logind's own PrepareForSleep hook, already wired up system-wide),
      // so plain `systemctl suspend` is the correct call — that hook chain
      // takes care of locking before the machine actually sleeps.
      const linuxExecMap = {
        lock: { exePath: 'omarchy-system-lock', args: [] },
        sleep: { exePath: 'systemctl', args: ['suspend'] },
        restart: { exePath: 'omarchy-system-reboot', args: [] },
        shutdown: { exePath: 'omarchy-system-shutdown', args: [] },
      };
      const windowsExecMap = {
        lock: { exePath: 'rundll32.exe', args: ['user32.dll,LockWorkStation'] },
        sleep: { exePath: 'rundll32.exe', args: ['powrprof.dll,SetSuspendState', '0,1,0'] },
        restart: { exePath: 'shutdown.exe', args: ['/r', '/t', '0'] },
        shutdown: { exePath: 'shutdown.exe', args: ['/s', '/t', '0'] },
      };
      const execMap = process.platform === 'linux' ? linuxExecMap : windowsExecMap;
      const spec = execMap[body.action];
      return {
        type: 'power_action',
        targetId: body.action,
        dangerous: true, // always dangerous, not configurable off — §4.5
        summary: summaries[body.action],
        run: (ctx) => ctx.executor.runExeFile({ exePath: spec.exePath, args: spec.args, label: `power:${body.action}` }),
      };
    }

    case 'maintenance': {
      const entry = (config.maintenance.commands || []).find((c) => c.id === body.task_id);
      if (!entry) throw rejectionError(404, 'UNKNOWN_TASK_ID', `No maintenance task configured with id '${body.task_id}'`);
      return {
        type: 'maintenance',
        targetId: entry.id,
        dangerous: !!entry.dangerous,
        summary: entry.label,
        run: (ctx) => {
          if (entry.handler) {
            return ctx.executor.runHandler(entry.handler);
          }
          return ctx.executor.runExeFile({ exePath: entry.exePath, args: entry.args || [], label: entry.label });
        },
      };
    }

    default:
      throw rejectionError(400, 'UNKNOWN_COMMAND_TYPE', `Unknown command type '${body.type}'`);
  }
}

module.exports = { resolveCommand, rejectionError };
