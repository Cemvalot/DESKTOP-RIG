// frontend/src/data/mockProvider.js
//
// Deterministic fake-data implementation of the provider contract
// (see provider.js). This is the DEFAULT active provider so the whole app
// is demoable with zero server running. Telemetry drifts slowly and
// smoothly, now-playing is a fake looping track, and commands resolve
// after a short simulated delay with an occasional simulated failure so
// failure states are exercisable in the UI.

import { Channel, ProviderError } from "./provider.js";

const seedUrl = (name) => new URL(`./seed/${name}.json`, import.meta.url);

async function loadSeed(name) {
  const res = await fetch(seedUrl(name));
  if (!res.ok) throw new ProviderError("SEED_LOAD_FAILED", `Could not load seed ${name}`);
  return res.json();
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function jitter(value, amount, lo, hi) {
  return clamp(value + (Math.random() - 0.5) * amount, lo, hi);
}

const FAKE_TRACKS = [
  { title: "Night Drive", artist: "Auroral", duration_ms: 214000 },
  { title: "Glass Corridor", artist: "Vela Set", duration_ms: 198000 },
  { title: "Low Orbit", artist: "Kestrel", duration_ms: 251000 },
];

let idCounter = 1;
function nextId(prefix) {
  return `${prefix}_${(idCounter++).toString(36)}${Date.now().toString(36).slice(-4)}`;
}

export function createMockProvider() {
  const statusChan = new Channel();
  const nowPlayingChan = new Channel();
  const connectionChan = new Channel();
  const commandResultChan = new Channel();

  let statusTimer = null;
  let nowPlayingTimer = null;
  let destroyed = false;

  // In-memory simulated PC state
  const stats = {
    cpu: 28,
    gpu: 34,
    ram: 51,
    cpuTemp: 54,
    gpuTemp: 58,
  };

  const track = {
    ...FAKE_TRACKS[0],
    app: "Spotify",
    is_playing: true,
    position_ms: 41000,
    album_art_url: null,
  };
  let trackIndex = 0;

  const commandHistory = [];
  const pendingConfirmations = new Map(); // confirm_token -> command

  function pushHistory(entry) {
    commandHistory.unshift({ ...entry, at: new Date().toISOString() });
    if (commandHistory.length > 50) commandHistory.length = 50;
  }

  function buildStatus() {
    stats.cpu = jitter(stats.cpu, 6, 4, 92);
    stats.gpu = jitter(stats.gpu, 8, 2, 96);
    stats.ram = jitter(stats.ram, 2, 20, 88);
    stats.cpuTemp = jitter(stats.cpuTemp, 1.5, 38, 84);
    stats.gpuTemp = jitter(stats.gpuTemp, 1.8, 36, 88);
    return {
      cpu: { usage_percent: Math.round(stats.cpu * 10) / 10, temp_c: Math.round(stats.cpuTemp * 10) / 10 },
      gpu: {
        usage_percent: Math.round(stats.gpu * 10) / 10,
        temp_c: Math.round(stats.gpuTemp * 10) / 10,
        mem_used_mb: Math.round(1024 + stats.gpu * 40),
        mem_total_mb: 8192,
      },
      ram: { used_mb: Math.round((stats.ram / 100) * 32768), total_mb: 32768, usage_percent: Math.round(stats.ram * 10) / 10 },
      disk: [
        { mount: "C:", used_gb: 240.1, total_gb: 512.0 },
        { mount: "D:", used_gb: 110.4, total_gb: 1024.0 },
      ],
      network: { adapter: "Wi-Fi", rx_kbps: jitter(120, 60, 0, 900), tx_kbps: jitter(18, 10, 0, 200), connected: true },
      audio: { volume_percent: audioState.level, muted: audioState.muted, mic_muted: audioState.micMuted },
      uptime_seconds: Math.round(Date.now() / 1000) % 900000,
    };
  }

  const audioState = { level: 62, muted: false, micMuted: false };

  function startPushLoops() {
    statusTimer = setInterval(() => {
      if (destroyed) return;
      statusChan.emit(buildStatus());
    }, 1000);
    nowPlayingTimer = setInterval(() => {
      if (destroyed) return;
      if (track.is_playing) {
        track.position_ms += 1000;
        if (track.position_ms >= track.duration_ms) {
          trackIndex = (trackIndex + 1) % FAKE_TRACKS.length;
          Object.assign(track, FAKE_TRACKS[trackIndex]);
          track.position_ms = 0;
          nowPlayingChan.emit({ ...track });
        }
      }
    }, 1000);
    // Announce "always connected" once at boot.
    setTimeout(() => connectionChan.emit({ state: "connected", lastConnectedAt: new Date().toISOString() }), 50);
  }

  function simulateDelay(min = 250, max = 700) {
    return new Promise((resolve) => setTimeout(resolve, min + Math.random() * (max - min)));
  }

  function maybeFail(failRate = 0.08) {
    return Math.random() < failRate;
  }

  async function resolveCommand(id, dangerous) {
    await simulateDelay(dangerous ? 400 : 250, dangerous ? 900 : 700);
    if (destroyed) return;
    const failed = maybeFail();
    commandResultChan.emit({
      command_id: id,
      status: failed ? "error" : "success",
      message: failed ? "Simulated failure — the PC did not respond in time." : null,
    });
    if (commandHistory[0] && commandHistory[0].id === id) {
      commandHistory[0].result = failed ? "error" : "success";
    }
  }

  return {
    async init() {
      startPushLoops();
    },

    isPaired() {
      return true; // mock mode never requires pairing
    },

    async pair(_code, deviceName) {
      await simulateDelay(200, 500);
      return { token: "mock-token", token_id: "mock-device", device_name: deviceName, expires_at: null };
    },

    async revoke() {
      return { revoked: true };
    },

    async getPcName() {
      const svc = await loadSeed("service");
      return svc.pcName;
    },

    async getStatus() {
      return buildStatus();
    },
    subscribeStatus(cb) {
      return statusChan.subscribe(cb);
    },

    async getNowPlaying() {
      return { ...track };
    },
    subscribeNowPlaying(cb) {
      return nowPlayingChan.subscribe(cb);
    },

    subscribeConnection(cb) {
      return connectionChan.subscribe(cb);
    },
    subscribeCommandResult(cb) {
      return commandResultChan.subscribe(cb);
    },
    subscribeAuthInvalid() {
      // Mock is always "paired" — never fires. Return a no-op unsubscribe
      // to match the live provider's contract shape (provider.js).
      return () => {};
    },

    async getApps() {
      return (await loadSeed("apps")).apps;
    },
    async getLinks() {
      return (await loadSeed("links")).links;
    },
    async getMaintenanceCommands() {
      return (await loadSeed("maintenance")).commands;
    },
    async getGames() {
      return loadSeed("games");
    },
    async getSmartHomeConfig() {
      return loadSeed("smarthome");
    },

    async executeCommand(cmd) {
      await simulateDelay(120, 300);
      const dangerous =
        cmd.type === "power_action" ||
        (cmd.type === "maintenance" && ["empty-recycle-bin", "clear-temp"].includes(cmd.task_id));

      if (dangerous) {
        const confirm_token = nextId("cf");
        pendingConfirmations.set(confirm_token, { cmd, created_at: Date.now() });
        setTimeout(() => pendingConfirmations.delete(confirm_token), 10000);
        return {
          status: "confirmation_required",
          confirm_token,
          expires_in_seconds: 10,
          command_summary: summarize(cmd),
        };
      }

      const id = nextId("cmd");
      pushHistory({ id, type: cmd.type, target: cmd.app_id || cmd.link_id || cmd.task_id || cmd.action || cmd.steam_app_id, dangerous: false, result: "pending" });
      resolveCommand(id, false);
      return { id, status: "accepted" };
    },

    async confirmCommand(confirmToken) {
      const entry = pendingConfirmations.get(confirmToken);
      if (!entry) {
        throw new ProviderError("CONFIRMATION_EXPIRED", "This confirmation has expired.", 410);
      }
      pendingConfirmations.delete(confirmToken);
      const id = nextId("cmd");
      pushHistory({ id, type: entry.cmd.type, target: entry.cmd.action || entry.cmd.task_id, dangerous: true, result: "pending" });
      resolveCommand(id, true);
      return { id, status: "accepted" };
    },

    async mediaControl(action) {
      await simulateDelay(80, 200);
      if (action === "play") track.is_playing = true;
      else if (action === "pause") track.is_playing = false;
      else if (action === "toggle") track.is_playing = !track.is_playing;
      else if (action === "stop") {
        track.is_playing = false;
        track.position_ms = 0;
      } else if (action === "next") {
        trackIndex = (trackIndex + 1) % FAKE_TRACKS.length;
        Object.assign(track, FAKE_TRACKS[trackIndex]);
        track.position_ms = 0;
      } else if (action === "previous") {
        trackIndex = (trackIndex - 1 + FAKE_TRACKS.length) % FAKE_TRACKS.length;
        Object.assign(track, FAKE_TRACKS[trackIndex]);
        track.position_ms = 0;
      }
      nowPlayingChan.emit({ ...track });
      const id = nextId("cmd");
      return { accepted: true, id };
    },

    async setVolume(opts) {
      await simulateDelay(60, 150);
      if (typeof opts.level === "number") audioState.level = clamp(opts.level, 0, 100);
      if (typeof opts.mute === "boolean") audioState.muted = opts.mute;
      return { level: audioState.level, muted: audioState.muted };
    },

    async setMic(opts) {
      await simulateDelay(60, 150);
      audioState.micMuted = !!opts.mute;
      return { muted: audioState.micMuted };
    },

    async getCommandHistory() {
      return commandHistory.slice(0, 10);
    },

    async clearCommandHistory() {
      const cleared = commandHistory.length;
      commandHistory.length = 0;
      return { cleared };
    },

    async wol() {
      await simulateDelay(200, 400);
      return { sent: true };
    },

    // Mock mode has no real PC to type on or move a cursor on.
    subscribeDesktopError() {
      return () => {};
    },
    sendPointerInput() {},
    sendKeyboardInput() {},

    destroy() {
      destroyed = true;
      clearInterval(statusTimer);
      clearInterval(nowPlayingTimer);
      statusChan.clear();
      nowPlayingChan.clear();
      connectionChan.clear();
      commandResultChan.clear();
    },
  };
}

function summarize(cmd) {
  if (cmd.type === "power_action") {
    const verbs = { lock: "Lock", sleep: "Sleep", restart: "Restart", shutdown: "Shut down" };
    return `${verbs[cmd.action] || "Run"} this PC`;
  }
  if (cmd.type === "maintenance") return `Run maintenance task "${cmd.task_id}"`;
  return "Run this command";
}
