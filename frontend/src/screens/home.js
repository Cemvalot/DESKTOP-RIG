// frontend/src/screens/home.js — Home screen (design-system.md §15.2).

import { el } from "../components/dom.js";
import { iconMarkup } from "../components/icons.js";
import { createTile, createIconButton } from "../components/tile.js";
import { createStatusCard, fmtPercent, fmtTemp } from "../components/statusCard.js";
import { makeGridEditable } from "../components/editLayout.js";
import { getLayoutFor, recordAppLaunch, getActiveProfileId } from "../state/store.js";
import { runCommand } from "../state/commands.js";
import { COMMAND_TYPES } from "../data/index.js";
import { fmtDuration } from "../components/dom.js";

export function mount(container, ctx) {
  const { provider, profile, onVoiceToggle } = ctx;

  const launchPanel = el("div", { class: "panel panel-launch panel-pad panel-launch-wrap" }, [
    el("h3", { class: "panel-title" }, "Launch"),
  ]);
  const grid = el("div", { class: "launch-grid" });
  launchPanel.appendChild(grid);

  // Now Playing
  const npTitle = el("p", { class: "title" }, "Nothing playing");
  const npArtist = el("p", { class: "artist" }, "—");
  const albumArt = el("div", { class: "album-thumb", html: iconMarkup("spotify") });
  const playBtn = createIconButton({ id: "np-play", icon: "play", extraClass: "play", onClick: () => toggleMedia() });
  const prevBtn = createIconButton({ id: "np-prev", icon: "prev-track", onClick: () => provider.mediaControl("previous") });
  const nextBtn = createIconButton({ id: "np-next", icon: "next-track", onClick: () => provider.mediaControl("next") });
  const micIcon = el("span", { html: iconMarkup("mic") });
  const volLabel = el("span", { class: "mono" }, "62%");
  const volSlider = el("input", { type: "range", min: "0", max: "100", value: "62", class: "slider" });
  volSlider.addEventListener("change", () => provider.setVolume({ level: Number(volSlider.value) }));

  const nowPlayingPanel = el("div", { class: "panel panel-nowplaying panel-pad nowplaying-panel" }, [
    el("h3", { class: "panel-title" }, "Now Playing"),
    el("div", { class: "nowplaying-top" }, [albumArt, el("div", { class: "nowplaying-meta" }, [npTitle, npArtist])]),
    el("div", { class: "transport-row" }, [prevBtn, playBtn, nextBtn]),
    el("div", { class: "mic-vol-row" }, [micIcon, el("div", { style: "flex:1; display:flex; align-items:center; gap:8px;" }, [volSlider, volLabel])]),
  ]);

  // Status
  const cpuCard = createStatusCard({ icon: "cpu", label: "CPU", value: "—", sub: "CPU" });
  const gpuCard = createStatusCard({ icon: "gpu", label: "GPU", value: "—", sub: "GPU" });
  const ramCard = createStatusCard({ icon: "ram", label: "RAM", value: "—", sub: "RAM" });
  const tempCard = createStatusCard({ icon: "thermometer", label: "Temp", value: "—", sub: "Temp" });
  const netCard = createStatusCard({ icon: "wifi", label: "Net", value: "—", sub: "Network" });
  const statusPanel = el("div", { class: "panel panel-status panel-pad" }, [
    el("h3", { class: "panel-title" }, "Status"),
    el("div", { class: "status-grid" }, [cpuCard, gpuCard, ramCard, tempCard, netCard]),
  ]);

  // Power cluster — isolated, dangerous, confirmation-gated.
  const lockBtn = el("button", { class: "btn-action press-scale", html: `${iconMarkup("lock")}<span class="tile-label">Lock</span>` });
  const voiceBtn = el("button", { class: "btn-action press-scale voice-btn", "aria-label": "Voice trigger", title: "Say launch", html: `${iconMarkup("mic")}<span class="tile-label">Voice</span>` });
  const restartBtn = el("button", { class: "btn-action press-scale", html: `${iconMarkup("restart")}<span class="tile-label">Restart</span>` });
  const shutdownBtn = el("button", { class: "btn-action press-scale", html: `${iconMarkup("shutdown")}<span class="tile-label">Shutdown</span>` });
  lockBtn.addEventListener("click", () => runPower("lock", lockBtn));
  voiceBtn.addEventListener("click", () => onVoiceToggle && onVoiceToggle());
  restartBtn.addEventListener("click", () => runPower("restart", restartBtn));
  shutdownBtn.addEventListener("click", () => runPower("shutdown", shutdownBtn));
  const powerPanel = el("div", { class: "panel panel-power panel-pad power-cluster" }, [
    el("h3", { class: "panel-title" }, "Power"),
    el("div", { class: "power-row" }, [voiceBtn, lockBtn, restartBtn, shutdownBtn]),
  ]);

  function setVoiceListening(listening) {
    voiceBtn.classList.toggle("active", listening);
    voiceBtn.setAttribute("aria-label", listening ? "Stop voice trigger" : "Voice trigger");
    voiceBtn.title = listening ? "Listening for launch" : "Say launch";
  }

  container.appendChild(el("div", { class: "screen-inner" }, [launchPanel, nowPlayingPanel, statusPanel, powerPanel]));

  function runPower(action, tileEl) {
    const labels = { lock: "Lock this PC?", restart: "Restart DESKTOP-RIG?", shutdown: "Shut down DESKTOP-RIG?" };
    const bodies = {
      lock: "The PC screen will lock. You can unlock it as usual at the desk.",
      restart: "This will close all open applications and restart the PC.",
      shutdown: "This will close all open applications and power off the PC.",
    };
    runCommand(
      { type: COMMAND_TYPES.POWER_ACTION, action },
      {
        tileEl,
        dangerousTitle: labels[action],
        dangerousBody: bodies[action],
        confirmLabel: action === "lock" ? "Lock" : action === "restart" ? "Restart" : "Shut Down",
        successMessage: `${action[0].toUpperCase()}${action.slice(1)} command sent.`,
      }
    );
  }

  function toggleMedia() {
    provider.mediaControl("toggle");
  }

  let playing = true;
  function updateNowPlaying(np) {
    if (!np) return;
    npTitle.textContent = np.title || "Nothing playing";
    npArtist.textContent = np.artist || "—";
    renderAlbumArt(albumArt, np.album_art_url);
    playing = !!np.is_playing;
    playBtn.querySelector("use").setAttribute("href", `#icon-${playing ? "pause" : "play"}`);
  }

  function renderAlbumArt(container, url) {
    container.innerHTML = "";
    if (!url) {
      container.innerHTML = iconMarkup("spotify");
      return;
    }
    const isVideo = /\.(?:mp4|webm|ogg)(?:$|[?#])/i.test(url);
    const art = isVideo ? el("video", { src: url, autoplay: true, muted: true, loop: true, playsinline: true, "aria-label": "Album artwork" }) : el("img", { src: url, alt: "Album artwork" });
    art.addEventListener("error", () => {
      container.innerHTML = iconMarkup("spotify");
    }, { once: true });
    container.appendChild(art);
  }

  function updateStatus(status) {
    if (!status) return;
    cpuCard.querySelector(".value").textContent = fmtPercent(status.cpu?.usage_percent);
    gpuCard.querySelector(".value").textContent = fmtPercent(status.gpu?.usage_percent);
    ramCard.querySelector(".value").textContent = fmtPercent(status.ram?.usage_percent);
    tempCard.querySelector(".value").textContent = fmtTemp(status.cpu?.temp_c);
    netCard.querySelector(".value").textContent = status.network?.connected ? "Online" : "Offline";
    if (status.audio) {
      volSlider.value = status.audio.volume_percent;
      volLabel.textContent = `${status.audio.volume_percent}%`;
      micIcon.innerHTML = iconMarkup(status.audio.mic_muted ? "mic-off" : "mic");
    }
  }

  async function renderLaunchGrid() {
    const apps = (await provider.getApps()).filter((a) => (a.tags || []).includes("home"));
    const byId = Object.fromEntries(apps.map((a) => [a.id, a]));
    const order = getLayoutFor(getActiveProfileId(profile.id), "home", profile.homeLayout.filter((id) => byId[id]));
    grid.innerHTML = "";
    for (const id of order) {
      const app = byId[id];
      if (!app) continue;
      const tile = createTile({
        id: app.id,
        label: app.label,
        icon: app.icon,
        onClick: () => launchApp(app, tile),
      });
      if (app.id === "codex-cli") tile.classList.add("launch-ai", "launch-codex");
      if (app.id === "claude-cli") tile.classList.add("launch-ai", "launch-claude");
      if (app.id === "chatgpt") tile.classList.add("launch-ai", "launch-chatgpt");
      grid.appendChild(tile);
    }
    makeGridEditable(grid, { profileId: getActiveProfileId(profile.id), screenKey: "home" });
  }

  function launchApp(app, tileEl) {
    runCommand(
      { type: COMMAND_TYPES.LAUNCH_APP, app_id: app.id },
      { tileEl, successMessage: `Launched ${app.label}.` }
    ).then((status) => {
      if (status === "success") recordAppLaunch(app.id);
    });
  }

  renderLaunchGrid();
  provider.getNowPlaying().then(updateNowPlaying).catch(() => {});

  return {
    updateStatus,
    updateNowPlaying,
    setVoiceListening,
    destroy() {},
    refreshLayout: renderLaunchGrid,
  };
}
