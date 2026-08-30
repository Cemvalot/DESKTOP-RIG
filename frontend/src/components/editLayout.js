// frontend/src/components/editLayout.js
//
// "Edit Layout" mode for the Home/Gaming tile grids: entered via long-press
// on a tile (or a Settings toggle), then native HTML5 drag-and-drop
// reorders tiles within the grid. On exit, the new order is persisted to
// localStorage scoped to the active profile (see state/store.js).

import { setLayout } from "../state/store.js";
import { hapticPress } from "./feedback.js";

const LONG_PRESS_MS = 500;

/**
 * @param {HTMLElement} container grid element whose direct children are the tiles
 * @param {{profileId: string, screenKey: string, onReorder?: (ids: string[]) => void}} opts
 */
export function makeGridEditable(container, { profileId, screenKey, onReorder }) {
  let editing = false;
  let pressTimer = null;
  let dragSrc = null;

  function currentOrder() {
    return Array.from(container.children).map((c) => c.dataset.id);
  }

  function persist() {
    const order = currentOrder();
    setLayout(profileId, screenKey, order);
    if (onReorder) onReorder(order);
  }

  function enterEdit() {
    if (editing) return;
    editing = true;
    container.classList.add("editing");
    hapticPress();
    for (const child of container.children) {
      child.draggable = true;
      child.classList.add("editable");
    }
  }

  function exitEdit() {
    if (!editing) return;
    editing = false;
    container.classList.remove("editing");
    for (const child of container.children) {
      child.draggable = false;
      child.classList.remove("editable", "dragging", "drag-over");
    }
    persist();
  }

  function isEditing() {
    return editing;
  }

  // Long-press to enter edit mode.
  container.addEventListener("pointerdown", (e) => {
    const tile = e.target.closest("[data-id]");
    if (!tile || editing) return;
    pressTimer = setTimeout(enterEdit, LONG_PRESS_MS);
  });
  const cancelPress = () => clearTimeout(pressTimer);
  container.addEventListener("pointerup", cancelPress);
  container.addEventListener("pointerleave", cancelPress);
  container.addEventListener("pointermove", cancelPress);

  // Drag reorder (only active once `editing`).
  container.addEventListener("dragstart", (e) => {
    if (!editing) return e.preventDefault();
    dragSrc = e.target.closest("[data-id]");
    if (dragSrc) dragSrc.classList.add("dragging");
  });
  container.addEventListener("dragend", () => {
    if (dragSrc) dragSrc.classList.remove("dragging");
    for (const c of container.children) c.classList.remove("drag-over");
    dragSrc = null;
  });
  container.addEventListener("dragover", (e) => {
    if (!editing) return;
    e.preventDefault();
    const target = e.target.closest("[data-id]");
    if (!target || target === dragSrc) return;
    for (const c of container.children) c.classList.remove("drag-over");
    target.classList.add("drag-over");
  });
  container.addEventListener("drop", (e) => {
    if (!editing) return;
    e.preventDefault();
    const target = e.target.closest("[data-id]");
    target && target.classList.remove("drag-over");
    if (!target || !dragSrc || target === dragSrc) return;
    const children = Array.from(container.children);
    const srcIdx = children.indexOf(dragSrc);
    const tgtIdx = children.indexOf(target);
    if (srcIdx < tgtIdx) target.after(dragSrc);
    else target.before(dragSrc);
  });

  return { enterEdit, exitEdit, isEditing, currentOrder };
}
