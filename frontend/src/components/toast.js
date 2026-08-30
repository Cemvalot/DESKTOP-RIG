// frontend/src/components/toast.js — small notification stack, top-right
// of the content area. Used for command success/failure, reconnection, etc.

import { el, getLayer } from "./dom.js";
import { iconMarkup } from "./icons.js";

function stack() {
  let s = document.getElementById("toast-stack");
  if (!s) {
    s = el("div", { id: "toast-stack", class: "toast-stack" });
    getLayer("overlay-root").appendChild(s);
  }
  return s;
}

/**
 * @param {{type?: 'info'|'success'|'error', message: string, timeoutMs?: number}} opts
 */
export function showToast({ type = "info", message, timeoutMs = 3200 }) {
  const iconName = type === "success" ? "check" : type === "error" ? "alert-triangle" : "clock-history";
  const node = el("div", { class: `toast ${type}`, html: `${iconMarkup(iconName)}<span>${message}</span>` });
  stack().appendChild(node);
  requestAnimationFrame(() => node.classList.add("in"));
  const remove = () => {
    node.classList.remove("in");
    setTimeout(() => node.remove(), 200);
  };
  setTimeout(remove, timeoutMs);
  node.addEventListener("click", remove);
}
