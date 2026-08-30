'use strict';

/**
 * System stats via `systeminformation`, per architecture-security.md §8.
 * Produces the exact SystemStatus shape from §8.2. Every field is
 * null-safe: a missing/unsupported metric (very common for GPU temp) never
 * throws, it just becomes `null` and the frontend renders "-".
 *
 * Cheap fields (CPU/RAM/network) refresh on the fast interval
 * (statusUpdateIntervalMs, default 1s). Slower/heavier fields (temps, GPU,
 * disk) refresh on statsSlowRefreshMs (default 2.5s) and are cached between
 * refreshes, per §8.2's "may repeat its last known value" allowance.
 */

const si = require('systeminformation');

async function safeCall(fn, fallback = null) {
  try {
    const result = await fn();
    return result;
  } catch {
    return fallback;
  }
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

class SystemStatsService {
  constructor({ mediaController, logger, slowRefreshMs = 2500 }) {
    this.mediaController = mediaController;
    this.logger = logger;
    this.slowRefreshMs = slowRefreshMs;
    this._slow = {
      cpuTemp: null,
      gpu: { usage_percent: null, temp_c: null, mem_used_mb: null, mem_total_mb: null },
      disk: [],
      network: { adapter: null, connected: false },
    };
    this._netPrev = null; // for rx/tx kbps delta calc
    this._startSlowRefreshLoop();
  }

  _startSlowRefreshLoop() {
    const tick = async () => {
      await this._refreshSlowFields();
      this._slowTimer = setTimeout(tick, this.slowRefreshMs);
      this._slowTimer.unref?.();
    };
    tick();
  }

  async _refreshSlowFields() {
    const [temp, graphics, fsSize, netInterfaces] = await Promise.all([
      safeCall(() => si.cpuTemperature()),
      safeCall(() => si.graphics()),
      safeCall(() => si.fsSize()),
      safeCall(() => si.networkInterfaceDefault()),
    ]);

    this._slow.cpuTemp = num(temp?.main);

    const gpu = graphics?.controllers?.[0];
    this._slow.gpu = {
      usage_percent: num(gpu?.utilizationGpu),
      temp_c: num(gpu?.temperatureGpu),
      mem_used_mb: num(gpu?.memoryUsed),
      mem_total_mb: num(gpu?.memoryTotal ?? gpu?.vram),
    };

    this._slow.disk = Array.isArray(fsSize)
      ? fsSize
          .filter((d) => d && typeof d.size === 'number' && d.size > 0)
          .map((d) => ({
            mount: d.mount ?? d.fs ?? 'unknown',
            used_gb: num(d.used ? d.used / 1e9 : null),
            total_gb: num(d.size ? d.size / 1e9 : null),
          }))
      : [];

    this._slow.defaultIface = typeof netInterfaces === 'string' ? netInterfaces : null;
  }

  async getStatus() {
    const [load, mem, netStats, uptime] = await Promise.all([
      safeCall(() => si.currentLoad()),
      safeCall(() => si.mem()),
      safeCall(() => si.networkStats(this._slow.defaultIface || undefined)),
      safeCall(() => Promise.resolve(si.time())),
    ]);

    const netEntry = Array.isArray(netStats) ? netStats[0] : null;

    const audio = this.mediaController ? this.mediaController.getAudioStatus() : { volume_percent: null, muted: null, mic_muted: null };

    return {
      cpu: {
        usage_percent: num(load?.currentLoad),
        temp_c: this._slow.cpuTemp,
      },
      gpu: { ...this._slow.gpu },
      ram: {
        used_mb: num(mem ? (mem.active ?? mem.used) / 1e6 : null),
        total_mb: num(mem?.total ? mem.total / 1e6 : null),
        usage_percent: num(mem?.total ? ((mem.active ?? mem.used) / mem.total) * 100 : null),
      },
      disk: this._slow.disk,
      network: {
        adapter: netEntry?.iface ?? null,
        rx_kbps: num(netEntry?.rx_sec ? (netEntry.rx_sec * 8) / 1000 : null),
        tx_kbps: num(netEntry?.tx_sec ? (netEntry.tx_sec * 8) / 1000 : null),
        connected: netEntry ? !!netEntry.operstate || netEntry.operstate === 'up' : false,
      },
      audio,
      uptime_seconds: num(uptime?.uptime ?? (typeof uptime === 'number' ? uptime : null)) ?? Math.round(process.uptime()),
    };
  }
}

module.exports = { SystemStatsService };
