// frontend/src/screens/desktop.js — Desktop screen (design-system.md
// §15.4.1). A virtual keyboard + a small trackpad for controlling the PC's
// mouse (docs/architecture-security.md §11). No screen mirror — this is
// input-only, on purpose.
//
// Keyboard: printable characters (letters/digits/punctuation/space) are
// sent as literal text via sendKeyboardInput({action:'type', text}) — the
// server resolves the actual keystrokes (including shift) via `ydotool
// type`, so this file never needs to know a keycode. Shift here is purely a
// client-side display toggle that decides which glyph gets sent for a given
// key, not something sent to the server as its own keypress. Non-printable
// keys (Enter, Backspace, Tab, Escape, arrows) go through
// {action:'key', key: 'Enter'} against the server's fixed allowlist.
//
// Trackpad: identical gesture handling to the original virtual-desktop
// panel design (one-finger drag = move, one-finger tap = left-click,
// two-finger tap = right-click, two-finger drag = scroll) but the surface
// itself is small and has no image behind it — this tab is deliberately
// "control only," never "watch the screen."

import { el } from "../components/dom.js";
import { showToast } from "../components/toast.js";
import { hapticPress } from "../components/feedback.js";

const TRACKPAD_TAP_MOVE_PX = 14;
const TRACKPAD_TAP_MS = 350;

const ROW1 = [
  ["1", "!"], ["2", "@"], ["3", "#"], ["4", "$"], ["5", "%"],
  ["6", "^"], ["7", "&"], ["8", "*"], ["9", "("], ["0", ")"],
];
const ROW2 = ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"];
const ROW3 = ["a", "s", "d", "f", "g", "h", "j", "k", "l"];
const ROW4 = [["z"], ["x"], ["c"], ["v"], ["b"], ["n"], ["m"], [",", "<"], [".", ">"]];

export function mount(container, ctx) {
  const { provider } = ctx;
  let shiftOn = false;
  const charButtons = []; // { btn, lower, upper }

  function sendChar(ch) {
    hapticPress();
    provider.sendKeyboardInput({ action: "type", text: ch });
  }
  function sendKey(keyName) {
    hapticPress();
    provider.sendKeyboardInput({ action: "key", key: keyName });
  }

  function charKey(lower, upper = lower.toUpperCase()) {
    const btn = el("button", { class: "vk-key press-scale", onclick: () => sendChar(shiftOn ? upper : lower) }, lower);
    charButtons.push({ btn, lower, upper });
    return btn;
  }

  const shiftBtn = el("button", { class: "vk-key vk-special vk-wide press-scale", "aria-pressed": "false" }, "Shift");
  shiftBtn.addEventListener("click", () => {
    shiftOn = !shiftOn;
    shiftBtn.classList.toggle("active", shiftOn);
    shiftBtn.setAttribute("aria-pressed", String(shiftOn));
    for (const { btn, lower, upper } of charButtons) btn.textContent = shiftOn ? upper : lower;
  });

  const spaceBtn = el("button", { class: "vk-key vk-space press-scale" }, "Space");
  spaceBtn.addEventListener("click", () => sendChar(" "));

  function namedKey(label, keyName, extraClass = "") {
    const btn = el("button", { class: `vk-key vk-special press-scale ${extraClass}` }, label);
    btn.addEventListener("click", () => sendKey(keyName));
    return btn;
  }

  const row1 = el("div", { class: "vk-row" }, [...ROW1.map(([lo, up]) => charKey(lo, up)), namedKey("⌫", "Backspace", "vk-wide")]);
  const row2 = el("div", { class: "vk-row" }, [namedKey("Tab", "Tab", "vk-wide"), ...ROW2.map((c) => charKey(c))]);
  const row3 = el("div", { class: "vk-row" }, [...ROW3.map((c) => charKey(c)), namedKey("Enter", "Enter", "vk-wide")]);
  const row4 = el("div", { class: "vk-row" }, [shiftBtn, ...ROW4.map(([lo, up]) => charKey(lo, up))]);
  const row5 = el("div", { class: "vk-row" }, [
    namedKey("Esc", "Escape"),
    spaceBtn,
    namedKey("←", "ArrowLeft"),
    namedKey("↑", "ArrowUp"),
    namedKey("↓", "ArrowDown"),
    namedKey("→", "ArrowRight"),
  ]);

  const keyboardPanel = el("div", { class: "panel panel-pad keyboard-panel" }, [
    el("h3", { class: "panel-title" }, "Virtual Keyboard"),
    el("div", { class: "vk-rows" }, [row1, row2, row3, row4, row5]),
  ]);

  // ── Small trackpad ────────────────────────────────────────────────────
  const hint = el("div", { class: "trackpad-hint" }, "Drag to move · tap to click");
  const surface = el("div", { class: "trackpad-surface-small", "aria-label": "Trackpad — controls the PC's mouse" }, [hint]);
  const clickRow = el("div", { class: "trackpad-btn-row" }, [
    el("button", { class: "btn-action press-scale trackpad-btn", onclick: () => sendClick("left") }, "Left"),
    el("button", { class: "btn-action press-scale trackpad-btn", onclick: () => sendClick("right") }, "Right"),
  ]);
  const trackpadPanel = el("div", { class: "panel panel-pad trackpad-panel" }, [
    el("h3", { class: "panel-title" }, "Trackpad"),
    surface,
    clickRow,
  ]);

  function sendClick(button) {
    hapticPress();
    provider.sendPointerInput({ action: "click", button });
  }

  const pointers = new Map(); // pointerId -> {x, y}
  let gesture = null; // { startTime, totalMove, maxTouches }

  surface.addEventListener("pointerdown", (e) => {
    surface.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!gesture) gesture = { startTime: Date.now(), totalMove: 0, maxTouches: 0 };
    gesture.maxTouches = Math.max(gesture.maxTouches, pointers.size);
    hint.classList.add("hidden");
  });
  surface.addEventListener("pointermove", (e) => {
    const p = pointers.get(e.pointerId);
    if (!p || !gesture) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    gesture.totalMove += Math.abs(dx) + Math.abs(dy);
    // Two-finger drag would map to scroll, but the server's scroll action is
    // a documented TODO (ydotool has no verified wheel support yet — see
    // server/README.md) — deliberately not calling it here so a two-finger
    // drag just does nothing instead of surfacing a "not implemented" error
    // toast on an otherwise-ordinary gesture. Two-finger *tap* still works
    // (right-click, handled in endPointer below) since that hits `click`,
    // which is real.
    if (pointers.size === 1) {
      provider.sendPointerInput({ action: "move", dx, dy });
    }
  });
  function endPointer(e) {
    if (!pointers.delete(e.pointerId) || !gesture) return;
    if (pointers.size === 0) {
      const elapsed = Date.now() - gesture.startTime;
      const isTap = gesture.totalMove < TRACKPAD_TAP_MOVE_PX && elapsed < TRACKPAD_TAP_MS;
      if (isTap) sendClick(gesture.maxTouches >= 2 ? "right" : "left");
      gesture = null;
    }
  }
  surface.addEventListener("pointerup", endPointer);
  surface.addEventListener("pointercancel", endPointer);

  // ── Errors (shared by keyboard + trackpad) ──────────────────────────────
  let lastErrorToastAt = 0;
  provider.subscribeDesktopError((err) => {
    const now = Date.now();
    if (now - lastErrorToastAt < 5000) return;
    lastErrorToastAt = now;
    showToast({ type: "error", message: err.message || "Remote input unavailable." });
  });

  container.appendChild(el("div", { class: "screen-inner" }, [keyboardPanel, trackpadPanel]));

  return { destroy() {} };
}
