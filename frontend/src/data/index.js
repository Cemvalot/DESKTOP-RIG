// frontend/src/data/index.js
//
// Single switch point for mock vs. live data. Everything else in the app
// imports `getProvider()` from here and never imports mockProvider.js /
// liveProvider.js directly. Toggle lives in Settings > Developer (or set
// localStorage["launchpad.providerMode"] to "mock" | "live" before load).

import { createMockProvider } from "./mockProvider.js";
import { createLiveProvider } from "./liveProvider.js";

const MODE_KEY = "launchpad.providerMode";
const DEFAULT_MODE = "mock";

let activeProvider = null;
let activeMode = null;
const changeListeners = new Set();

export function getProviderMode() {
  return localStorage.getItem(MODE_KEY) || DEFAULT_MODE;
}

function build(mode) {
  return mode === "live" ? createLiveProvider() : createMockProvider();
}

/** Returns the currently active provider, creating it on first call. */
export function getProvider() {
  const mode = getProviderMode();
  if (!activeProvider || activeMode !== mode) {
    if (activeProvider) activeProvider.destroy();
    activeProvider = build(mode);
    activeMode = mode;
  }
  return activeProvider;
}

/** Switches the active provider at runtime (used by the Settings dev toggle). */
export async function setProviderMode(mode) {
  if (mode !== "mock" && mode !== "live") throw new Error("Invalid provider mode: " + mode);
  localStorage.setItem(MODE_KEY, mode);
  if (activeProvider) activeProvider.destroy();
  activeProvider = build(mode);
  activeMode = mode;
  await activeProvider.init();
  for (const cb of changeListeners) cb(mode);
  return activeProvider;
}

/** Fires whenever the active provider is swapped (mock<->live). */
export function onProviderChange(cb) {
  changeListeners.add(cb);
  return () => changeListeners.delete(cb);
}

export { ProviderError, COMMAND_TYPES } from "./provider.js";
