// frontend/src/screens/smarthome.js — Smart Home screen (design-system.md §15.6).
//
// config/smarthome.json has connected:false — every control here renders
// in the disabled/inert placeholder treatment. Nothing is wired to
// fake-succeed; there is no provider.executeCommand call anywhere in this
// screen while the integration is disabled.

import { el } from "../components/dom.js";
import { iconMarkup } from "../components/icons.js";

function lightControl(label, tile) {
  const toggle = el("div", { class: "toggle", "aria-disabled": "true" });
  const brightness = el("input", { type: "range", class: "slider", disabled: true, value: "60" });
  const colorTemp = el("input", { type: "range", class: "slider", disabled: true, value: "50" });
  return el("div", { class: "panel panel-pad light-control state-disabled" }, [
    el("div", { class: "light-header" }, [
      el("span", { html: `${iconMarkup("lightbulb")} ${label}` }),
      toggle,
    ]),
    tile.supportsBrightness ? el("div", {}, [el("label", { class: "small" }, "Brightness"), brightness]) : null,
    tile.supportsColorTemp ? el("div", {}, [el("label", { class: "small" }, "Color Temp"), colorTemp]) : null,
  ]);
}

export function mount(container, ctx) {
  const root = el("div", { class: "screen-inner" });
  container.appendChild(root);

  async function render() {
    let cfg;
    try {
      cfg = await ctx.provider.getSmartHomeConfig();
    } catch (_) {
      cfg = { connected: false, tiles: {}, scenes: [] };
    }

    root.innerHTML = "";
    const deskPanel = el("div", { class: "panel-desk" }, [lightControl(cfg.tiles.deskLight?.label || "Desk Light", cfg.tiles.deskLight || {})]);
    const roomPanel = el("div", { class: "panel-room" }, [lightControl(cfg.tiles.roomLight?.label || "Room Light", cfg.tiles.roomLight || {})]);

    const scenesCol = el("div", { class: "scenes-col" });
    for (const scene of cfg.scenes || []) {
      scenesCol.appendChild(
        el("button", { class: "chip state-disabled", disabled: true }, scene.label)
      );
    }
    const scenesPanel = el("div", { class: "panel panel-pad panel-scenes state-disabled" }, [el("h3", { class: "panel-title" }, "Scenes"), scenesCol]);

    const climatePanel = el("div", { class: "panel panel-pad panel-climate state-disabled" }, [
      el("h3", { class: "panel-title" }, cfg.tiles.climate?.label || "Room Temperature"),
      el("div", { class: "status-card" }, [el("span", { html: iconMarkup("thermostat") }), el("span", { class: "value mono" }, "—")]),
    ]);

    const hintPanel = el("div", { class: "panel-hint placeholder-card" }, [
      el("span", { html: iconMarkup("alert-triangle") }),
      el("span", {}, "Home Assistant integration coming soon"),
    ]);

    root.appendChild(deskPanel);
    root.appendChild(roomPanel);
    root.appendChild(scenesPanel);
    root.appendChild(climatePanel);
    root.appendChild(hintPanel);
  }

  render();

  return { updateStatus() {}, updateNowPlaying() {}, destroy() {} };
}
