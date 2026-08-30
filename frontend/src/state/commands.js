// frontend/src/state/commands.js
//
// Orchestrates the full command lifecycle for every screen: calls the
// active provider's executeCommand(), drives the client confirmation
// dialog + the server's two-step confirm flow for dangerous commands
// (architecture-security.md §5), correlates the async `command_result`
// push back to the id returned by execute/confirm, and applies the
// loading/success/failure visual + haptic/sound feedback states from
// design-system.md §11. Screens call `runCommand()` — they never touch
// the provider or the confirm dialog directly.

import { getProvider, ProviderError } from "../data/index.js";
import { showConfirmDialog } from "../components/confirmDialog.js";
import { showToast } from "../components/toast.js";
import { hapticPress, hapticSuccess, hapticFailure } from "../components/feedback.js";

const pending = new Map(); // command_id -> { resolve }
let wired = false;

function ensureWired() {
  if (wired) return;
  wired = true;
  getProvider().subscribeCommandResult((result) => {
    const waiter = pending.get(result.command_id);
    if (waiter) {
      pending.delete(result.command_id);
      waiter.resolve(result);
    }
  });
}

function waitForResult(id, timeoutMs = 6000) {
  return new Promise((resolve) => {
    pending.set(id, { resolve });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        resolve({ command_id: id, status: "success", message: null, _timedOut: true });
      }
    }, timeoutMs);
  });
}

function setTileState(tileEl, state) {
  if (!tileEl) return;
  tileEl.classList.remove("state-loading", "state-success", "state-failure");
  if (state) tileEl.classList.add(state);
  if (state === "state-success" || state === "state-failure") {
    setTimeout(() => tileEl.classList.remove(state), 700);
  }
}

/**
 * @param {object} cmd one of the abstract command shapes (see provider.js)
 * @param {{tileEl?: HTMLElement, dangerousTitle?: string, dangerousBody?: string, successMessage?: string, silent?: boolean}} opts
 * @returns {Promise<'success'|'error'|'cancelled'>}
 */
export async function runCommand(cmd, opts = {}) {
  ensureWired();
  const provider = getProvider();
  hapticPress();
  setTileState(opts.tileEl, "state-loading");

  let res;
  try {
    res = await provider.executeCommand(cmd);
  } catch (err) {
    setTileState(opts.tileEl, "state-failure");
    hapticFailure();
    showToast({ type: "error", message: describeError(err) });
    return "error";
  }

  if (res.status === "confirmation_required") {
    setTileState(opts.tileEl, null);
    const confirmed = await showConfirmDialog({
      title: opts.dangerousTitle || res.command_summary || "Are you sure?",
      body: opts.dangerousBody || "This action cannot be undone.",
      confirmLabel: opts.confirmLabel || "Confirm",
      countdownSeconds: res.expires_in_seconds || null,
    });
    if (!confirmed) return "cancelled";

    setTileState(opts.tileEl, "state-loading");
    let confirmRes;
    try {
      confirmRes = await provider.confirmCommand(res.confirm_token);
    } catch (err) {
      setTileState(opts.tileEl, "state-failure");
      hapticFailure();
      showToast({ type: "error", message: describeError(err) });
      return "error";
    }
    return awaitAndReport(confirmRes.id, opts);
  }

  return awaitAndReport(res.id, opts);
}

async function awaitAndReport(id, opts) {
  const result = await waitForResult(id);
  if (result.status === "success") {
    setTileState(opts.tileEl, "state-success");
    hapticSuccess();
    if (opts.successMessage && !opts.silent) showToast({ type: "success", message: opts.successMessage });
  } else {
    setTileState(opts.tileEl, "state-failure");
    hapticFailure();
    showToast({ type: "error", message: result.message || "Command failed." });
  }
  return result.status;
}

function describeError(err) {
  if (err instanceof ProviderError) {
    if (err.code === "NO_TOKEN" || err.status === 401) return "Not paired with the PC yet.";
    return err.message || err.code;
  }
  return err && err.message ? err.message : "Something went wrong.";
}
