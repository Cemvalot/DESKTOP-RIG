// frontend/src/screens/gaming.js — Gaming screen (design-system.md §15.3).
//
// Game launches use the `launch_game` command type per reconciliation.md
// §2: { type: 'launch_game', steam_app_id }. The numeric id is extracted
// client-side from games.json's `launch.target` ("steam://rungameid/<id>")
// — never hardcoded.
//
// NOTE (flagged to the lead): Game Mode toggle, Controller Tools,
// Screenshot, Screen Recording, and Perf Overlay aren't represented in
// architecture-security.md's command table or config/maintenance.json.
// They're sent here as best-fit `maintenance` commands with proposed
// task_ids (see below) — the mock provider accepts them; the live
// provider will 404 (UNKNOWN_TASK_ID) until the server config/allowlist
// is extended to match. This is intentional (the frontend must not invent
// its own allowlist) and is called out in the frontend report.

import { el } from "../components/dom.js";
import { iconMarkup } from "../components/icons.js";
import { createTile, createActionButton } from "../components/tile.js";
import { makeGridEditable } from "../components/editLayout.js";
import { getLayoutFor, recordGameLaunch, getRecentGames, getActiveProfileId } from "../state/store.js";
import { runCommand } from "../state/commands.js";
import { COMMAND_TYPES } from "../data/index.js";

function steamIdFromTarget(target) {
  const m = /rungameid\/(\d+)/.exec(target || "");
  return m ? m[1] : null;
}

export function mount(container, ctx) {
  const { provider, profile } = ctx;

  const quickGrid = el("div", { class: "tile-row" });
  const quickPanel = el("div", { class: "panel panel-quick panel-pad" }, [el("h3", { class: "panel-title" }, "Quick Launch"), quickGrid]);

  const gameModeBtn = el("button", { class: "game-mode-toggle press-scale", html: `${iconMarkup("gamepad-scene")} Game Mode` });
  const gamemodePanel = el("div", { class: "panel panel-gamemode panel-pad" }, [el("h3", { class: "panel-title" }, "Game Mode"), gameModeBtn]);

  const controllerBtn = createActionButton({ id: "controller", label: "Controller", icon: "controller", onClick: () => runMaintenance("open-controller-tools", controllerBtn, "Opened controller settings.") });
  const screenshotBtn = createActionButton({ id: "screenshot", label: "Screenshot", icon: "camera", onClick: () => runMaintenance("take-screenshot", screenshotBtn, "Screenshot captured.") });
  const recordBtn = createActionButton({ id: "record", label: "Record", icon: "video", onClick: () => toggleRecording() });
  const desktopBtn = createActionButton({ id: "desktop", label: "Desktop", icon: "monitor", onClick: () => openDesktop() });
  const perfBtn = createActionButton({ id: "perf", label: "Perf Overlay", icon: "gauge", onClick: () => togglePerfOverlay() });
  const toolsPanel = el("div", { class: "panel panel-tools panel-pad" }, [
    el("h3", { class: "panel-title" }, "Tools"),
    el("div", { class: "tile-row" }, [controllerBtn, screenshotBtn]),
    el("div", { class: "tile-row" }, [recordBtn, desktopBtn]),
    el("div", { class: "tile-row" }, [perfBtn]),
  ]);

  const recentRow = el("div", { class: "tile-row" });
  const recentPanel = el("div", { class: "panel panel-recent panel-pad" }, [el("h3", { class: "panel-title" }, "Recently Played"), recentRow]);

  const favRow = el("div", { class: "tile-row" });
  const favPanel = el("div", { class: "panel panel-fav panel-pad" }, [el("h3", { class: "panel-title" }, "Favorites"), favRow]);

  container.appendChild(el("div", { class: "screen-inner" }, [quickPanel, gamemodePanel, toolsPanel, recentPanel, favPanel]));

  let recording = false;
  let perfOn = false;
  let gameModeOn = false;

  function runMaintenance(taskId, tileEl, successMessage, dangerous = false) {
    return runCommand(
      { type: COMMAND_TYPES.MAINTENANCE, task_id: taskId },
      { tileEl, successMessage, dangerousTitle: dangerous ? "Are you sure?" : undefined }
    );
  }

  function openDesktop() {
    runCommand({ type: COMMAND_TYPES.OPEN_LINK, link_id: "desktop-folder" }, { tileEl: desktopBtn, successMessage: "Opened Desktop." });
  }

  async function toggleRecording() {
    const res = await runMaintenance(recording ? "stop-screen-recording" : "start-screen-recording", recordBtn, recording ? "Recording stopped." : "Recording started.");
    if (res === "success") {
      recording = !recording;
      recordBtn.classList.toggle("primary", recording);
    }
  }
  async function togglePerfOverlay() {
    const res = await runMaintenance("toggle-perf-overlay", perfBtn, perfOn ? "Perf overlay hidden." : "Perf overlay shown.");
    if (res === "success") {
      perfOn = !perfOn;
      perfBtn.classList.toggle("primary", perfOn);
    }
  }
  gameModeBtn.addEventListener("click", async () => {
    const res = await runMaintenance("toggle-game-mode", gameModeBtn, gameModeOn ? "Game Mode off." : "Game Mode on.");
    if (res === "success") {
      gameModeOn = !gameModeOn;
      gameModeBtn.classList.toggle("on", gameModeOn);
    }
  });

  async function renderQuickLaunch() {
    // Optional-module-tagged apps (e.g. OBS, disabled by default per
    // reconciliation.md §1) are excluded from the core Quick Launch rail,
    // matching design-system.md §15.3's wireframe (Steam + Library only).
    const apps = (await provider.getApps()).filter(
      (a) => (a.tags || []).includes("gaming") && !(a.tags || []).some((t) => t.startsWith("optional-module"))
    );
    quickGrid.innerHTML = "";
    for (const app of apps) {
      const tile = createTile({ id: app.id, label: app.label, icon: app.icon, onClick: () => launchApp(app, tile) });
      quickGrid.appendChild(tile);
    }
  }

  function launchApp(app, tileEl) {
    runCommand({ type: COMMAND_TYPES.LAUNCH_APP, app_id: app.id }, { tileEl, successMessage: `Launched ${app.label}.` });
  }

  function launchGame(game, tileEl) {
    const steamAppId = steamIdFromTarget(game.launch && game.launch.target);
    if (!steamAppId) return;
    runCommand({ type: COMMAND_TYPES.LAUNCH_GAME, steam_app_id: steamAppId }, { tileEl, successMessage: `Launching ${game.label}…` }).then((status) => {
      if (status === "success") recordGameLaunch(game.id);
    });
  }

  async function renderGameRails() {
    const games = await provider.getGames();
    const byId = Object.fromEntries(games.library.map((g) => [g.id, g]));
    const localRecents = getRecentGames();
    const recentOrder = [...new Set([...localRecents, ...(games.recentlyPlayed || [])])].filter((id) => byId[id]);

    recentRow.innerHTML = "";
    for (const id of recentOrder.slice(0, 4)) {
      const g = byId[id];
      const tile = createTile({ id: g.id, label: g.label, icon: "grid", size: "sm", onClick: () => launchGame(g, tile) });
      recentRow.appendChild(tile);
    }

    favRow.innerHTML = "";
    for (const id of games.favorites || []) {
      const g = byId[id];
      if (!g) continue;
      const tile = createTile({ id: g.id, label: g.label, icon: "grid", favorite: true, onClick: () => launchGame(g, tile) });
      favRow.appendChild(tile);
    }
    makeGridEditable(favRow, { profileId: getActiveProfileId(profile.id), screenKey: "gamingFavorites" });
  }

  renderQuickLaunch();
  renderGameRails();

  return {
    updateStatus() {},
    updateNowPlaying() {},
    destroy() {},
  };
}
