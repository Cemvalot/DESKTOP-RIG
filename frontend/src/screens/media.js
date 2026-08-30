// frontend/src/screens/media.js — Media screen (design-system.md §15.4).
//
// NOTE: architecture-security.md's command model controls "the currently
// active OS media session" (§4.4) — there is no command to switch audio
// OUTPUT device or force a specific media SOURCE app. The output selector
// and source row are therefore informational here (source reflects
// now-playing's `app` field; output shows "System Default" since no
// device-enumeration endpoint exists in the contract). Flagged to the lead
// as a possible follow-up endpoint if per-device output switching is
// wanted later.

import { el, fmtDuration } from "../components/dom.js";
import { iconMarkup } from "../components/icons.js";
import { createIconButton, createChip } from "../components/tile.js";
import { showToast } from "../components/toast.js";

export function mount(container, ctx) {
  const { provider } = ctx;

  const albumArt = el("div", { class: "media-album-art", html: iconMarkup("spotify") });
  const titleEl = el("h2", { class: "track-title" }, "Nothing playing");
  const artistEl = el("p", { class: "track-artist" }, "—");
  const posT = el("span", { class: "t" }, "0:00");
  const durT = el("span", { class: "t" }, "0:00");
  const fill = el("div", { class: "media-progress-fill", style: "width:0%" });
  const track = el("div", { class: "media-progress-track" }, [fill]);
  const info = el("div", { class: "media-info" }, [titleEl, artistEl, el("div", { class: "media-progress" }, [posT, track, durT])]);
  const top = el("div", { class: "media-top" }, [albumArt, info]);

  const prevBtn = createIconButton({ id: "prev", icon: "prev-track", onClick: () => provider.mediaControl("previous") });
  const playBtn = createIconButton({ id: "play", icon: "pause", extraClass: "play-lg", onClick: () => provider.mediaControl("toggle") });
  const nextBtn = createIconButton({ id: "next", icon: "next-track", onClick: () => provider.mediaControl("next") });
  const transport = el("div", { class: "media-transport" }, [prevBtn, playBtn, nextBtn]);

  const outputChip = createChip({ id: "output", label: "Speakers (System Default)", active: true, onClick: () => showToast({ type: "info", message: "Output-device switching isn't in the v1 server contract yet." }) });
  const outputPanel = el("div", { class: "panel panel-pad" }, [el("h3", { class: "panel-title" }, "Output"), outputChip]);

  const volSlider = el("input", { type: "range", min: "0", max: "100", value: "62", class: "slider" });
  const volLabel = el("span", { class: "mono" }, "62%");
  volSlider.addEventListener("change", () => provider.setVolume({ level: Number(volSlider.value) }));
  const volPanel = el("div", { class: "panel panel-pad" }, [
    el("h3", { class: "panel-title" }, "Volume"),
    el("div", { style: "display:flex; align-items:center; gap:12px;" }, [volSlider, volLabel]),
  ]);

  const muteBtn = createIconButton({ id: "mute", icon: "volume-high", onClick: () => toggleMute() });
  let muted = false;
  function toggleMute() {
    muted = !muted;
    provider.setVolume({ mute: muted });
    muteBtn.querySelector("use").setAttribute("href", `#icon-${muted ? "volume-mute" : "volume-high"}`);
  }

  const spotifyChip = createChip({ id: "spotify", label: "Spotify", active: false, onClick: () => {} });
  const browserChip = createChip({ id: "browser", label: "Browser Media", active: false, onClick: () => {} });
  const sourceRow = el("div", { class: "panel panel-pad media-source-row" }, [
    el("h3", { class: "panel-title" }, "Source"),
    el("div", { style: "display:flex; gap:12px;" }, [spotifyChip, browserChip]),
  ]);

  const bottom = el("div", { class: "media-bottom" }, [outputPanel, volPanel, muteBtn, sourceRow]);

  container.appendChild(el("div", { class: "screen-inner" }, [top, transport, bottom]));

  function renderProgress(np) {
    // Position is not guaranteed to be synchronized across desktop players;
    // show the reliable total track length instead of a misleading timer.
    posT.textContent = np.duration_ms ? `Length ${fmtDuration(np.duration_ms)}` : "Length --:--";
    durT.textContent = "";
    fill.style.width = "0%";
  }

  function updateNowPlaying(np) {
    if (!np) return;
    titleEl.textContent = np.title || "Nothing playing";
    artistEl.textContent = np.artist || "—";
    renderAlbumArt(np.album_art_url);
    renderProgress(np);
    playBtn.querySelector("use").setAttribute("href", `#icon-${np.is_playing ? "pause" : "play"}`);
    const appName = String(np.app || "").toLowerCase();
    const isSpotify = appName === "spotify";
    const isYoutube = appName.includes("youtube") || appName.includes("chromium") || appName.includes("chrome") || appName.includes("browser");
    spotifyChip.classList.toggle("active", isSpotify);
    browserChip.classList.toggle("active", !isSpotify);
    browserChip.querySelector("span").textContent = isYoutube ? "YouTube" : "Browser Media";
  }

  function renderAlbumArt(url) {
    albumArt.innerHTML = "";
    if (!url) {
      albumArt.innerHTML = iconMarkup("spotify");
      return;
    }
    const isVideo = /\.(?:mp4|webm|ogg)(?:$|[?#])/i.test(url);
    const art = isVideo ? el("video", { src: url, autoplay: true, muted: true, loop: true, playsinline: true, "aria-label": "Album artwork" }) : el("img", { src: url, alt: "Album artwork" });
    art.addEventListener("error", () => {
      albumArt.innerHTML = iconMarkup("spotify");
    }, { once: true });
    albumArt.appendChild(art);
  }

  function updateStatus(status) {
    if (!status || !status.audio) return;
    volSlider.value = status.audio.volume_percent;
    volLabel.textContent = `${status.audio.volume_percent}%`;
    muted = status.audio.muted;
    muteBtn.querySelector("use").setAttribute("href", `#icon-${muted ? "volume-mute" : "volume-high"}`);
  }

  provider.getNowPlaying().then(updateNowPlaying).catch(() => {});

  return { updateStatus, updateNowPlaying, destroy() {} };
}
