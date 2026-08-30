// frontend/src/components/dom.js — tiny DOM helpers, no framework.

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, "");
    else if (v === false || v === null || v === undefined) continue;
    else node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined) continue;
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

/** Returns (creating if needed) a fixed overlay layer appended to #app. */
export function getLayer(id) {
  let layer = document.getElementById(id);
  if (!layer) {
    layer = document.createElement("div");
    layer.id = id;
    document.getElementById("app").appendChild(layer);
  }
  return layer;
}

export function fmtClock(date = new Date()) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}
export function fmtDate(date = new Date()) {
  return date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}
export function fmtDuration(ms) {
  if (ms == null || Number.isNaN(ms)) return "--:--";
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
