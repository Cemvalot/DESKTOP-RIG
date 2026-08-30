// frontend/src/components/connectionOverlay.js
// Full-screen connection-lost/reconnecting overlay (design-system.md §15.8).

import { el, getLayer } from "./dom.js";
import { showToast } from "./toast.js";

export function createConnectionOverlay({ pcName = "the PC", onRetry }) {
  let lastConnectedAt = null;
  let tickTimer = null;

  const subEl = el("div", { class: "sub" }, `Last connected —`);
  const overlay = el("div", { class: "reconnect-overlay", "data-visible": "false" }, [
    el("div", { class: "reconnect-ring" }),
    el("h2", {}, `Reconnecting to ${pcName}…`),
    subEl,
    el("button", { class: "retry-btn press-scale", onclick: () => onRetry && onRetry() }, "Retry Now"),
  ]);
  overlay.style.display = "none";
  getLayer("overlay-root").appendChild(overlay);

  function updateSub() {
    if (!lastConnectedAt) {
      subEl.textContent = "Never connected";
      return;
    }
    const secs = Math.max(0, Math.round((Date.now() - lastConnectedAt) / 1000));
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    subEl.textContent = `Last connected ${m}:${String(s).padStart(2, "0")} ago`;
  }

  function show() {
    overlay.style.display = "flex";
    clearInterval(tickTimer);
    tickTimer = setInterval(updateSub, 1000);
    updateSub();
  }
  function hide(showReconnectedBadge = false) {
    overlay.style.display = "none";
    clearInterval(tickTimer);
    if (showReconnectedBadge) {
      showToast({ type: "success", message: "Reconnected", timeoutMs: 1500 });
    }
  }

  function setState(state, lastConnected) {
    if (lastConnected) lastConnectedAt = new Date(lastConnected).getTime();
    if (state === "reconnecting" || state === "offline") show();
    else if (state === "connected") hide(overlay.style.display !== "none");
  }

  return { el: overlay, setState };
}
