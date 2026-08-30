// frontend/src/components/feedback.js
//
// Haptic (navigator.vibrate) + sound (WebAudio-synthesized click, no audio
// file assets) feedback. Both are feature-detected and both respect the
// Settings toggles. Never fired on plain navigation — only press/success/
// failure per the task brief.

import { getSettings } from "../state/store.js";

let audioCtx = null;
function ctx() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
  }
  return audioCtx;
}

function playClick(freq = 880, durationMs = 30, gain = 0.05) {
  const c = ctx();
  if (!c) return;
  if (c.state === "suspended") c.resume().catch(() => {});
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = "square";
  osc.frequency.value = freq;
  g.gain.value = gain;
  osc.connect(g).connect(c.destination);
  const now = c.currentTime;
  g.gain.setValueAtTime(gain, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
  osc.start(now);
  osc.stop(now + durationMs / 1000 + 0.01);
}

export function hapticPress() {
  const s = getSettings();
  if (s.haptics && navigator.vibrate) navigator.vibrate(10);
  if (s.sound) playClick(700, 18, 0.04);
}
export function hapticSuccess() {
  const s = getSettings();
  if (s.haptics && navigator.vibrate) navigator.vibrate([12, 40, 12]);
  if (s.sound) playClick(1100, 60, 0.05);
}
export function hapticFailure() {
  const s = getSettings();
  if (s.haptics && navigator.vibrate) navigator.vibrate([30, 40, 30]);
  if (s.sound) playClick(220, 120, 0.06);
}

/** Attach press haptic/sound to any element without affecting its other listeners. */
export function wirePressFeedback(el) {
  el.addEventListener("pointerdown", () => hapticPress(), { passive: true });
}
