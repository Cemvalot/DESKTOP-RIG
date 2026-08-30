// frontend/src/app.js — main bootstrap: chrome, tab/swipe navigation,
// screen mounting, live-data fan-out, idle/pairing/settings wiring.
// This is the ONLY module that talks to data/index.js's getProvider() at
// the top level of orchestration — screens receive the provider via ctx
// and call it directly for their own reads, but all cross-cutting wiring
// (status/now-playing/connection fan-out, pairing gate) lives here.

import { injectIconSprite, iconMarkup } from "./components/icons.js";
import { el, getLayer } from "./components/dom.js";
import { createTabBar, TABS } from "./components/navTabs.js";
import { createStatusStrip } from "./components/statusStrip.js";
import { createConnectionOverlay } from "./components/connectionOverlay.js";
import { createIdleScreen } from "./components/idleScreen.js";
import { createPairingScreen } from "./components/pairingScreen.js";
import { createSettingsPanel } from "./components/settingsPanel.js";
import { createHistoryDrawer } from "./components/historyDrawer.js";
import { getProvider, getProviderMode } from "./data/index.js";
import { getSettings, getActiveProfileId, setActiveProfileId, getLastTab, setLastTab } from "./state/store.js";

import * as HomeScreen from "./screens/home.js";
import * as GamingScreen from "./screens/gaming.js";
import * as MediaScreen from "./screens/media.js";
import * as SystemScreen from "./screens/system.js";
import * as SmartHomeScreen from "./screens/smarthome.js";

const SCREEN_MODULES = { home: HomeScreen, gaming: GamingScreen, media: MediaScreen, system: SystemScreen, smarthome: SmartHomeScreen };
const CONTENT_WIDTH = 1232;

async function loadJson(relPath) {
  const res = await fetch(new URL(relPath, import.meta.url));
  return res.json();
}

function fitToViewport() {
  const app = document.body;
  const scale = Math.min(window.innerWidth / 1280, window.innerHeight / 800, 1) || 1;
  app.style.transform = `translate(-50%, -50%) scale(${scale})`;
}

function applyTheme(profile, settings, schedule) {
  let theme = null;
  if (settings.themeMode === "night") theme = "night";
  else if (profile && profile.theme === "night") theme = "night";
  else if (schedule && schedule.enabled && settings.autoThemeSchedule) {
    const hour = new Date().getHours();
    const { nightStartHour, nightEndHour } = schedule;
    const inNight = nightStartHour > nightEndHour ? hour >= nightStartHour || hour < nightEndHour : hour >= nightStartHour && hour < nightEndHour;
    if (inNight) theme = "night";
  }
  if (theme) document.documentElement.setAttribute("data-theme", theme);
  else document.documentElement.removeAttribute("data-theme");
}

async function main() {
  injectIconSprite();
  fitToViewport();
  window.addEventListener("resize", fitToViewport);

  const provider = getProvider();
  await provider.init();

  const profilesData = await loadJson("./data/seed/profiles.json");
  const pcName = await provider.getPcName().catch(() => profilesData.pcName || "PC");

  const app = document.getElementById("app");
  const dimOverlay = el("div", { id: "dim-overlay", class: "dim-overlay" });
  app.appendChild(dimOverlay);

  // ── Pairing gate (live provider only; mock is always "paired") ────────
  // showPairingGate() is reusable: it's called once at startup below, and
  // again any time provider.subscribeAuthInvalid() fires later (stale/
  // revoked token discovered mid-session — see docs/test-report.md Bug #1).
  let pairingGateOpen = false;
  function showPairingGate({ reloadOnSuccess = false } = {}) {
    if (pairingGateOpen) return;
    pairingGateOpen = true;
    return new Promise((resolve) => {
      createPairingScreen({
        provider,
        onPaired: () => {
          pairingGateOpen = false;
          if (reloadOnSuccess) {
            // Screens each fetch their config/data once at mount time
            // (home.js's renderLaunchGrid, gaming.js's rails, etc. — none
            // of them re-fetch reactively). If auth went invalid AFTER
            // they'd already mounted and failed their one-shot load, just
            // resolving this promise leaves them permanently empty even
            // though the new token is now valid — confirmed by testing
            // this exact recovery path. A full reload is the simple,
            // robust fix: the fresh token is already in localStorage, so
            // main() re-runs cleanly past the gate with working data.
            // Not needed for the *initial* gate below, since nothing has
            // mounted yet in that case.
            window.location.reload();
            return;
          }
          resolve();
        },
      });
    });
  }

  if (!provider.isPaired()) {
    await showPairingGate();
  }
  provider.subscribeAuthInvalid(() => {
    showPairingGate({ reloadOnSuccess: true });
  });

  buildChrome();

  function currentProfile() {
    const id = getActiveProfileId(profilesData.activeProfile);
    return profilesData.profiles.find((p) => p.id === id) || profilesData.profiles[0];
  }

  function refreshTheme() {
    applyTheme(currentProfile(), getSettings(), profilesData.themeSchedule);
  }
  refreshTheme();
  setInterval(refreshTheme, 60000);

  // ── Mount screens into the swipe track ─────────────────────────────────
  const track = document.getElementById("screens-track");
  const screenHandles = {};
  TABS.forEach((tab, i) => {
    const screenEl = el("div", { class: `screen screen-${tab.id}`, "data-visible": i === 0 ? "true" : "false" });
    track.appendChild(screenEl);
    screenHandles[tab.id] = SCREEN_MODULES[tab.id].mount(screenEl, { provider, profile: currentProfile() });
  });

  // ── Tab bar + swipe navigation ──────────────────────────────────────────
  let activeIndex = Math.max(0, TABS.findIndex((t) => t.id === getLastTab(currentProfile().defaultTab)));
  if (activeIndex < 0) activeIndex = 0;

  const tabBar = createTabBar((tabId) => goToTab(TABS.findIndex((t) => t.id === tabId)));
  document.getElementById("app").appendChild(tabBar.el);

  function setTransform(index, animate = true) {
    track.style.transition = animate ? "" : "none";
    track.style.transform = `translateX(-${index * CONTENT_WIDTH}px)`;
    if (!animate) void track.offsetHeight; // force reflow before re-enabling transition
    track.style.transition = "";
  }
  function updateVisibility(index) {
    Array.from(track.children).forEach((child, i) => {
      child.dataset.visible = i === index ? "true" : "false";
    });
  }

  function goToTab(index) {
    if (index < 0 || index >= TABS.length) return;
    activeIndex = index;
    setTransform(activeIndex, true);
    updateVisibility(activeIndex);
    tabBar.setActive(TABS[activeIndex].id);
    setLastTab(TABS[activeIndex].id);
    idle.resetIdleTimer();
  }

  setTransform(activeIndex, false);
  updateVisibility(activeIndex);
  tabBar.setActive(TABS[activeIndex].id);

  // Swipe gesture on the content viewport.
  const viewport = document.getElementById("screens-viewport");
  let tracking = false; // pointer is down; may or may not turn into a drag
  let dragCaptured = false; // moved past the threshold — now actually owns the gesture
  let startX = 0;
  let dragDx = 0;
  let activePointerId = null;
  const DRAG_CAPTURE_THRESHOLD = 8; // px — standard tap-vs-swipe disambiguation distance

  function isInteractiveTarget(target) {
    return !!target.closest('input[type="range"], .tile.editable, .editing, .slider');
  }

  // Fix for docs/test-report.md §3 (the click-suppression bug): the old
  // code called setPointerCapture() unconditionally on every pointerdown
  // in the content area, which per the Pointer Events spec retargets the
  // subsequent pointerup/compat click away from whatever was actually
  // tapped — silently swallowing taps on buttons/tiles anywhere in the
  // swipeable viewport (confirmed to intermittently break the Home
  // screen's Lock button and launch tiles). Capture is now deferred until
  // the pointer has actually moved past a small threshold, which is the
  // standard way to disambiguate "this is a swipe" from "this is a tap" —
  // a plain tap never captures the pointer at all, so its click event
  // reaches the real target normally, exactly like it would with no
  // gesture handler present.
  viewport.addEventListener("pointerdown", (e) => {
    if (isInteractiveTarget(e.target)) return;
    tracking = true;
    dragCaptured = false;
    startX = e.clientX;
    dragDx = 0;
    activePointerId = e.pointerId;
  });
  viewport.addEventListener("pointermove", (e) => {
    if (!tracking || e.pointerId !== activePointerId) return;
    dragDx = e.clientX - startX;
    if (!dragCaptured) {
      if (Math.abs(dragDx) < DRAG_CAPTURE_THRESHOLD) return;
      dragCaptured = true;
      track.style.transition = "none";
      viewport.setPointerCapture(e.pointerId);
    }
    const base = -(activeIndex * CONTENT_WIDTH);
    track.style.transform = `translateX(${base + dragDx}px)`;
  });
  function endDrag(e) {
    if (!tracking || (e && e.pointerId !== activePointerId)) return;
    tracking = false;
    activePointerId = null;
    if (!dragCaptured) {
      // Never exceeded the threshold — this was a tap, not a swipe. We
      // never captured the pointer, so the click already reached its real
      // target; nothing left to do here.
      dragDx = 0;
      return;
    }
    dragCaptured = false;
    track.style.transition = "";
    const threshold = CONTENT_WIDTH * 0.3;
    if (dragDx <= -threshold && activeIndex < TABS.length - 1) {
      goToTab(activeIndex + 1);
    } else if (dragDx >= threshold && activeIndex > 0) {
      goToTab(activeIndex - 1);
    } else {
      setTransform(activeIndex, true); // snap back
    }
    dragDx = 0;
  }
  viewport.addEventListener("pointerup", endDrag);
  viewport.addEventListener("pointercancel", endDrag);

  // ── Status strip: PC name, clock, connection badge, gear ───────────────
  const strip = createStatusStrip({
    onOpenSettings: () => settingsPanel.open(),
    onGoToSystem: () => goToTab(TABS.findIndex((t) => t.id === "system")),
  });
  document.getElementById("app").insertBefore(strip.el, document.getElementById("app").firstChild);
  strip.setPcName(pcName);

  // History drawer toggle button, appended next to the gear icon.
  const historyDrawer = createHistoryDrawer({ provider });
  const historyBtn = el("button", { class: "gear-btn", "aria-label": "Command history", html: iconMarkup("history"), onclick: () => historyDrawer.toggle() });
  strip.el.querySelector(".right-cluster").insertBefore(historyBtn, strip.el.querySelector(".gear-btn"));

  // ── Connection-lost overlay + live data fan-out ────────────────────────
  const connOverlay = createConnectionOverlay({ pcName, onRetry: () => provider.init() });
  provider.subscribeConnection(({ state, lastConnectedAt }) => {
    strip.setConnection(state);
    connOverlay.setState(state, lastConnectedAt);
  });
  provider.subscribeStatus((status) => {
    strip.setGpuTemp(status.gpu?.temp_c);
    for (const handle of Object.values(screenHandles)) handle.updateStatus && handle.updateStatus(status);
  });
  provider.subscribeNowPlaying((np) => {
    for (const handle of Object.values(screenHandles)) handle.updateNowPlaying && handle.updateNowPlaying(np);
  });
  provider.subscribeCommandResult(() => historyDrawer.refresh());

  // ── Idle / screensaver ───────────────────────────────────────────────
  const idle = createIdleScreen({ pcName });

  // ── Settings panel ──────────────────────────────────────────────────
  const settingsPanel = createSettingsPanel({
    provider,
    profiles: profilesData.profiles,
    onProfileChange: (id) => {
      setActiveProfileId(id);
      refreshTheme();
      screenHandles.home.refreshLayout && screenHandles.home.refreshLayout();
      goToTab(TABS.findIndex((t) => t.id === currentProfile().defaultTab));
    },
    onRepair: async () => {
      settingsPanel.close();
      await provider.revoke().catch(() => {});
      location.reload();
    },
  });

  // Dismiss settings/history when tapping the main content area.
  viewport.addEventListener("pointerdown", () => {
    historyDrawer.close();
  });
}

function buildChrome() {
  const app = document.getElementById("app");
  const viewport = el("div", { id: "screens-viewport", class: "screens-viewport" });
  const track = el("div", { id: "screens-track", class: "screens-track" });
  viewport.appendChild(track);
  app.appendChild(viewport);
  getLayer("overlay-root");
}

main().catch((err) => {
  console.error("[app] fatal init error", err);
  document.body.innerHTML = `<pre style="color:#F5455C;padding:24px;">Launchpad failed to start:\n${err.stack || err}</pre>`;
});

// ── Service worker registration (PWA offline shell caching) ────────────
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(new URL("../service-worker.js", import.meta.url)).catch((err) => {
      console.warn("[app] service worker registration failed", err);
    });
  });
}
