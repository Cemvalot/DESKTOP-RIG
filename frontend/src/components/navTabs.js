// frontend/src/components/navTabs.js — persistent bottom tab bar (5 fixed tabs).

import { el } from "./dom.js";
import { iconMarkup } from "./icons.js";
import { hapticPress } from "./feedback.js";

export const TABS = [
  { id: "home", label: "Home", icon: "home" },
  { id: "gaming", label: "Gaming", icon: "controller" },
  { id: "media", label: "Media", icon: "video" },
  { id: "system", label: "System", icon: "cpu" },
  { id: "smarthome", label: "Smart Home", icon: "lightbulb" },
];

/**
 * @param {(tabId: string) => void} onSelect
 */
export function createTabBar(onSelect) {
  const bar = el("nav", { class: "tab-bar", role: "tablist" });
  const items = {};
  for (const t of TABS) {
    const item = el(
      "button",
      {
        class: "tab-item press-scale",
        role: "tab",
        "data-tab": t.id,
        onclick: () => {
          hapticPress();
          onSelect(t.id);
        },
        html: `${iconMarkup(t.icon)}<span class="tab-label">${t.label}</span>`,
      },
      []
    );
    items[t.id] = item;
    bar.appendChild(item);
  }

  function setActive(tabId) {
    for (const [id, node] of Object.entries(items)) {
      node.classList.toggle("active", id === tabId);
      node.setAttribute("aria-selected", id === tabId ? "true" : "false");
    }
  }

  return { el: bar, setActive };
}
