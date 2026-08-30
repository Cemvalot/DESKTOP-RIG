// frontend/src/components/icons.js
//
// Single inline SVG sprite per design-system.md §7: 24x24 viewBox, 2px
// stroke, round caps/joins, stroke: currentColor. Loaded once, referenced
// everywhere via <svg class="icon"><use href="#icon-NAME"/></svg>.

const SYMBOLS = {
  play: `<polygon points="6,4 20,12 6,20" fill="currentColor" stroke="none"/>`,
  pause: `<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>`,
  "prev-track": `<polygon points="18,4 6,12 18,20" fill="currentColor" stroke="none"/><rect x="4" y="4" width="2" height="16" fill="currentColor" stroke="none"/>`,
  "next-track": `<polygon points="6,4 18,12 6,20" fill="currentColor" stroke="none"/><rect x="18" y="4" width="2" height="16" fill="currentColor" stroke="none"/>`,
  stop: `<rect x="5" y="5" width="14" height="14" rx="2"/>`,
  "volume-high": `<polygon points="4,9 8,9 13,4 13,20 8,15 4,15" /><path d="M17 8c1.5 1.3 1.5 6.7 0 8"/><path d="M20 5c3 3 3 11 0 14"/>`,
  "volume-low": `<polygon points="4,9 8,9 13,4 13,20 8,15 4,15" /><path d="M17 8c1.5 1.3 1.5 6.7 0 8"/>`,
  "volume-mute": `<polygon points="4,9 8,9 13,4 13,20 8,15 4,15" /><line x1="17" y1="9" x2="22" y2="15"/><line x1="22" y1="9" x2="17" y2="15"/>`,
  mic: `<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/>`,
  "mic-off": `<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 12.2 4.6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/><line x1="3" y1="3" x2="21" y2="21"/>`,
  power: `<line x1="12" y1="3" x2="12" y2="11"/><path d="M7 6a8 8 0 1 0 10 0"/>`,
  lock: `<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>`,
  restart: `<path d="M4 12a8 8 0 1 1 3 6.2"/><polyline points="4,17 4,12 9,12"/>`,
  shutdown: `<line x1="12" y1="3" x2="12" y2="11"/><path d="M7 6a8 8 0 1 0 10 0"/>`,
  wifi: `<path d="M3 9a15 15 0 0 1 18 0"/><path d="M6.5 13a10 10 0 0 1 11 0"/><path d="M10 17a5 5 0 0 1 4 0"/><circle cx="12" cy="20.5" r="1" fill="currentColor" stroke="none"/>`,
  "wifi-off": `<path d="M3 9a15 15 0 0 1 18 0" opacity=".35"/><path d="M6.5 13a10 10 0 0 1 11 0" opacity=".35"/><path d="M10 17a5 5 0 0 1 4 0" opacity=".35"/><circle cx="12" cy="20.5" r="1" fill="currentColor" stroke="none"/><line x1="2" y1="2" x2="22" y2="22"/>`,
  cpu: `<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="10" y="10" width="4" height="4"/><line x1="9" y1="2" x2="9" y2="6"/><line x1="15" y1="2" x2="15" y2="6"/><line x1="9" y1="18" x2="9" y2="22"/><line x1="15" y1="18" x2="15" y2="22"/><line x1="2" y1="9" x2="6" y2="9"/><line x1="2" y1="15" x2="6" y2="15"/><line x1="18" y1="9" x2="22" y2="9"/><line x1="18" y1="15" x2="22" y2="15"/>`,
  gpu: `<rect x="3" y="7" width="18" height="10" rx="2"/><circle cx="8" cy="12" r="2"/><circle cx="14" cy="12" r="2"/><line x1="3" y1="20" x2="21" y2="20"/>`,
  ram: `<rect x="4" y="8" width="16" height="8" rx="1"/><line x1="7" y1="8" x2="7" y2="5"/><line x1="11" y1="8" x2="11" y2="5"/><line x1="15" y1="8" x2="15" y2="5"/><line x1="17" y1="16" x2="17" y2="19"/>`,
  thermometer: `<path d="M12 3a2 2 0 0 0-2 2v9.5a4 4 0 1 0 4 0V5a2 2 0 0 0-2-2z"/><circle cx="12" cy="18" r="1.5" fill="currentColor" stroke="none"/>`,
  steam: `<circle cx="12" cy="12" r="9"/><circle cx="15" cy="9" r="2.4"/><circle cx="8.5" cy="15" r="2"/><line x1="10" y1="13.5" x2="13.2" y2="10.6"/>`,
  discord: `<rect x="4" y="7" width="16" height="11" rx="4"/><circle cx="9" cy="12.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="12.5" r="1.3" fill="currentColor" stroke="none"/><path d="M8 7l1-3h6l1 3"/>`,
  browser: `<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><line x1="3" y1="12" x2="21" y2="12"/>`,
  spotify: `<circle cx="12" cy="12" r="9"/><path d="M7 10c3.5-1 8-.6 10.3 1"/><path d="M7.3 13.2c3-.8 6.7-.5 8.7.9"/><path d="M7.6 16.2c2.5-.6 5.4-.4 7 .7"/>`,
  folder: `<path d="M3 7a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7z"/>`,
  terminal: `<rect x="3" y="4" width="18" height="16" rx="2"/><polyline points="7,9 11,12 7,15"/><line x1="12" y1="15" x2="17" y2="15"/>`,
  codex: `<rect x="3" y="4" width="18" height="16" rx="2"/><polyline points="7,9 11,12 7,15"/><line x1="12" y1="15" x2="17" y2="15"/>`,
  claude: `<path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8l-5 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/><path d="M8 10h8M8 14h5"/>`,
  chatgpt: `<path d="M12 3a4 4 0 0 1 3.5 2.1A4 4 0 0 1 20 9a4 4 0 0 1-.5 7.2A4 4 0 0 1 16 21a4 4 0 0 1-3.5-2.1A4 4 0 0 1 8 15a4 4 0 0 1 .5-7.2A4 4 0 0 1 12 3z"/><path d="m8.5 8.2 7 4M8.5 15.8l7-4M12 3v8M16 21v-8M20 9l-7 4M4 15l7-4"/>`,
  controller: `<rect x="3" y="8" width="18" height="9" rx="4"/><line x1="7" y1="11" x2="7" y2="14"/><line x1="5.5" y1="12.5" x2="8.5" y2="12.5"/><circle cx="16" cy="11.5" r="1" fill="currentColor" stroke="none"/><circle cx="18" cy="13.5" r="1" fill="currentColor" stroke="none"/>`,
  camera: `<path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.4"/>`,
  video: `<rect x="3" y="6" width="12" height="12" rx="2"/><polygon points="21,8 15,12 21,16" fill="currentColor" stroke="none"/>`,
  monitor: `<rect x="3" y="4" width="18" height="12" rx="2"/><line x1="8" y1="20" x2="16" y2="20"/><line x1="12" y1="16" x2="12" y2="20"/>`,
  gauge: `<circle cx="12" cy="13" r="8"/><line x1="12" y1="13" x2="16" y2="9"/><line x1="8" y1="6" x2="8" y2="6"/>`,
  lightbulb: `<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>`,
  thermostat: `<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="5" x2="12" y2="7"/>`,
  moon: `<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/>`,
  "gamepad-scene": `<rect x="3" y="9" width="18" height="8" rx="4"/><line x1="7" y1="12" x2="7" y2="14"/><line x1="6" y1="13" x2="8" y2="13"/><circle cx="16" cy="12.5" r="1" fill="currentColor" stroke="none"/><circle cx="18" cy="14" r="1" fill="currentColor" stroke="none"/>`,
  home: `<path d="M4 11.5 12 4l8 7.5"/><path d="M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9"/>`,
  grid: `<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>`,
  "clock-history": `<circle cx="12" cy="12" r="9"/><polyline points="12,7 12,12 16,14"/>`,
  star: `<polygon points="12,3 14.8,9.2 21.5,9.9 16.5,14.3 18,21 12,17.4 6,21 7.5,14.3 2.5,9.9 9.2,9.2"/>`,
  chevron: `<polyline points="9,5 16,12 9,19"/>`,
  close: `<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>`,
  check: `<polyline points="4,13 9,18 20,6"/>`,
  "alert-triangle": `<path d="M12 4 21 19H3z"/><line x1="12" y1="10" x2="12" y2="14.5"/><circle cx="12" cy="17.2" r="0.6" fill="currentColor" stroke="none"/>`,
  gear: `<circle cx="12" cy="12" r="3"/><path d="M12 3v2.2M12 18.8V21M21 12h-2.2M5.2 12H3M18.4 5.6l-1.5 1.5M7.1 16.9l-1.5 1.5M18.4 18.4l-1.5-1.5M7.1 7.1 5.6 5.6"/>`,
  drag: `<circle cx="9" cy="6" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.2" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.2" fill="currentColor" stroke="none"/>`,
  qrcode: `<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><line x1="14" y1="14" x2="14" y2="21"/><line x1="21" y1="14" x2="21" y2="14"/><line x1="17" y1="17" x2="21" y2="17"/><line x1="14" y1="21" x2="21" y2="21"/>`,
  history: `<circle cx="12" cy="12" r="9"/><polyline points="12,7 12,12 16,14"/><path d="M3 12a9 9 0 0 1 9-9"/>`,
};

export function injectIconSprite() {
  if (document.getElementById("icon-sprite")) return;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.id = "icon-sprite";
  svg.setAttribute("aria-hidden", "true");
  svg.style.position = "absolute";
  svg.style.width = "0";
  svg.style.height = "0";
  svg.style.overflow = "hidden";
  let defs = "";
  for (const [name, inner] of Object.entries(SYMBOLS)) {
    defs += `<symbol id="icon-${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</symbol>`;
  }
  svg.innerHTML = defs;
  document.body.appendChild(svg);
}

/** Returns an HTML string for an <svg class="icon ..."><use .../></svg> */
export function iconMarkup(name, extraClass = "") {
  return `<svg class="icon ${extraClass}"><use href="#icon-${name}"></use></svg>`;
}

export const ICON_NAMES = Object.keys(SYMBOLS);
