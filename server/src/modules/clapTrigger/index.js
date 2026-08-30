'use strict';

const { spawn } = require('child_process');

const DEFAULTS = Object.freeze({
  sampleRate: 16_000,
  minPeak: 7_500,
  noiseMultiplier: 5,
  minCrestFactor: 3,
  minGapMs: 180,
  maxGapMs: 850,
  cooldownMs: 5_000,
  // Voice mode: a short spoken burst above this level triggers the workspace.
  // This is intentionally local voice activity detection, not speech-to-text.
  triggerMode: 'voice',
  voiceMinPeak: 900,
  voiceMinAverage: 120,
  voiceMinDurationMs: 100,
});

/**
 * Detects two short, loud transients from the default PulseAudio/PipeWire
 * microphone and launches the configured workstation set. No audio is kept
 * or transmitted; PCM bytes are inspected in memory and immediately dropped.
 */
class ClapTrigger {
  constructor({ executor, logger, options = {}, recorder = 'parec' }) {
    this.executor = executor;
    this.logger = logger;
    this.options = { ...DEFAULTS, ...options };
    this.recorder = recorder;
    this.noiseFloor = 350;
    this.firstClapAt = 0;
    this.lastTransientAt = 0;
    this.cooldownUntil = 0;
    this.child = null;
    this.restartTimer = null;
    this.stopped = false;
    this.pendingPcm = Buffer.alloc(0);
    this.voiceStartedAt = 0;
  }

  start() {
    if (this.child || this.stopped) return;
    const args = [
      '--raw',
      '--format=s16le',
      `--rate=${this.options.sampleRate}`,
      '--channels=1',
      // Omitting the device makes parec use its client-side remembered
      // source, which can point at a removed PipeWire node. The server-side
      // alias always follows the current default microphone.
      `--device=${this.options.device || '@DEFAULT_SOURCE@'}`,
    ];
    const child = spawn(this.recorder, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child;
    child.stdout.on('data', (chunk) => this.processPcm(chunk));
    child.stderr.on('data', (chunk) => {
      const message = chunk.toString().trim();
      if (message) this.logger.warn('clap microphone warning', { message });
    });
    child.once('spawn', () => this.logger.info(
      this.options.triggerMode === 'voice' ? 'voice trigger listener active' : 'double-clap listener active',
      { recorder: this.recorder }
    ));
    child.once('error', (err) => this.logger.error('double-clap listener failed', { error: err.message }));
    child.once('exit', (code, signal) => {
      if (this.child === child) this.child = null;
      if (this.stopped) return;
      this.logger.warn('double-clap listener exited; retrying', { code, signal });
      this.restartTimer = setTimeout(() => this.start(), 3_000);
      this.restartTimer.unref();
    });
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.restartTimer);
    if (this.child) this.child.kill('SIGTERM');
    this.child = null;
  }

  processPcm(chunk, now = Date.now()) {
    if (!Buffer.isBuffer(chunk) || chunk.length < 2) return false;
    // parec is free to deliver large chunks. Looking at a whole chunk as one
    // event merges two claps into a single peak, so analyze 20 ms windows.
    const pcm = this.pendingPcm.length ? Buffer.concat([this.pendingPcm, chunk]) : chunk;
    const frameBytes = Math.max(2, Math.round(this.options.sampleRate * 0.02) * 2);
    const completeBytes = Math.floor(pcm.length / frameBytes) * frameBytes;
    this.pendingPcm = pcm.subarray(completeBytes);
    if (!completeBytes) return false;

    const frameCount = completeBytes / frameBytes;
    let triggered = false;
    for (let offset = 0; offset < completeBytes; offset += frameBytes) {
      const frameNumber = offset / frameBytes;
      const frameNow = now - (frameCount - 1 - frameNumber) * 20;
      triggered = this.processFrame(pcm.subarray(offset, offset + frameBytes), frameNow) || triggered;
    }
    return triggered;
  }

  processFrame(chunk, now) {
    let peak = 0;
    let sum = 0;
    const samples = Math.floor(chunk.length / 2);
    for (let i = 0; i < samples; i += 1) {
      const value = Math.abs(chunk.readInt16LE(i * 2));
      peak = Math.max(peak, value);
      sum += value;
    }
    const average = sum / samples;
    // Slowly follow normal room noise, but do not let a clap immediately
    // raise the baseline enough to hide the second clap.
    if (peak < this.noiseFloor * 3) {
      this.noiseFloor = this.noiseFloor * 0.98 + average * 0.02;
    }
    const threshold = Math.max(this.options.minPeak, this.noiseFloor * this.options.noiseMultiplier);
    // A hand clap has a sharp peak compared with the rest of the buffer.
    // Requiring that crest keeps speech, music, and steady appliance noise
    // from being interpreted as claps merely because they are loud.
    const crestFactor = peak / Math.max(average, 1);
    if (this.options.triggerMode === 'voice') {
      const voiced = peak >= this.options.voiceMinPeak && average >= this.options.voiceMinAverage;
      if (voiced) {
        if (!this.voiceStartedAt) this.voiceStartedAt = now;
        if (now - this.voiceStartedAt >= this.options.voiceMinDurationMs && now >= this.cooldownUntil) {
          this.voiceStartedAt = 0;
          this.cooldownUntil = now + this.options.cooldownMs;
          void this.launchWorkspace('voice trigger');
          return true;
        }
      } else if (this.voiceStartedAt && now - this.voiceStartedAt > 250) {
        this.voiceStartedAt = 0;
      }
      return false;
    }
    if (peak < threshold || crestFactor < this.options.minCrestFactor || now - this.lastTransientAt < 120) return false;
    this.lastTransientAt = now;

    if (now < this.cooldownUntil) return false;
    const gap = now - this.firstClapAt;
    if (this.firstClapAt && gap >= this.options.minGapMs && gap <= this.options.maxGapMs) {
      this.firstClapAt = 0;
      this.cooldownUntil = now + this.options.cooldownMs;
      void this.launchWorkspace('double clap');
      return true;
    }
    this.firstClapAt = now;
    return false;
  }

  async launchWorkspace(trigger = 'trigger') {
    this.logger.info(`${trigger} detected; launching workspace`);
    const apps = [
      { exePath: '/usr/bin/spotify', args: [], label: 'Spotify (double clap)' },
      { exePath: '/usr/bin/code', args: [], label: 'Visual Studio Code (double clap)' },
      { exePath: '/usr/bin/foot', args: ['-e', 'bash', '-lc', 'codex; exec bash'], label: 'Codex CLI (double clap)' },
    ];
    const results = await Promise.all(apps.map((app) => this.executor.runExeFile(app)));
    const failed = results.filter((result) => !result.ok);
    if (failed.length) this.logger.error('double-clap workspace launch incomplete', { failures: failed.map((r) => r.stderr) });
  }
}

module.exports = { ClapTrigger, DEFAULTS };
