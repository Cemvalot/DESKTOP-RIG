'use strict';

/**
 * Volume / mic-mute / media-transport control per
 * architecture-security.md §4.4.
 *
 * Real Windows implementation choice (documented, not yet wired — see
 * server/README.md "Real vs mocked" table for the precise follow-up):
 *   - Volume + mic mute: Windows Core Audio (`IAudioEndpointVolume`) via a
 *     small PowerShell bridge script (Add-Type-compiled inline C# calling
 *     the COM interface) invoked with execFile('powershell.exe', [...fixed
 *     args...]) — avoids adding a native-binding npm dependency (e.g.
 *     `loudness`/`node-audio-windows`) that would need prebuilt binaries
 *     and complicates `npm install` on this Linux dev box.
 *   - Media transport (play/pause/next/prev) + now-playing metadata:
 *     Windows.Media.Control `GlobalSystemMediaTransportControlsSessionManager`
 *     WinRT API, also reachable from a PowerShell bridge script. This is the
 *     single subsystem that serves both read (now-playing) and write
 *     (transport control), per §4.4's recommendation.
 *
 * In mockExec mode (always on this dev box), all of the above is replaced
 * by an in-memory MediaController that behaves realistically enough to
 * exercise the full command + WS now_playing_update flow end-to-end.
 */

const { execFile } = require('child_process');
const fs = require('fs/promises');

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function run(cmd, args = [], { timeout = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.toString().trim() || error.message));
        return;
      }
      resolve(stdout?.toString() ?? '');
    });
  });
}

const MOCK_TRACKS = [
  { app: 'Spotify', title: 'Sunset Drive', artist: 'Neon Fields', duration_ms: 210000 },
  { app: 'Spotify', title: 'Late Night Static', artist: 'Glass Horizon', duration_ms: 184000 },
  { app: 'Spotify', title: 'Analog Skies', artist: 'Redline', duration_ms: 232000 },
];

class MediaController {
  constructor({ mockExec, logger }) {
    this.mockExec = mockExec;
    this.logger = logger;
    this.state = {
      volumePercent: 65,
      muted: false,
      micMuted: false,
    };
    this._trackIndex = 0;
    this.nowPlaying = {
      app: MOCK_TRACKS[0].app,
      title: MOCK_TRACKS[0].title,
      artist: MOCK_TRACKS[0].artist,
      is_playing: false,
      position_ms: 0,
      duration_ms: MOCK_TRACKS[0].duration_ms,
      album_art_url: null,
    };
    this._onNowPlayingChange = null;
  }

  onNowPlayingChange(fn) {
    this._onNowPlayingChange = fn;
  }

  _emitNowPlaying() {
    if (this._onNowPlayingChange) this._onNowPlayingChange(this.getNowPlaying());
  }

  async setVolume({ level, mute }) {
    if (!this.mockExec) {
      // TODO(real-windows): Core Audio IAudioEndpointVolume via PowerShell
      // bridge script — see module header. Not implemented.
      this.logger.error('setVolume: real Windows implementation not yet wired up (see README TODO)');
      throw new Error('Volume control not implemented on this platform build yet.');
    }
    if (typeof level === 'number') {
      this.state.volumePercent = clamp(Math.round(level), 0, 100);
      if (this.state.volumePercent > 0) this.state.muted = false;
    }
    if (typeof mute === 'boolean') {
      this.state.muted = mute;
    }
    this.logger.info('mockExec: volume set', { ...this.state });
    return { level: this.state.volumePercent, muted: this.state.muted };
  }

  async setMicMute(mute) {
    if (!this.mockExec) {
      this.logger.error('setMicMute: real Windows implementation not yet wired up (see README TODO)');
      throw new Error('Mic control not implemented on this platform build yet.');
    }
    this.state.micMuted = !!mute;
    this.logger.info('mockExec: mic mute set', { micMuted: this.state.micMuted });
    return { muted: this.state.micMuted };
  }

  async mediaControl(action) {
    if (!this.mockExec) {
      this.logger.error('mediaControl: real Windows implementation not yet wired up (see README TODO)');
      throw new Error('Media transport control not implemented on this platform build yet.');
    }
    switch (action) {
      case 'play':
        this.nowPlaying.is_playing = true;
        break;
      case 'pause':
      case 'stop':
        this.nowPlaying.is_playing = false;
        if (action === 'stop') this.nowPlaying.position_ms = 0;
        break;
      case 'toggle':
        this.nowPlaying.is_playing = !this.nowPlaying.is_playing;
        break;
      case 'next':
        this._trackIndex = (this._trackIndex + 1) % MOCK_TRACKS.length;
        this._loadTrack();
        break;
      case 'previous':
        this._trackIndex = (this._trackIndex - 1 + MOCK_TRACKS.length) % MOCK_TRACKS.length;
        this._loadTrack();
        break;
      default:
        throw new Error(`Unknown media action: ${action}`);
    }
    this.logger.info('mockExec: media control', { action, nowPlaying: this.nowPlaying });
    this._emitNowPlaying();
    return { accepted: true };
  }

  _loadTrack() {
    const t = MOCK_TRACKS[this._trackIndex];
    this.nowPlaying = {
      app: t.app,
      title: t.title,
      artist: t.artist,
      is_playing: true,
      position_ms: 0,
      duration_ms: t.duration_ms,
      album_art_url: null,
    };
  }

  getNowPlaying() {
    return { ...this.nowPlaying };
  }

  getAudioStatus() {
    return {
      volume_percent: this.state.volumePercent,
      muted: this.state.muted,
      mic_muted: this.state.micMuted,
    };
  }
}

const EMPTY_NOW_PLAYING = { app: null, title: '', artist: '', is_playing: false, position_ms: 0, duration_ms: 0, album_art_url: null };

async function resolveArtwork(rawArtUrl) {
  if (/^https?:\/\//i.test(rawArtUrl || '')) return rawArtUrl;
  if (!rawArtUrl || !rawArtUrl.startsWith('file:///')) return null;
  try {
    const filePath = decodeURIComponent(new URL(rawArtUrl).pathname);
    // Chromium/player artwork is emitted in its temporary runtime directory.
    // Keep this narrowly scoped and cap the payload before putting it on WS.
    if (!filePath.startsWith('/tmp/') || !filePath.startsWith('/tmp/.com.google.')) return null;
    const data = await fs.readFile(filePath);
    if (data.length > 5 * 1024 * 1024) return null;
    let mime = 'image/jpeg';
    if (data[0] === 0x89 && data[1] === 0x50) mime = 'image/png';
    else if (data[0] === 0x47 && data[1] === 0x49) mime = 'image/gif';
    else if (data[0] === 0x52 && data[1] === 0x49) mime = 'image/webp';
    return `data:${mime};base64,${data.toString('base64')}`;
  } catch (_) {
    return null;
  }
}

function youtubeArtwork(mediaUrl) {
  if (!mediaUrl) return null;
  try {
    const url = new URL(mediaUrl);
    let id = url.searchParams.get('v');
    if (!id && /youtu\.be$/i.test(url.hostname)) id = url.pathname.slice(1).split('/')[0];
    return id ? `https://i.ytimg.com/vi/${encodeURIComponent(id)}/maxresdefault.jpg` : null;
  } catch (_) {
    return null;
  }
}

/**
 * Real Linux (Omarchy/PipeWire) implementation, added when the tablet's
 * real target turned out to be this Omarchy machine, not a Windows PC —
 * see docs/reconciliation.md's Linux-support addendum. Same public
 * interface as MediaController (constructor, setVolume, setMicMute,
 * mediaControl, getNowPlaying, getAudioStatus, onNowPlayingChange), so
 * index.js can pick either at startup without the rest of the server
 * knowing which one it got.
 *
 * - Volume/mute: `omarchy-audio-output-sink` resolves the real physical
 *   sink (following through any DSP/EQ passthrough — same resolution
 *   Omarchy's own volume keys use), then `pactl set-sink-volume`/
 *   `set-sink-mute` against it directly (the omarchy-audio-output-volume
 *   wrapper only supports relative +N/-N steps, not setting an absolute
 *   level, which is what the tablet's slider needs).
 * - Mic mute: `wpctl set-mute @DEFAULT_AUDIO_SOURCE@ <1|0>` — explicit
 *   set, not the toggle Omarchy's own keybind script uses, since the
 *   tablet always sends an explicit boolean.
 * - Media transport + now-playing: `playerctl` (MPRIS). **Not installed
 *   on this machine as of writing** — install with
 *   `sudo pacman -S playerctl` for this to actually work; until then these
 *   calls fail cleanly (surfaced as a normal failed command_result, not a
 *   crash) rather than pretending to succeed.
 * - Album art is intentionally left null: MPRIS art URLs are local
 *   filesystem paths on the PC, not reachable from the tablet's network
 *   fetch — serving them would need a small proxy endpoint, left as a
 *   follow-up rather than shipping a broken image URL.
 */
class LinuxMediaController {
  constructor({ mockExec, logger }) {
    this.mockExec = mockExec;
    this.logger = logger;
    this.state = { volumePercent: 65, muted: false, micMuted: false };
    this.nowPlaying = { ...EMPTY_NOW_PLAYING };
    this._onNowPlayingChange = null;
    this._trackIndex = 0; // only used in mockExec fallback mode, mirrors MediaController

    if (!this.mockExec) {
      this._pollTimer = setInterval(() => this._pollNowPlaying(), 1500);
      this._pollTimer.unref?.();
      this._pollNowPlaying(); // prime immediately rather than waiting for the first tick
    }
  }

  onNowPlayingChange(fn) {
    this._onNowPlayingChange = fn;
  }

  _emitNowPlaying() {
    if (this._onNowPlayingChange) this._onNowPlayingChange(this.getNowPlaying());
  }

  async _resolveSink() {
    try {
      const out = (await run('omarchy-audio-output-sink', [])).trim();
      return out || '@DEFAULT_AUDIO_SINK@';
    } catch (_) {
      return '@DEFAULT_AUDIO_SINK@'; // omarchy-* not present — fall back to the wpctl/pactl default alias
    }
  }

  async _readSinkVolume(sink) {
    try {
      const out = await run('pactl', ['get-sink-volume', sink]);
      const m = out.match(/(\d+)%/);
      return m ? clamp(parseInt(m[1], 10), 0, 100) : this.state.volumePercent;
    } catch (_) {
      return this.state.volumePercent;
    }
  }

  async _readSinkMuted(sink) {
    try {
      const out = await run('pactl', ['get-sink-mute', sink]);
      return /yes/i.test(out);
    } catch (_) {
      return this.state.muted;
    }
  }

  async setVolume({ level, mute }) {
    if (this.mockExec) {
      if (typeof level === 'number') {
        this.state.volumePercent = clamp(Math.round(level), 0, 100);
        if (this.state.volumePercent > 0) this.state.muted = false;
      }
      if (typeof mute === 'boolean') this.state.muted = mute;
      this.logger.info('mockExec: volume set', { ...this.state });
      return { level: this.state.volumePercent, muted: this.state.muted };
    }

    const sink = await this._resolveSink();
    if (typeof level === 'number') {
      const pct = clamp(Math.round(level), 0, 100);
      await run('pactl', ['set-sink-volume', sink, `${pct}%`]);
      if (pct > 0) await run('pactl', ['set-sink-mute', sink, '0']);
    }
    if (typeof mute === 'boolean') {
      await run('pactl', ['set-sink-mute', sink, mute ? '1' : '0']);
    }
    this.state.volumePercent = await this._readSinkVolume(sink);
    this.state.muted = await this._readSinkMuted(sink);
    return { level: this.state.volumePercent, muted: this.state.muted };
  }

  async setMicMute(mute) {
    if (this.mockExec) {
      this.state.micMuted = !!mute;
      this.logger.info('mockExec: mic mute set', { micMuted: this.state.micMuted });
      return { muted: this.state.micMuted };
    }
    // wpctl's @DEFAULT_AUDIO_SOURCE@ alias depends on WirePlumber's
    // default-nodes-api metadata, which (confirmed on this machine) can
    // fail to resolve ("'-1' is not a valid ID") even when a real input
    // device exists — PipeWire/pactl's own default-source resolution is
    // more reliable in practice, so use `pactl ... @DEFAULT_SOURCE@`
    // instead, matching the same pactl-based approach already used for
    // output volume above.
    await run('pactl', ['set-source-mute', '@DEFAULT_SOURCE@', mute ? '1' : '0']);
    this.state.micMuted = !!mute;
    return { muted: this.state.micMuted };
  }

  async mediaControl(action) {
    if (this.mockExec) {
      // Mirrors MediaController's mock behavior so the mock/live toggle
      // feels the same during dev regardless of which controller is active.
      switch (action) {
        case 'play':
          this.nowPlaying.is_playing = true;
          break;
        case 'pause':
        case 'stop':
          this.nowPlaying.is_playing = false;
          if (action === 'stop') this.nowPlaying.position_ms = 0;
          break;
        case 'toggle':
          this.nowPlaying.is_playing = !this.nowPlaying.is_playing;
          break;
        case 'next':
        case 'previous':
          break; // no mock track list here; live path is what actually matters on Linux
        default:
          throw new Error(`Unknown media action: ${action}`);
      }
      this.logger.info('mockExec: media control', { action, nowPlaying: this.nowPlaying });
      this._emitNowPlaying();
      return { accepted: true };
    }

    const PLAYERCTL_ACTION = { play: 'play', pause: 'pause', stop: 'stop', toggle: 'play-pause', next: 'next', previous: 'previous' };
    const mapped = PLAYERCTL_ACTION[action];
    if (!mapped) throw new Error(`Unknown media action: ${action}`);
    await run('playerctl', [mapped]); // throws cleanly (ENOENT / "No players found") — surfaced as a normal failed command, not a crash
    await this._pollNowPlaying();
    return { accepted: true };
  }

  async _pollNowPlaying() {
    let next;
    try {
      const status = (await run('playerctl', ['status'])).trim();
      const raw = await run('playerctl', [
        'metadata',
        '--format',
        '{{playerName}}\x1f{{title}}\x1f{{artist}}\x1f{{mpris:length}}\x1f{{position}}\x1f{{mpris:artUrl}}\x1f{{xesam:url}}',
      ]);
      const [app, title, artist, lengthUs, posUs, rawArtUrl, mediaUrl] = raw.trim().split('\x1f');
      // Remote HTTPS artwork (Spotify, browser players, etc.) can be loaded
      // directly by the tablet. Do not expose file:// paths from the PC.
      const albumArtUrl = youtubeArtwork(mediaUrl) || await resolveArtwork(rawArtUrl);
      next = {
        app: app || 'Media',
        title: title || '',
        artist: artist || '',
        is_playing: status === 'Playing',
        position_ms: Math.round(Number(posUs || 0) / 1000),
        duration_ms: Math.round(Number(lengthUs || 0) / 1000),
        album_art_url: albumArtUrl,
      };
    } catch (_) {
      // playerctl missing, or no active MPRIS player — legitimate "nothing
      // playing" state, not an error worth logging on every 1.5s poll.
      next = { ...EMPTY_NOW_PLAYING };
    }
    const prev = this.nowPlaying;
    // Deliberately excludes position_ms from the comparison — per
    // architecture-security.md §1.3, now_playing_update is pushed "on
    // media session change (track/app/play-state change), not polled";
    // firing on every position tick would violate that.
    const changed = prev.app !== next.app || prev.title !== next.title || prev.artist !== next.artist ||
      prev.is_playing !== next.is_playing || prev.album_art_url !== next.album_art_url;
    this.nowPlaying = next;
    if (changed) this._emitNowPlaying();
  }

  getNowPlaying() {
    return { ...this.nowPlaying };
  }

  getAudioStatus() {
    return {
      volume_percent: this.state.volumePercent,
      muted: this.state.muted,
      mic_muted: this.state.micMuted,
    };
  }
}

module.exports = { MediaController, LinuxMediaController };
