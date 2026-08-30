// frontend/src/screens/system.js — System screen (design-system.md §15.5).

import { el } from "../components/dom.js";
import { iconMarkup } from "../components/icons.js";
import { createStatusCard, fmtPercent, fmtTemp } from "../components/statusCard.js";
import { createIconButton, createChip } from "../components/tile.js";
import { runCommand } from "../state/commands.js";
import { COMMAND_TYPES } from "../data/index.js";

export function mount(container, ctx) {
  const { provider } = ctx;

  const cpuCard = createStatusCard({ icon: "cpu", label: "CPU", value: "—" });
  const gpuCard = createStatusCard({ icon: "gpu", label: "GPU", value: "—" });
  const ramCard = createStatusCard({ icon: "ram", label: "RAM", value: "—" });
  const diskCCard = createStatusCard({ icon: "ram", label: "Disk C:", value: "—" });
  const diskDCard = createStatusCard({ icon: "ram", label: "Disk D:", value: "—" });
  const cpuTempCard = createStatusCard({ icon: "thermometer", label: "CPU Temp", value: "—" });
  const gpuTempCard = createStatusCard({ icon: "thermometer", label: "GPU Temp", value: "—" });
  const netCard = createStatusCard({ icon: "wifi", label: "Network", value: "—" });
  const telemetryPanel = el("div", { class: "panel panel-telemetry panel-pad" }, [
    el("h3", { class: "panel-title" }, "Telemetry"),
    el("div", { class: "telemetry-grid" }, [cpuCard, gpuCard, ramCard, diskCCard, diskDCard, cpuTempCard, gpuTempCard, netCard]),
  ]);

  const lockBtn = el("button", { class: "btn-action sm press-scale", html: `${iconMarkup("lock")}<span class="tile-label">Lock</span>` });
  const sleepBtn = el("button", { class: "btn-action sm press-scale", html: `${iconMarkup("moon")}<span class="tile-label">Sleep</span>` });
  const restartBtn = el("button", { class: "btn-action sm press-scale", html: `${iconMarkup("restart")}<span class="tile-label">Restart</span>` });
  const shutdownBtn = el("button", { class: "btn-action sm press-scale", html: `${iconMarkup("shutdown")}<span class="tile-label">Shutdown</span>` });
  [
    ["lock", lockBtn, "Lock"],
    ["sleep", sleepBtn, "Sleep"],
    ["restart", restartBtn, "Restart"],
    ["shutdown", shutdownBtn, "Shut Down"],
  ].forEach(([action, btnEl, label]) => btnEl.addEventListener("click", () => runPower(action, btnEl, label)));
  const powerPanel = el("div", { class: "panel panel-sys-power panel-pad power-cluster compact" }, [
    el("h3", { class: "panel-title" }, "Power"),
    el("div", { class: "power-row" }, [lockBtn, sleepBtn]),
    el("div", { class: "power-row" }, [restartBtn, shutdownBtn]),
  ]);

  const micBtn = createIconButton({ id: "mic", icon: "mic", onClick: () => toggleMic() });
  let micMuted = false;
  function toggleMic() {
    micMuted = !micMuted;
    provider.setMic({ mute: micMuted });
    micBtn.querySelector("use").setAttribute("href", `#icon-${micMuted ? "mic-off" : "mic"}`);
  }
  const volSlider = el("input", { type: "range", min: "0", max: "100", value: "62", class: "slider" });
  const volLabel = el("span", { class: "mono" }, "62%");
  volSlider.addEventListener("change", () => provider.setVolume({ level: Number(volSlider.value) }));
  const audioPanel = el("div", { class: "panel panel-audio panel-pad" }, [
    el("h3", { class: "panel-title" }, "Audio"),
    el("div", { class: "settings-row" }, [el("span", { class: "label" }, "Mic"), micBtn]),
    el("div", { class: "settings-row" }, [el("span", { class: "label" }, "Master Volume"), volSlider, volLabel]),
  ]);

  const taskMgrBtn = createChip({ id: "taskmgr", label: "Task Manager", icon: "monitor", onClick: () => runMaintenance("open-task-manager", taskMgrBtn, "Opened Task Manager.") });
  const desktopBtn = createChip({ id: "desktop", label: "Open Desktop", icon: "monitor", onClick: () => openDesktop() });
  const screenshotBtn = createChip({ id: "screenshot", label: "Screenshot", icon: "camera", onClick: () => runMaintenance("take-screenshot", screenshotBtn, "Screenshot captured.") });
  const quickActionsPanel = el("div", { class: "panel panel-quick-actions panel-pad" }, [
    el("h3", { class: "panel-title" }, "Quick Actions"),
    el("div", { class: "quick-actions-row" }, [taskMgrBtn, desktopBtn, screenshotBtn]),
  ]);

  const maintenanceRow = el("div", { class: "maintenance-row" });
  const maintenancePanel = el("div", { class: "panel panel-pad" }, [
    el("h3", { class: "panel-title" }, "Maintenance"),
    maintenanceRow,
  ]);

  const quickMaintCol = el("div", { class: "quickmaint-col" }, [quickActionsPanel, maintenancePanel]);

  container.appendChild(
    el("div", { class: "screen-inner" }, [telemetryPanel, powerPanel, audioPanel, quickMaintCol])
  );

  function runMaintenance(taskId, tileEl, successMessage) {
    return runCommand({ type: COMMAND_TYPES.MAINTENANCE, task_id: taskId }, { tileEl, successMessage });
  }
  function openDesktop() {
    runCommand({ type: COMMAND_TYPES.OPEN_LINK, link_id: "desktop-folder" }, { tileEl: desktopBtn, successMessage: "Opened Desktop." });
  }
  function runPower(action, tileEl, label) {
    const bodies = {
      lock: "The PC screen will lock.",
      sleep: "The PC will enter sleep mode.",
      restart: "This will close all open applications and restart the PC.",
      shutdown: "This will close all open applications and power off the PC.",
    };
    runCommand(
      { type: COMMAND_TYPES.POWER_ACTION, action },
      { tileEl, dangerousTitle: `${label} DESKTOP-RIG?`, dangerousBody: bodies[action], confirmLabel: label, successMessage: `${label} command sent.` }
    );
  }

  async function renderMaintenance() {
    const commands = await provider.getMaintenanceCommands();
    maintenanceRow.innerHTML = "";
    for (const cmd of commands) {
      const btn = createChip({
        id: cmd.id,
        label: cmd.label,
        icon: cmd.icon || "gear",
        onClick: () =>
          runCommand(
            { type: COMMAND_TYPES.MAINTENANCE, task_id: cmd.id },
            {
              tileEl: btn,
              dangerousTitle: `${cmd.label}?`,
              dangerousBody: "This maintenance action will run on the PC now.",
              confirmLabel: "Run",
              successMessage: `${cmd.label} completed.`,
            }
          ),
      });
      maintenanceRow.appendChild(btn);
    }
  }
  renderMaintenance();

  function updateStatus(status) {
    if (!status) return;
    cpuCard.querySelector(".value").textContent = fmtPercent(status.cpu?.usage_percent);
    gpuCard.querySelector(".value").textContent = fmtPercent(status.gpu?.usage_percent);
    ramCard.querySelector(".value").textContent = status.ram ? `${(status.ram.used_mb / 1024).toFixed(1)}/${(status.ram.total_mb / 1024).toFixed(0)}GB` : "—";
    const disks = status.disk || [];
    if (disks[0]) diskCCard.querySelector(".value").textContent = `${Math.round((disks[0].used_gb / disks[0].total_gb) * 100)}%`;
    if (disks[1]) diskDCard.querySelector(".value").textContent = `${Math.round((disks[1].used_gb / disks[1].total_gb) * 100)}%`;
    cpuTempCard.querySelector(".value").textContent = fmtTemp(status.cpu?.temp_c);
    gpuTempCard.querySelector(".value").textContent = fmtTemp(status.gpu?.temp_c);
    netCard.querySelector(".value").textContent = status.network?.connected ? status.network.adapter || "Online" : "Offline";
    if (status.audio) {
      volSlider.value = status.audio.volume_percent;
      volLabel.textContent = `${status.audio.volume_percent}%`;
      micMuted = status.audio.mic_muted;
      micBtn.querySelector("use").setAttribute("href", `#icon-${micMuted ? "mic-off" : "mic"}`);
    }
  }

  return { updateStatus, updateNowPlaying() {}, destroy() {} };
}
