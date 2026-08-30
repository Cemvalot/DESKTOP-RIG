// frontend/src/components/statusStrip.js — top status strip (design-system.md §15.1).
// PC name (left), clock (center), connection + GPU temp + settings gear (right).
// Tapping the connection badge deep-links to the System screen (§9).

import { el, fmtClock } from "./dom.js";
import { iconMarkup } from "./icons.js";

export function createStatusStrip({ onOpenSettings, onGoToSystem }) {
  const dot = el("span", { class: "dot" });
  const pcNameText = el("span", {}, "DESKTOP-RIG");
  const clockEl = el("span", { class: "clock" }, fmtClock());
  const connIcon = el("span", { html: iconMarkup("wifi") });
  const connText = el("span", {}, "Connected");
  const gpuTempEl = el("span", { class: "mono" }, "");

  const connBadge = el(
    "button",
    { class: "conn-badge", onclick: onGoToSystem },
    [connIcon, connText, gpuTempEl]
  );

  const gearBtn = el("button", { class: "gear-btn", "aria-label": "Settings", onclick: onOpenSettings, html: iconMarkup("gear") });

  const strip = el("div", { class: "status-strip" }, [
    el("div", { class: "pc-name" }, [dot, pcNameText]),
    clockEl,
    el("div", { class: "right-cluster" }, [connBadge, gearBtn]),
  ]);

  setInterval(() => {
    clockEl.textContent = fmtClock();
  }, 1000);

  function setPcName(name) {
    pcNameText.textContent = name;
  }
  function setConnection(state) {
    dot.className = `dot ${state === "connected" ? "" : state}`;
    connIcon.innerHTML = state === "offline" ? iconMarkup("wifi-off") : iconMarkup("wifi");
    connText.textContent = state === "connected" ? "Connected" : state === "reconnecting" ? "Reconnecting…" : "Offline";
  }
  function setGpuTemp(celsius) {
    gpuTempEl.textContent = celsius == null ? "" : ` ${Math.round(celsius)}°C GPU`;
  }

  return { el: strip, setPcName, setConnection, setGpuTemp };
}
