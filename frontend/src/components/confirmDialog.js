// frontend/src/components/confirmDialog.js
//
// Client-side confirmation dialog for every `dangerous: true` command, per
// design-system.md §15.7: cancel is large/left/default, the danger action
// is small/right/red, no swipe or double-tap shortcuts. This is UX only —
// the real gate is the server's two-step confirm flow (architecture-
// security.md §5), which callers must still drive with the token returned
// here.

import { el, getLayer } from "./dom.js";
import { iconMarkup } from "./icons.js";
import { hapticPress } from "./feedback.js";

/**
 * @param {{title: string, body: string, confirmLabel?: string, dangerIcon?: string, countdownSeconds?: number}} opts
 * @returns {Promise<boolean>} resolves true if confirmed, false if cancelled/dismissed
 */
export function showConfirmDialog({ title, body, confirmLabel = "Confirm", dangerIcon = "alert-triangle", countdownSeconds = null }) {
  return new Promise((resolve) => {
    const backdrop = el("div", { class: "overlay-backdrop" });
    const countdownEl = countdownSeconds
      ? el("div", { class: "dialog-countdown" }, `Expires in ${countdownSeconds}s`)
      : null;

    let remaining = countdownSeconds;
    let timer = null;

    const dialog = el("div", { class: "dialog", role: "alertdialog", "aria-modal": "true" }, [
      el("h2", { class: "dialog-title", html: `${iconMarkup(dangerIcon)}<span>${title}</span>` }),
      el("p", { class: "dialog-body" }, body),
      ...(countdownEl ? [countdownEl] : []),
      el("div", { class: "dialog-actions" }, [
        el(
          "button",
          {
            class: "btn-cancel press-scale",
            onclick: () => close(false),
          },
          "Cancel"
        ),
        el("button", {
          class: "btn-confirm-danger btn-danger press-scale",
          onclick: () => close(true),
          html: `${iconMarkup("power")}<span>${confirmLabel}</span>`,
        }),
      ]),
    ]);

    backdrop.appendChild(dialog);
    getLayer("overlay-root").appendChild(backdrop);
    requestAnimationFrame(() => backdrop.classList.add("in"));

    if (countdownSeconds) {
      timer = setInterval(() => {
        remaining -= 1;
        if (countdownEl) countdownEl.textContent = `Expires in ${Math.max(remaining, 0)}s`;
        if (remaining <= 0) close(false);
      }, 1000);
    }

    function close(result) {
      hapticPress();
      clearInterval(timer);
      backdrop.classList.remove("in");
      setTimeout(() => backdrop.remove(), 200);
      resolve(result);
    }

    // Backdrop tap = cancel (no accidental confirm from a stray tap outside).
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) close(false);
    });
  });
}
