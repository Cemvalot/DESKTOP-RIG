// frontend/src/components/statusCard.js — small telemetry readout card.

import { el } from "./dom.js";
import { iconMarkup } from "./icons.js";

/**
 * @param {{icon: string, label: string, value: string, sub?: string, level?: 'ok'|'warn'|'danger'}} opts
 */
export function createStatusCard({ icon, label, value, sub = "", level = "ok" }) {
  const cls = level === "warn" ? "warn" : level === "danger" ? "danger" : "";
  const card = el("div", { class: `status-card ${cls}` }, [
    el("div", { html: iconMarkup(icon) }),
    el("div", {}, [
      el("div", { class: "value mono" }, value),
      el("div", { class: "sub" }, sub || label),
    ]),
  ]);
  card.dataset.field = label;
  return card;
}

export function updateStatusCard(card, value, sub) {
  const valueEl = card.querySelector(".value");
  const subEl = card.querySelector(".sub");
  if (valueEl && value != null) valueEl.textContent = value;
  if (subEl && sub != null) subEl.textContent = sub;
}

export function fmtPercent(v) {
  return v == null || Number.isNaN(v) ? "—" : `${Math.round(v)}%`;
}
export function fmtTemp(v) {
  return v == null || Number.isNaN(v) ? "—" : `${Math.round(v * 10) / 10}°C`;
}
