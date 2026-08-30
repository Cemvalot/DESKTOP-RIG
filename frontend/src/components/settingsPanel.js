// frontend/src/components/settingsPanel.js
//
// Settings modal/panel opened from the gear icon in the top status strip
// (NOT a 6th tab — nav stays fixed at 5 per design-system.md §10).
// Contains: profile switcher, theme mode, haptics/sound toggles, screen-dim
// (Wake Lock + CSS dim overlay, explicitly labeled simulated), pairing
// status + re-pair, mock/live provider toggle (behind a Developer
// disclosure), export/import of localStorage state.

import { el, getLayer } from "./dom.js";
import { iconMarkup } from "./icons.js";
import { getSettings, updateSettings, getActiveProfileId, exportState, importState } from "../state/store.js";
import { getProviderMode, setProviderMode } from "../data/index.js";
import { showToast } from "./toast.js";
import { hapticPress } from "./feedback.js";

let wakeLock = null;
async function applyScreenDim(on) {
  const overlay = document.getElementById("dim-overlay");
  if (overlay) overlay.classList.toggle("on", on);
  try {
    if (on && "wakeLock" in navigator) {
      wakeLock = await navigator.wakeLock.request("screen");
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch (_) {
    /* Wake Lock may be denied/unsupported — the CSS dim still applies. */
  }
}

function toggleRow(label, checked, onChange) {
  const t = el("div", { class: `toggle ${checked ? "on" : ""}`, role: "switch", "aria-checked": String(checked) });
  const row = el(
    "div",
    {
      class: "settings-row press-scale",
      onclick: () => {
        hapticPress();
        const next = !t.classList.contains("on");
        t.classList.toggle("on", next);
        t.setAttribute("aria-checked", String(next));
        onChange(next);
      },
    },
    [el("span", { class: "label" }, label), t]
  );
  return row;
}

export function createSettingsPanel({ provider, profiles, onProfileChange, onRepair, onExitReady }) {
  const settings = getSettings();
  const panel = el("div", { class: "settings-panel" });
  panel.appendChild(
    el("button", { class: "settings-close press-scale", "aria-label": "Close settings", html: iconMarkup("close"), onclick: () => close() })
  );
  panel.appendChild(el("h2", {}, "Settings"));

  // Profile switcher
  const profileSection = el("div", { class: "settings-section" }, [el("h3", {}, "Profile")]);
  const profileSelect = el("select", {}, profiles.map((p) => el("option", { value: p.id, selected: p.id === getActiveProfileId() || undefined }, p.label)));
  profileSelect.addEventListener("change", () => {
    hapticPress();
    onProfileChange(profileSelect.value);
  });
  profileSection.appendChild(el("div", { class: "settings-row" }, [el("span", { class: "label" }, "Active profile"), profileSelect]));
  panel.appendChild(profileSection);

  // Appearance
  const themeSelect = el(
    "select",
    {},
    [
      el("option", { value: "auto", selected: settings.themeMode === "auto" || undefined }, "Auto (schedule)"),
      el("option", { value: "night", selected: settings.themeMode === "night" || undefined }, "Night (forced)"),
    ]
  );
  themeSelect.addEventListener("change", () => {
    hapticPress();
    updateSettings({ themeMode: themeSelect.value });
  });
  const appearance = el("div", { class: "settings-section" }, [
    el("h3", {}, "Appearance"),
    el("div", { class: "settings-row" }, [el("span", { class: "label" }, "Theme mode"), themeSelect]),
  ]);
  appearance.appendChild(
    toggleRow("Screen dim (software, simulated)", settings.screenDim, (on) => {
      updateSettings({ screenDim: on });
      applyScreenDim(on);
    })
  );
  panel.appendChild(appearance);

  // Feedback
  const feedback = el("div", { class: "settings-section" }, [el("h3", {}, "Feedback")]);
  feedback.appendChild(toggleRow("Haptics", settings.haptics, (on) => updateSettings({ haptics: on })));
  feedback.appendChild(toggleRow("Sound", settings.sound, (on) => updateSettings({ sound: on })));
  panel.appendChild(feedback);

  // Pairing
  const pairingSection = el("div", { class: "settings-section" }, [el("h3", {}, "Pairing")]);
  const pairingStatus = el("div", { class: "settings-row" }, [
    el("span", { class: "label" }, provider.isPaired() ? "Paired with PC" : "Not paired"),
  ]);
  const repairBtn = el("button", { class: "btn-secondary press-scale", onclick: () => onRepair && onRepair() }, "Re-pair device");
  pairingSection.appendChild(pairingStatus);
  pairingSection.appendChild(el("div", { class: "settings-row" }, [repairBtn]));
  panel.appendChild(pairingSection);

  // Backup / restore
  const backupSection = el("div", { class: "settings-section" }, [el("h3", {}, "Backup")]);
  const exportBtn = el("button", { class: "btn-secondary press-scale" }, "Export Config");
  const importBtn = el("button", { class: "btn-secondary press-scale" }, "Import Config");
  const importInput = el("input", { type: "file", accept: "application/json", style: "display:none" });
  exportBtn.addEventListener("click", () => {
    hapticPress();
    const dump = exportState();
    const blob = new Blob([JSON.stringify(dump, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = el("a", { href: url, download: `launchpad-config-${Date.now()}.json` });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });
  importBtn.addEventListener("click", () => importInput.click());
  importInput.addEventListener("change", async () => {
    const file = importInput.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      importState(JSON.parse(text));
      showToast({ type: "success", message: "Config imported. Reloading…" });
      setTimeout(() => location.reload(), 900);
    } catch (err) {
      showToast({ type: "error", message: "Import failed — invalid file." });
    }
  });
  backupSection.appendChild(el("div", { class: "settings-row" }, [exportBtn, importBtn, importInput]));
  panel.appendChild(backupSection);

  // Developer disclosure: mock/live provider toggle
  const devDetails = el("details", { class: "dev-disclosure" }, [el("summary", {}, "Developer")]);
  const providerSelect = el(
    "select",
    {},
    [
      el("option", { value: "mock", selected: getProviderMode() === "mock" || undefined }, "Mock provider (demo data)"),
      el("option", { value: "live", selected: getProviderMode() === "live" || undefined }, "Live provider (real PC service)"),
    ]
  );
  providerSelect.addEventListener("change", async () => {
    hapticPress();
    await setProviderMode(providerSelect.value);
    showToast({ type: "info", message: `Switched to ${providerSelect.value} provider. Reloading…` });
    setTimeout(() => location.reload(), 700);
  });
  devDetails.appendChild(el("div", { class: "settings-row" }, [el("span", { class: "label" }, "Data provider"), providerSelect]));
  panel.appendChild(devDetails);

  getLayer("overlay-root").appendChild(panel);

  function open() {
    panel.style.display = "block";
    requestAnimationFrame(() => panel.classList.add("in"));
  }
  function close() {
    panel.classList.remove("in");
    setTimeout(() => {
      panel.style.display = "none";
    }, 200);
    if (onExitReady) onExitReady();
  }
  panel.style.display = "none";

  if (settings.screenDim) applyScreenDim(true);

  return { el: panel, open, close };
}
