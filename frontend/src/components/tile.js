// frontend/src/components/tile.js — reusable launch tile / action button.

import { el } from "./dom.js";
import { iconMarkup } from "./icons.js";

/**
 * @param {{id: string, label: string, icon: string, size?: 'lg'|'sm', favorite?: boolean,
 *   disabled?: boolean, onClick?: () => void, editable?: boolean}} opts
 */
export function createTile({ id, label, icon, size = "lg", favorite = false, disabled = false, onClick, editable = false }) {
  const classes = ["tile", "press-scale"];
  if (size === "sm") classes.push("tile-sm");
  if (favorite) classes.push("favorite-badge");

  const tile = el(
    "button",
    {
      class: classes.join(" "),
      "data-id": id,
      disabled: disabled || undefined,
      onclick: disabled ? null : onClick,
      html: `${iconMarkup(icon)}<span class="tile-label">${label}</span>${favorite ? iconMarkup("star", "fav-star") : ""}${editable ? iconMarkup("drag", "drag-handle") : ""}`,
    },
    []
  );
  return tile;
}

export function createActionButton({ id, label, icon, primary = false, disabled = false, onClick }) {
  const classes = ["btn-action", "press-scale"];
  if (primary) classes.push("primary");
  return el("button", {
    class: classes.join(" "),
    "data-id": id,
    disabled: disabled || undefined,
    onclick: disabled ? null : onClick,
    html: `${iconMarkup(icon)}${label ? `<span class="tile-label">${label}</span>` : ""}`,
  });
}

export function createIconButton({ id, icon, onClick, disabled = false, extraClass = "" }) {
  return el("button", {
    class: `btn-icon-compact press-scale ${extraClass}`,
    "data-id": id,
    disabled: disabled || undefined,
    onclick: disabled ? null : onClick,
    html: iconMarkup(icon),
  });
}

export function createChip({ id, label, icon = null, active = false, disabled = false, onClick }) {
  return el("button", {
    class: `chip press-scale ${active ? "active" : ""}`,
    "data-id": id,
    disabled: disabled || undefined,
    onclick: disabled ? null : onClick,
    html: `${icon ? iconMarkup(icon) : ""}<span>${label}</span>`,
  });
}
