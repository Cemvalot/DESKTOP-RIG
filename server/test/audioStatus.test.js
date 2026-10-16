'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { LinuxMediaController } = require('../src/commands/media');

const logger = { info() {}, warn() {}, error() {} };

test('live audio status follows changes made outside Launchpad', async () => {
  // Construct in mock mode to avoid starting the media polling timer, then
  // exercise the live audio path with deterministic PipeWire/Pulse readers.
  const controller = new LinuxMediaController({ mockExec: true, logger });
  controller.mockExec = false;
  controller._resolveSink = async () => 'test-sink';

  let live = { volume: 50, muted: false, micMuted: false };
  controller._readSinkVolume = async (sink) => {
    assert.equal(sink, 'test-sink');
    return live.volume;
  };
  controller._readSinkMuted = async () => live.muted;
  controller._readSourceMuted = async () => live.micMuted;

  assert.deepEqual(await controller.getAudioStatus(), {
    volume_percent: 50,
    muted: false,
    mic_muted: false,
  });

  live = { volume: 27, muted: true, micMuted: true };
  assert.deepEqual(await controller.getAudioStatus(), {
    volume_percent: 27,
    muted: true,
    mic_muted: true,
  });
});

test('overlapping status snapshots share one live audio read', async () => {
  const controller = new LinuxMediaController({ mockExec: true, logger });
  controller.mockExec = false;

  let reads = 0;
  let release;
  controller._refreshAudioStatus = () => {
    reads += 1;
    return new Promise((resolve) => {
      release = () => resolve({ volume_percent: 50, muted: false, mic_muted: false });
    });
  };

  const first = controller.getAudioStatus();
  const second = controller.getAudioStatus();
  assert.equal(reads, 1);
  assert.equal(first, second);
  release();
  await first;

  const third = controller.getAudioStatus();
  assert.equal(reads, 2);
  release();
  await third;
});
