// frontend/src/components/idleScreen.js
// Idle/screensaver screen (design-system.md §13, §15.9): full --bg-0 canvas,
// large clock, date, PC name, position drift every 2 min (instant jump, no
// tween) as cheap LCD image-retention insurance, connection dot bottom-right.
// Default 15-minute idle timeout; any tap instantly returns to the last tab.

import { el, getLayer, fmtClock, fmtDate } from "./dom.js";

const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const DRIFT_INTERVAL_MS = 2 * 60 * 1000;

export function createIdleScreen({ pcName = "PC", onDismiss }) {
  const clockEl = el("div", { class: "clock mono" }, fmtClock());
  const dateEl = el("div", { class: "date" }, fmtDate());
  const pcNameEl = el("div", { class: "pcname" }, pcName);
  const dot = el("div", { class: "idle-dot" });

  const clockBlock = el("div", { class: "idle-clock-block" }, [clockEl, dateEl, pcNameEl]);
  const screen = el("div", { class: "idle-screen" }, [clockBlock, dot]);
  getLayer("overlay-root").appendChild(screen);

  let clockTimer = null;
  let driftTimer = null;
  let idleTimer = null;
  let visible = false;

  function centerDrift() {
    clockBlock.style.top = "50%";
    clockBlock.style.left = "50%";
    clockBlock.style.transform = "translate(-50%, -50%)";
  }
  centerDrift();

  function applyDrift() {
    const dx = Math.round((Math.random() - 0.5) * 80); // ±40px
    const dy = Math.round((Math.random() - 0.5) * 48); // ±24px
    clockBlock.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  function show() {
    if (visible) return;
    visible = true;
    clockEl.textContent = fmtClock();
    dateEl.textContent = fmtDate();
    centerDrift();
    screen.classList.add("in");
    clockTimer = setInterval(() => (clockEl.textContent = fmtClock()), 1000);
    driftTimer = setInterval(applyDrift, DRIFT_INTERVAL_MS);
  }
  function hide() {
    if (!visible) return;
    visible = false;
    screen.classList.remove("in");
    clearInterval(clockTimer);
    clearInterval(driftTimer);
  }

  screen.addEventListener("pointerdown", () => {
    hide();
    if (onDismiss) onDismiss();
  });

  function resetIdleTimer() {
    clearTimeout(idleTimer);
    if (visible) return; // don't re-arm while showing; a tap already dismissed it
    idleTimer = setTimeout(show, IDLE_TIMEOUT_MS);
  }

  function setPcName(name) {
    pcNameEl.textContent = name;
  }

  // Any interaction anywhere in the app resets the idle clock.
  for (const type of ["pointerdown", "pointermove", "keydown"]) {
    document.addEventListener(type, resetIdleTimer, { passive: true });
  }
  resetIdleTimer();

  return { el: screen, isVisible: () => visible, setPcName, resetIdleTimer };
}
