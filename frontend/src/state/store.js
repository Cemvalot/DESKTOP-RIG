// frontend/src/state/store.js
//
// Small localStorage-backed state store for everything that is purely a
// client-side UI preference: settings, active profile, per-profile tile
// layout overrides, favorites/recents. None of this touches the provider
// interface — it's local app state, scoped per browser profile/device.

const KEYS = {
  settings: "launchpad.settings",
  activeProfile: "launchpad.activeProfileId",
  layouts: "launchpad.layouts",
  recents: "launchpad.recentApps",
  recentGames: "launchpad.recentGames",
  favorites: "launchpad.favoriteGames",
  lastTab: "launchpad.lastTab",
};

const DEFAULT_SETTINGS = {
  haptics: true,
  sound: true,
  themeMode: "auto", // 'auto' | 'night' (manual force)
  screenDim: false,
  autoThemeSchedule: true,
};

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...JSON.parse(raw) };
  } catch (_) {
    return fallback;
  }
}
function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

const listeners = new Set();
function notify(key) {
  for (const cb of listeners) cb(key);
}
export function onStoreChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getSettings() {
  return readJson(KEYS.settings, DEFAULT_SETTINGS);
}
export function updateSettings(patch) {
  const next = { ...getSettings(), ...patch };
  writeJson(KEYS.settings, next);
  notify("settings");
  return next;
}

export function getActiveProfileId(defaultId = "default") {
  return localStorage.getItem(KEYS.activeProfile) || defaultId;
}
export function setActiveProfileId(id) {
  localStorage.setItem(KEYS.activeProfile, id);
  notify("activeProfile");
}

/** Per-profile tile-order overrides, e.g. { default: { home: ['steam',...] } } */
export function getLayouts() {
  try {
    return JSON.parse(localStorage.getItem(KEYS.layouts) || "{}");
  } catch (_) {
    return {};
  }
}
export function setLayout(profileId, screenKey, orderedIds) {
  const layouts = getLayouts();
  layouts[profileId] = { ...(layouts[profileId] || {}), [screenKey]: orderedIds };
  writeJson(KEYS.layouts, layouts);
  notify("layouts");
}
export function getLayoutFor(profileId, screenKey, fallbackOrder) {
  const layouts = getLayouts();
  const saved = layouts[profileId] && layouts[profileId][screenKey];
  if (!saved || !saved.length) return fallbackOrder;
  // Keep only ids that still exist, then append any new ids not yet ordered.
  const known = new Set(fallbackOrder);
  const ordered = saved.filter((id) => known.has(id));
  for (const id of fallbackOrder) if (!ordered.includes(id)) ordered.push(id);
  return ordered;
}

export function getLastTab(defaultTab = "home") {
  return localStorage.getItem(KEYS.lastTab) || defaultTab;
}
export function setLastTab(tab) {
  localStorage.setItem(KEYS.lastTab, tab);
}

function getList(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || "[]");
  } catch (_) {
    return [];
  }
}
function pushRecent(key, id, max = 8) {
  let list = getList(key).filter((x) => x !== id);
  list.unshift(id);
  if (list.length > max) list.length = max;
  writeJson(key, list);
  notify("recents");
  return list;
}

export function recordAppLaunch(appId) {
  return pushRecent(KEYS.recents, appId);
}
export function getRecentApps() {
  return getList(KEYS.recents);
}
export function recordGameLaunch(gameId) {
  return pushRecent(KEYS.recentGames, gameId);
}
export function getRecentGames() {
  return getList(KEYS.recentGames);
}

export function getFavoriteGames() {
  return getList(KEYS.favorites);
}
export function toggleFavoriteGame(gameId) {
  const list = getFavoriteGames();
  const idx = list.indexOf(gameId);
  if (idx >= 0) list.splice(idx, 1);
  else list.unshift(gameId);
  writeJson(KEYS.favorites, list);
  notify("favorites");
  return list;
}

/** Export everything this store owns as a downloadable JSON blob. */
export function exportState() {
  const dump = {};
  for (const [name, key] of Object.entries(KEYS)) {
    const raw = localStorage.getItem(key);
    if (raw !== null) dump[name] = JSON.parse(raw);
  }
  dump._exportedAt = new Date().toISOString();
  dump._version = 1;
  return dump;
}

/** Import a previously-exported JSON blob, overwriting current local state. */
export function importState(dump) {
  for (const [name, key] of Object.entries(KEYS)) {
    if (dump[name] !== undefined) writeJson(key, dump[name]);
  }
  notify("import");
}

export { KEYS as STORE_KEYS, DEFAULT_SETTINGS };
