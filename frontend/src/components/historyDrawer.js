// frontend/src/components/historyDrawer.js
// Small command-history drawer (not a full screen) — last few executed
// commands, sourced from provider.getCommandHistory().

import { el, getLayer } from "./dom.js";

export function createHistoryDrawer({ provider }) {
  const list = el("div", {});
  const drawer = el("div", { class: "history-drawer" }, [el("h3", { class: "panel-title" }, "Recent Commands"), list]);
  getLayer("overlay-root").appendChild(drawer);

  async function refresh() {
    list.innerHTML = "";
    let items = [];
    try {
      items = await provider.getCommandHistory();
    } catch (_) {
      /* history is a convenience, fail quietly */
    }
    if (!items.length) {
      list.appendChild(el("div", { class: "history-row" }, "No commands yet."));
      return;
    }
    for (const item of items.slice(0, 8)) {
      const resultClass = `result-${item.result || item.status || "pending"}`;
      list.appendChild(
        el("div", { class: "history-row" }, [
          // Server's real field is target_id (server/src/routes/commands.js);
          // item.target kept as a fallback for the mock provider's own shape.
          el("span", {}, item.type + (item.target_id || item.target ? `: ${item.target_id || item.target}` : "")),
          el("span", { class: resultClass }, item.result || item.status || "…"),
        ])
      );
    }
  }

  let open = false;
  function toggle() {
    open = !open;
    drawer.classList.toggle("in", open);
    if (open) refresh();
  }
  function close() {
    open = false;
    drawer.classList.remove("in");
  }

  return { el: drawer, toggle, close, refresh };
}
