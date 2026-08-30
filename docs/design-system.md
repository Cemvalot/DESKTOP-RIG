# Launchpad Design System

A touchscreen control surface for a Windows PC, displayed fullscreen (PWA) on a
Samsung Galaxy Tab A8 (10.5", 1280×800 logical landscape canvas, Android 14,
3 GB RAM). This document is the single source of truth for visual and
interaction design. It is written for direct implementation — every token has
an exact value.

---

## 1. Design Philosophy

Launchpad is not an admin panel and not a phone app stretched wide. It behaves
like a **dedicated hardware control surface** — the screen on a mixing
console, a cockpit MFD, a Stream Deck's software companion, or Steam Big
Picture — that happens to be rendered in a browser. Every screen is built
from a small number of large, high-contrast, physical-feeling controls. There
is no cursor, no hover state to rely on, no dense data table, and nothing
that requires precision smaller than a fingertip.

**Reference points synthesized (not cloned):**

| Source | What we borrowed |
|---|---|
| Elgato Stream Deck software | Fixed grid of large square action tiles, icon-first labeling, instant press feedback |
| Windows 11 / Fluent (Mica) | Layered charcoal surfaces, restrained acrylic-free depth via subtle borders, calm accent usage |
| Steam Big Picture | Full-bleed dark canvas, horizontal top-level navigation, large focus-ring driven selection state |
| Razer Cortex / NZXT CAM / Armoury Crate | Live numeric telemetry readouts (CPU/GPU/temp), status-strip conventions, dark gamer aesthetic without RGB excess |
| Home Assistant / SmartThings panels | Card-per-entity layout, toggle + slider affordances, scene buttons |
| Automotive infotainment (Tesla-style) | Bottom-anchored persistent nav, huge touch targets, glanceable top status strip, screensaver clock |
| Physical control surfaces (mixing consoles, cockpits) | Grouped controls by function, destructive controls physically separated/guarded, tactile press states |

**Hard constraints carried through every decision:** deep charcoal base, one
controlled cyan accent (not a rainbow), minimal gradients, no heavy
glassmorphism/blur, large rounded touch controls, short (120–200ms)
animation, and a rendering budget that respects a 3 GB RAM Android tablet.

---

## 2. Color Tokens

All colors are defined as flat hex values (no runtime blur/blend needed).
Opacity variants are given explicitly as rgba so nothing relies on
expensive compositing.

### 2.1 Background layers

| Token | Hex | Usage |
|---|---|---|
| `--bg-0` | `#0A0C0F` | App root background, idle/screensaver canvas |
| `--bg-1` | `#12161B` | Screen base surface (behind panels), top status strip, bottom tab bar |
| `--bg-2` | `#181D24` | Standard panel / card surface |
| `--bg-3` | `#1F252D` | Raised/nested surface, list rows, input fields |
| `--bg-4` | `#262D36` | Highest flat surface: pressed panel fill, popovers |
| `--bg-overlay` | `rgba(6,8,10,0.82)` | Flat modal backdrop (no blur — see §7) |

### 2.2 Borders

| Token | Hex | Usage |
|---|---|---|
| `--border-subtle` | `#20262D` | Hairline dividers inside a panel |
| `--border-default` | `#323A44` | Standard panel/card border |
| `--border-strong` | `#454F5C` | Emphasized border, input focus (non-accent) |

### 2.3 Text

| Token | Hex | Usage |
|---|---|---|
| `--text-primary` | `#F2F5F7` | Headings, primary labels, numeric readouts |
| `--text-secondary` | `#9AA5B1` | Sub-labels, metadata, inactive tab labels |
| `--text-tertiary` | `#5D6670` | Placeholder, disabled text, timestamps |
| `--text-inverse` | `#06121A` | Text/icons placed on filled accent surfaces |

### 2.4 Accent — electric cyan (single controlled hue)

| Token | Hex / value | Usage |
|---|---|---|
| `--accent` | `#29D3E8` | Primary accent: active tab, primary buttons, focus rings, key numeric highlights |
| `--accent-hover` | `#4EE0F2` | Pressed/active-brighten state on accent-filled controls |
| `--accent-active` | `#1AB8CC` | Pressed-down shade for accent-filled controls |
| `--accent-dim-bg` | `rgba(41,211,232,0.12)` | Subtle fill behind selected/active items |
| `--accent-border` | `rgba(41,211,232,0.45)` | Border on selected cards/active elements |
| `--accent-glow` | `rgba(41,211,232,0.35)` | Restrained glow shadow (see §6) — used sparingly, never stacked |

### 2.5 Semantic

| Token | Hex | Usage |
|---|---|---|
| `--success` | `#35D48A` | Connected, success flash, "on" state |
| `--warning` | `#FFB020` | Elevated temps, caution states |
| `--danger` | `#F5455C` | Destructive actions, critical temps, errors |
| `--danger-active` | `#D6304A` | Pressed-down shade for danger-filled controls |
| `--info` | `#4C9EFF` | Informational badges distinct from primary accent (e.g. "update available") |

### 2.6 Contrast notes

- `--text-primary` on `--bg-0/1/2/3` ≥ 14:1 (comfortably exceeds AA).
- `--text-secondary` on `--bg-1/2` ≥ 5.4:1 (passes AA for normal text).
- `--accent` on `--bg-1` ≥ 8.9:1; `--text-inverse` on `--accent` ≥ 9.8:1.
- `--danger` on `--bg-1` ≥ 4.6:1 — passes AA for the 16px+ labels it's used on.

---

## 3. Typography

**Font stack (system-only, zero network font downloads):**

```
--font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
             "Helvetica Neue", Arial, sans-serif;
--font-mono: ui-monospace, "Cascadia Mono", "Roboto Mono", "SFMono-Regular",
             Consolas, monospace;
```

`--font-sans` resolves to Roboto on Android (system default) and Segoe UI on
Windows if ever previewed there — both are already installed, no FOUT, no
webfont payload. `--font-mono` is used **only** for numeric/status readouts
(clock, temps, %, RPM) so digits don't jitter in width as they change —
paired with `font-variant-numeric: tabular-nums`.

### 3.1 Type scale

| Token | Size | Weight | Line-height | Usage |
|---|---|---|---|---|
| `--type-display` | 96px | 300 | 1.0 | Idle/screensaver clock |
| `--type-h1` | 28px | 600 | 1.2 | Screen title (rarely shown; tab bar usually suffices) |
| `--type-h2` | 20px | 600 | 1.25 | Panel/card title |
| `--type-body-lg` | 18px | 400 | 1.4 | Primary readable text (track title, dialog body) |
| `--type-body` | 16px | 400 | 1.4 | Standard body/list text |
| `--type-label` | 14px | 600 | 1.2 | Button labels, tab labels, form labels — letter-spacing 0.2px |
| `--type-caption` | 12px | 500 | 1.3 | Metadata, timestamps, helper text — letter-spacing 0.3px, often uppercase for eyebrow labels |
| `--type-numeric-lg` | 32px | 600 | 1.1 | Primary telemetry readout (e.g. big CPU %) — `--font-mono` |
| `--type-numeric-md` | 22px | 600 | 1.1 | Secondary telemetry readout — `--font-mono` |
| `--type-numeric-sm` | 14px | 500 | 1.1 | Inline numeric badges (e.g. mic level) — `--font-mono` |

---

## 4. Spacing Scale

8px base unit (1280×800 divides cleanly by 8: 160 × 100 cells).

| Token | Value |
|---|---|
| `--space-1` | 4px |
| `--space-2` | 8px |
| `--space-3` | 12px |
| `--space-4` | 16px |
| `--space-5` | 24px |
| `--space-6` | 32px |
| `--space-7` | 40px |
| `--space-8` | 48px |
| `--space-9` | 64px |
| `--space-10` | 80px |

---

## 5. Corner Radius Scale

| Token | Value | Usage |
|---|---|---|
| `--radius-sm` | 8px | Chips, badges, small inline controls |
| `--radius-md` | 14px | Buttons, inputs, list rows |
| `--radius-lg` | 20px | Cards, panels |
| `--radius-xl` | 28px | Large launch tiles, primary hero controls |
| `--radius-full` | 999px | Pills, toggle tracks, circular icon buttons, progress bars |

---

## 6. Elevation & Shadow Rules

Layered depth comes primarily from **flat background steps + 1px borders**,
not shadow stacks or blur — this is deliberate for GPU/CPU cost on a 3 GB
Android tablet. `backdrop-filter`/blur is **never** used anywhere in the app.

| Level | Composition | Usage |
|---|---|---|
| `e0` — flat | `--bg-2` fill, `1px solid --border-default` | Default card/panel |
| `e1` — raised | `--bg-3` fill, `1px solid --border-default`, `box-shadow: 0 1px 2px rgba(0,0,0,0.4)` | Pressed-in list rows, nested surfaces |
| `e2` — floating | `--bg-3` fill, `1px solid --border-strong`, `box-shadow: 0 8px 24px rgba(0,0,0,0.5)` | Modals, confirmation dialogs, popovers — **the only tier allowed a real shadow**, and only ever one shadow, never stacked |
| `glow` — accent state | `box-shadow: 0 0 0 1px var(--accent-border), 0 0 16px var(--accent-glow)` | Selected/active card, focused input — used on at most a handful of elements on screen at once, never as an idle/ambient effect |

Rule of thumb: **one shadow per element, maximum**. No drop-shadow +
inner-shadow + glow combinations.

---

## 7. Iconography

**Approach: a single inline SVG sprite (`<symbol>` defs), referenced via
`<use href="#icon-name">`.** Not an icon font.

Rationale: an icon font forces a full glyph-table download/parse for a
handful of glyphs, has known accessibility/screen-reader pitfalls, causes a
flash-of-unstyled-icon on first paint, and is harder to theme per-state
(stroke color, weight). An inline sprite is:
- Loaded once, cached, zero network cost after first load (this is a LAN app
  served by the same PC — even the first load is local).
- Trivially recolorable via `currentColor` + CSS.
- Crisp at any size with no font-hinting artifacts on a mid-DPI panel.

**Icon spec:** 24×24 viewBox, 2px stroke weight, round line-caps/joins,
minimal fill (stroke-first style, in the vein of Feather/Lucide — hand-picked
and embedded, not loaded from a CDN). Icons scale via `width`/`height` on the
`<svg>` wrapper; color via `stroke: currentColor` so state (active/disabled/
danger) is just a CSS color change, animatable in the 120–200ms budget.

Required icon set: play, pause, prev-track, next-track, stop, volume (mute/
low/high — 3 states as one glyph swap), mic (on/muted), power, lock, restart,
shutdown, wifi/connection (connected/reconnecting/offline), cpu, gpu, ram,
thermometer, steam, discord, browser, spotify, folder, terminal, controller,
camera (screenshot), video (record), monitor (desktop), gauge (perf overlay),
lightbulb, thermostat, scene/moon (focus), gamepad-scene, home, grid
(library), clock-history (recent), star (favorite), chevron (nav/expand),
close, check, alert-triangle.

---

## 8. Touch Targets & Button Sizing

Canvas is 1280×800 logical px on a 10.5" panel (~140 logical PPI at this
scale). Fingertip contact area is roughly 40–55px at this density, so targets
are sized well above the 44px web minimum:

| Class | Min size | Usage |
|---|---|---|
| Primary launch tile | 120×120px | Home app-launch grid, Gaming favorite tiles |
| Standard action button | 96×96px | Media transport controls, System power cluster |
| Compact icon button | 72×72px | Tab bar items, secondary toggles, list-row actions |
| Inline chip/toggle | 56px height, min 96px width | Scene buttons, output selector chips |

**Spacing between adjacent touch targets: minimum 16px gutter** (never less
than 12px) to keep mis-tap rate low on a device with no hover/pointer
precision aid. Destructive controls get **extra** isolation — minimum 32px
clearance from the nearest non-destructive control (see §11).

---

## 9. Grid Structure (1280×800 canvas)

```
x: 0 ────────────────────────────────────────────────────────── 1280
y: 0
   ┌──────────────────────────────────────────────────────────┐  0
   │  TOP STATUS STRIP                              height 40 │
   ├──────────────────────────────────────────────────────────┤  40
   │  ↕ 16px gap                                               │
   │  ┌────────────────────────────────────────────────────┐  │  56
   │  │                                                    │  │
   │  │              CONTENT AREA (safe)                  │  │
   │  │        x: 24–1256 (1232px wide)                    │  │
   │  │        y: 56–688 (632px tall)                       │  │
   │  │        12-col grid, 88px cols, 16px gutters         │  │
   │  │                                                    │  │
   │  └────────────────────────────────────────────────────┘  │  688
   │  ↕ 16px gap                                               │
   ├──────────────────────────────────────────────────────────┤  704
   │  BOTTOM TAB BAR                                height 96 │
   └──────────────────────────────────────────────────────────┘  800
```

- **Outer safe margin:** 24px left/right on the content area (mounted/cased
  tablet may have a slight bezel intrusion; this also keeps content clear of
  Android's edge-swipe gesture zones).
- **Content column grid:** 12 columns, 88px each, 16px gutters, within the
  1232px content width. Row height is not fixed system-wide; each screen
  below defines its own row rhythm on the 8px baseline.
- **Top status strip (40px):** non-primary-interactive; tap targets here (PC
  name / connection) are informational-first but tapping the connection
  badge deep-links to the System screen.
- **Bottom tab bar (96px):** the one persistent, always-tappable chrome
  element (see §10).

---

## 10. Navigation Pattern

**Bottom tab bar**, 6 fixed tabs, icon-over-label, always visible except
during the confirmation dialog, connection-lost overlay, and idle
screensaver (which suspend/replace all chrome).

Order (left → right): **Home · Gaming · Media · Desktop · System · Smart Home**.
Desktop (§15.4.1 addendum) was added post-v1 as its own tab rather than a
panel embedded in Media — a panel squeezed into Media's already-tight
bottom-row layout wasn't reliably visible, and a full keyboard plus a
trackpad both benefit from real screen real estate, not leftover space.

- Tab hit area: 1280px ÷ 6 ≈ 213px wide × 96px tall each (well above min).
- Active tab: icon switches to filled variant, `--accent` icon + label color,
  a 3px accent underline pill (`--radius-full`) centered under the tab,
  `--accent-dim-bg` wash behind the tab cell.
- Inactive tab: `--text-secondary` icon + label, no background.
- **Swipe-between-tabs:** a horizontal swipe anywhere in the content area
  moves to the adjacent tab. Motion: content slides 100% of its own width in
  the swipe direction while the new screen slides in from the opposite edge,
  combined with an opacity ramp (0→1 on incoming, 1→0 on outgoing),
  **200ms**, `--ease-standard` (see §12). This is a transform+opacity-only
  animation (GPU-cheap, no layout thrash). Tab bar itself never moves or
  animates position — only the active-state indicator crossfades/slides
  under the new active tab in 150ms.
- A swipe that doesn't clear 30% of screen width snaps back (150ms).

---

## 11. Feedback States

| State | Visual treatment |
|---|---|
| **Press** (finger-down) | Scale to 0.96 (`transform`, not width/height), background steps to `--bg-4` or `--accent-active` for filled buttons, applied instantly (0ms delay), released over **100ms** `--ease-standard` on lift |
| **Hover-equivalent (focus-visible)** | For any focus reached via external input (Bluetooth keyboard/switch access): 2px `--accent` outline, 2px offset — never relied on for touch-only flows |
| **Loading** | No shimmer gradients (GPU-costly at scale). A single 20px accent ring, 2px stroke, opacity-pulses 0.4→1.0→0.4 over 900ms ease-in-out, looping. Buttons show the ring in place of their icon and disable input |
| **Success** | 1px border flashes to `--success`, held 400ms, then eases back to default border over 200ms. Optional small checkmark icon crossfades in/out over the same window |
| **Failure** | Element performs a single 3px horizontal shake (2 cycles, 200ms total, `--ease-in-out`) and border flashes `--danger` for 400ms then fades |
| **Disabled** | Opacity 0.4, `--text-tertiary` label, no press/scale response, `pointer-events: none` |
| **Disconnected** (panel-level) | Affected panel drops to 0.5 opacity with a small `--danger` "Offline" badge (top-right of panel, `--type-caption`); interactive children become non-responsive. App-wide disconnect triggers the full-screen reconnecting overlay (§13 wireframe) |

---

## 12. Motion & Animation Rules

Two easing curves, both short, both simple:

```
--ease-standard: cubic-bezier(0.2, 0, 0, 1);   /* decelerate — entrances, presses-in */
--ease-in-out:   cubic-bezier(0.4, 0, 0.2, 1); /* symmetric — exits, crossfades */
```

Durations — **hard ceiling of 200ms, nothing on this app animates longer**:

| Token | Duration | Usage |
|---|---|---|
| `--motion-micro` | 100ms | Press/release feedback |
| `--motion-sm` | 150ms | Toggle flip, tab active-indicator move, snap-back |
| `--motion-md` | 200ms | Tab/screen transitions, modal open/close, panel state changes |

**May animate:** `transform` (translate/scale) and `opacity` only — both are
compositor-only properties on Chrome/WebView and cost effectively nothing on
low-RAM hardware.

**Must never animate:** `width`/`height`/`top`/`left`/`margin` (layout
thrash), `box-shadow` blur radius, `filter`/`backdrop-filter` (not used at
all in this app), background gradient position, or any property that forces
repaint of a large surface. Numeric readouts (CPU%, temps) **update
in-place with no transition** — animating a rapidly-changing number produces
visual noise, not clarity.

`prefers-reduced-motion: reduce` → all `--motion-sm`/`--motion-md` scale and
slide transitions collapse to a straight opacity crossfade at 80ms; press
feedback keeps only the background-color change, drops the scale.

---

## 13. Idle / Screensaver Treatment

After a configurable idle timeout (**default 15 minutes** of no touch), the
app crossfades (500ms — the one intentional exception to the 200ms rule,
since this is a rare, low-frequency, non-interactive transition) to a
dedicated idle screen:

- Full `--bg-0` canvas, all chrome (tab bar, status strip) hidden.
- Large clock (`--type-display`, `--font-mono`, `--text-primary`), date
  below it (`--type-body-lg`, `--text-secondary`), PC name in a small caption
  beneath that.
- A single small connection-status dot, bottom-right, `--text-tertiary` size.
- **Burn-in / image-retention mitigation:** the Tab A8 uses a TFT-LCD panel,
  not OLED, so true phosphor burn-in isn't a risk the way it is on OLED —
  but static high-contrast elements held for hours can still cause minor
  transient image persistence on any LCD. As a cheap precaution, the clock
  block's on-screen position drifts by a small pseudo-random offset (±40px
  x, ±24px y) every 2 minutes, animated as an instant jump (no tween — avoids
  a lingering animated element on an otherwise-static screen). Overall
  screen brightness may also be stepped down (handled at the OS/browser
  level via the Wake Lock + a dimming class, not by animating anything).
- Any tap anywhere instantly (no transition) returns to the last-active tab.

---

## 14. Accessibility & Ergonomics

- **Touch targets:** 72–120px per §8, chosen because at this panel's ~140
  logical-PPI and typical arm's-length/desk-mounted viewing distance,
  fingertip contact width is ~40–55px — targets are sized to leave generous
  margin for imprecise touch, not just to clear the 44px CSS minimum.
- **Contrast:** WCAG AA minimum throughout — 4.5:1 for body/label text,
  3:1 for large text (≥24px or ≥19px bold) and for meaningful UI boundaries
  (button outlines, focus rings). Verified ratios are listed in §2.6; nothing
  in the palette is used below its passing size threshold.
- **Thumb-reach zones:** the tablet is assumed desk-propped or dock-mounted
  in landscape at a shallow angle, used by either hand. The **bottom tab
  bar** sits in the zone reachable by a resting thumb from either edge.
  Frequently-used, low-risk controls (transport, launch tiles, toggles) live
  in the vertical middle band of the content area — the zone reachable
  without a hand repositioning. High-frequency screens (Home, Media) put
  their most-used control (play/pause, primary launch row) in the
  lower-middle of the content area, not the top corners.
- **Dangerous-action isolation:** lock/restart/shutdown are grouped in the
  **top-right** of Home and System — the corner requiring the most
  deliberate reach and the one furthest from the passive bottom-thumb rest
  zone and from the swipe-nav gesture area. They additionally sit behind a
  confirmation dialog (§15) with the destructive choice styled `--danger`
  and requiring a distinct, deliberately-placed tap (never the position a
  "cancel" reflex-tap would land on — cancel is always the visually
  larger/left/default-focused option).
- **Reduced motion:** honored per §12 — the app remains fully legible and
  operable with all slide/scale/shake motion reduced to short opacity
  crossfades; no information is conveyed by motion alone.
- **No reliance on hover/color alone:** every state change pairs a color
  shift with either an icon change, text label, or shape change (e.g. mic
  muted swaps the icon glyph, not just color; connection status shows a
  text badge, not just a colored dot).

---

## 15. Screen Wireframes (1280×800)

Shared conventions in all wireframes below:
`[ ]` = tappable control, `( )` = status/readout (non-interactive unless
noted), `====` = tab bar, box-drawing = panel boundary.

### 15.1 Persistent chrome — Top status strip + Bottom tab bar

```
y0                                                                        1280,40
┌──────────────────────────────────────────────────────────────────────────────┐
│ (● PC-NAME: DESKTOP-RIG)         (⏱ 14:32)          (📶 Connected  62°C GPU) │  40px
└──────────────────────────────────────────────────────────────────────────────┘
                                  [ ... content area, per screen ... ]
┌──────────────────────────────────────────────────────────────────────────────┐  704
│   [ 🏠 Home ]   [ 🎮 Gaming ]   [ 🎵 Media ]   [ 📊 System ]  [ 🏡 Smart Home]│  96px
│      active: accent icon/label + accent underline pill + accent-dim wash    │
└──────────────────────────────────────────────────────────────────────────────┘  800
```
Tab cells: 256px wide × 96px tall each, no gap between (whole strip is one
continuous bar for easy edge-to-edge thumb sweep).

### 15.2 Home

```
┌ status strip (40px) ───────────────────────────────────────────────────────┐
├──────────────────────────────────────────────────────────────────────────────┤
│  x24                                                                y1256   │
│  ┌ LAUNCH ─────────────────────────────────┐  ┌ NOW PLAYING ─────────────┐  │
│  │ [Steam] [Discord] [Browser]              │  │ (album art) Song Title  │  │
│  │ [Spotify] [Files]  [Terminal]             │  │ Artist Name             │  │
│  │  120x120 tiles, 16px gutter, 3x2 grid    │  │ [prev][play/pause][next]│  │
│  └───────────────────────────────────────────┘  │ (mic ●) [vol ▂▄▆█ 62%] │  │
│                                                   └──────────────────────────┘  │
│  ┌ STATUS ───────────────────────┐  ┌ POWER ───────────────┐               │
│  │ (CPU 34%)(GPU 41%)(RAM 51%)   │  │        [Lock]        │  top-right,   │
│  │ (Temp 58°C)(Net ● Connected)  │  │   [Restart][Shutdown]│  isolated     │
│  └────────────────────────────────┘  └───────────────────────┘               │
├──────────────────────────────────────────────────────────────────────────────┤
├ tab bar (96px) ───────────────────────────────────────────────────────────────┤
```
Layout notes: Launch grid occupies left ~7 columns, Now Playing panel right
~5 columns, top row. Status strip + Power cluster share the bottom row —
Power cluster is deliberately placed top-right-of-content (upper area, right
side) per §14, isolated by ≥32px from the Status panel and never adjacent to
the Launch grid's edge tiles.

### 15.3 Gaming

```
┌ status strip ──────────────────────────────────────────────────────────────┐
│  ┌ QUICK LAUNCH ───────────────┐  ┌ GAME MODE ──────┐  ┌ TOOLS ──────────┐ │
│  │ [Steam]  [Library]           │  │ [ Game Mode ⏻ ] │  │ [Controller]    │ │
│  │  120x120                    │  │  toggle, accent  │  │ [Screenshot]    │ │
│  │                              │  │  when ON          │  │ [Record]        │ │
│  └──────────────────────────────┘  └────────────────────┘  │ [Desktop]       │ │
│                                                              │ [Perf Overlay⏻]│ │
│  ┌ RECENTLY PLAYED ─────────────────────────────────────┐  └──────────────────┘ │
│  │ [Game A] [Game B] [Game C] [Game D]   96x96 row       │                       │
│  └──────────────────────────────────────────────────────┘                       │
│  ┌ FAVORITES ────────────────────────────────────────────┐                       │
│  │ [★Game X] [★Game Y] [★Game Z]        120x120 row       │                       │
│  └──────────────────────────────────────────────────────┘                       │
├ tab bar ───────────────────────────────────────────────────────────────────┤
```
Game Mode toggle uses the accent-glow treatment (§6) when active — it's the
one "ambient" indicator this screen allows, and only while actually engaged.

### 15.4 Media

```
┌ status strip ──────────────────────────────────────────────────────────────┐
│           ┌──────────────┐                                                 │
│           │              │   Track Title (type-h2)                        │
│           │  Album Art   │   Artist — Album (type-body, secondary)         │
│           │   240x240    │                                                 │
│           │              │   ( 1:24 ─────●────────────── 3:41 )  progress  │
│           └──────────────┘                                                 │
│                                                                              │
│         [prev]      [ ⏸ play/pause ]      [next]        [ stop ]           │
│           72px            96px               72px          72px            │
│                                                                              │
│  ┌ OUTPUT ───────────────┐   ┌ VOLUME ───────────────────────┐  [mute 🔇] │
│  │ [Speakers ▾]           │   │ ▂▃▅▆█  slider, 0–100          │            │
│  └────────────────────────┘   └────────────────────────────────┘            │
│  ┌ SOURCE ─────────────────────────────────────────────────────┐            │
│  │ [Spotify (active)]  [Browser Media]   + optional per-app vol  │            │
│  └──────────────────────────────────────────────────────────────┘            │
├ tab bar ───────────────────────────────────────────────────────────────────┤
```
Transport row is centered in the content area's middle band (primary
thumb-reach zone, §14). Play/pause is the largest control on the screen
(96px) and dead-center.

### 15.4.1 Desktop (addendum)

```
┌ status strip ──────────────────────────────────────────────────────────────┐
│ ┌ VIRTUAL KEYBOARD ──────────────────────────────┐  ┌ TRACKPAD ─────────┐ │
│ │ [1][2][3][4][5][6][7][8][9][0]      [  ⌫  ]     │  │                    │ │
│ │ [ Tab ][q][w][e][r][t][y][u][i][o][p]           │  │  drag to move ·    │ │
│ │ [a][s][d][f][g][h][j][k][l]      [  Enter  ]    │  │   tap to click     │ │
│ │ [ Shift ][z][x][c][v][b][n][m][,][.]            │  │                    │ │
│ │ [Esc][      Space      ][←][↑][↓][→]            │  │                    │ │
│ └──────────────────────────────────────────────────┘  │ [Left]  [Right]   │ │
│                                                          └────────────────┘ │
├ tab bar ───────────────────────────────────────────────────────────────────┤
```

A dedicated tab (see §10), not a panel embedded in Media. Two panels side by
side: a full-width **Virtual Keyboard** (the primary control — a standard
QWERTY layout plus digits/punctuation, Tab/Enter/Backspace/Escape, arrow
keys, and a Shift toggle that swaps every letter/digit/punctuation key's
glyph and sent character between its lower/upper or unshifted/shifted form,
e.g. `1`↔`!`, `,`↔`<`) and a fixed-width, deliberately small **Trackpad**
column next to it (touch surface + explicit Left/Right click buttons below
it). This tab is control-only — it never shows the PC's screen; an earlier
draft of this feature mirrored the display too, but that was cut in favor
of exactly this: keyboard + trackpad, nothing else. See
`docs/architecture-security.md` §11 for the protocol.

Gestures on the trackpad: one-finger drag moves the real cursor, one-finger
tap left-clicks, two-finger tap right-clicks. (Two-finger drag would map to
scroll, but the server's scroll action is a documented TODO — see
`docs/architecture-security.md` §11.1 — so the gesture deliberately does
nothing rather than surface a "not implemented" error on an ordinary
two-finger drag; it'll wire up once `ydotool`'s wheel support is verified.)
The Left/Right click buttons are an explicit, discoverable fallback for anyone
who doesn't find the gesture affordances — this app is otherwise entirely
large-button/tap driven (§14), so gestures here are a bonus shortcut, never
the only path to a click.

### 15.5 System

```
┌ status strip ──────────────────────────────────────────────────────────────┐
│  ┌ TELEMETRY ─────────────────────────────────┐   ┌ POWER ─────────┐       │
│  │ (CPU  34%)(GPU  41%)(RAM 12/32GB)            │   │   [Lock]        │  top- │
│  │ (Disk C: 61%)(Disk D: 22%)                   │   │ [Restart]       │  right│
│  │ (CPU Temp 58°C)(GPU Temp 62°C)               │   │ [Shutdown]      │       │
│  │ (Net ● Connected — 1.2Gbps)                  │   └──────────────────┘       │
│  └────────────────────────────────────────────────┘                          │
│  ┌ AUDIO ───────────────┐  ┌ QUICK ACTIONS ───────────────────────────────┐  │
│  │ [Mic: Unmuted 🎙]      │  │ [Task Manager] [Open Desktop] [Screenshot]   │  │
│  │ [Master Vol ▂▄▆█ 62%] │  └────────────────────────────────────────────────┘  │
│  └────────────────────────┘  ┌ MAINTENANCE (approved commands) ─────────────┐  │
│                                │ [Flush DNS] [Restart Spotify] [Clear Temp]   │  │
│                                │  each requires confirm dialog on tap         │  │
│                                └────────────────────────────────────────────────┘  │
├ tab bar ───────────────────────────────────────────────────────────────────┤
```
Telemetry values in `--font-mono` tabular nums, updating in place with no
transition (§12). Power cluster again isolated top-right; Maintenance
commands are visually separated with extra vertical gap (24px) since they
also require confirmation.

### 15.6 Smart Home

```
┌ status strip ──────────────────────────────────────────────────────────────┐
│  ┌ DESK ────────────┐  ┌ ROOM ────────────┐  ┌ SCENES ──────────────────┐ │
│  │ [💡 Desk Light ⏻] │  │ [💡 Room Light ⏻]│  │ [Focus]  [Gaming]         │ │
│  │ brightness ▂▄▆█   │  │ brightness ▂▄▆█  │  │ [All Off]                 │ │
│  │ color temp ○───●  │  │ color temp ○───● │  │  56px pill chips           │ │
│  └────────────────────┘  └────────────────────┘  └──────────────────────────┘ │
│  ┌ CLIMATE ──────────┐                                                      │
│  │ (Room Temp 21.4°C)│                                                      │
│  └────────────────────┘                                                      │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │   Home Assistant integration coming soon — placeholder card, dashed     │ │
│  │   border (--border-default, 1px dashed), --text-tertiary icon + label    │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
├ tab bar ───────────────────────────────────────────────────────────────────┤
```

### 15.7 Confirmation dialog (dangerous commands)

```
              full-screen --bg-overlay backdrop (flat rgba, no blur)
              ┌──────────────────────────────────────────┐
              │  ⚠  Shut down DESKTOP-RIG?                │  e2 elevation,
              │                                            │  480x260,
              │  This will close all open applications     │  centered
              │  and power off the PC.                     │
              │                                            │
              │   [    Cancel    ]   [ ⏻ Shut Down ]      │
              │     e1, --bg-3          --danger fill      │
              │     larger, left        smaller, right     │
              └──────────────────────────────────────────┘
```
Cancel is the visually larger, left/default control (thumb lands there by
reflex); the danger action is smaller, right-aligned, `--danger` filled with
`--text-inverse` label, and requires its own deliberate tap — no swipe or
double-tap shortcuts that could be triggered accidentally. Dialog opens with
`--motion-md` (200ms) scale 0.98→1 + opacity fade, `--ease-standard`.

### 15.8 Connection-lost / reconnecting overlay

```
              full-screen --bg-0, all chrome hidden
              ┌──────────────────────────────────────────┐
              │                                            │
              │        (pulsing --warning ring, 48px)      │
              │                                            │
              │        Reconnecting to DESKTOP-RIG…        │
              │        Last connected 0:42 ago              │
              │                                            │
              │             [ Retry Now ]                   │
              │                                            │
              └──────────────────────────────────────────┘
```
Triggered when the WebSocket/API link to the PC drops. Ring uses the same
opacity-pulse loading treatment as §11 (900ms loop), not a spinner rotation
(rotation is a bit more GPU-costly for no legibility gain). Automatically
dismisses and returns to the last-active tab the instant connection resumes,
with a brief `--success` badge flash ("Reconnected") for 1.5s.

### 15.9 Idle / screensaver

```
              full-screen --bg-0
              (clock block position drifts ±40x/±24y every 2 min, instant jump)

                              14:32
                          Sunday, August 30
                            DESKTOP-RIG

                                                          ● (connection dot,
                                                             bottom-right,
                                                             text-tertiary)
```
Clock in `--type-display` (96px, weight 300, `--font-mono`, `--text-primary`).
Any touch anywhere returns instantly to the last-active tab (no transition
delay on the way back in — only the way in uses the 500ms crossfade).

---

## 16. Why This Interface Suits This Tablet

- **3 GB RAM / low-end SoC:** the entire visual language avoids the
  expensive primitives that tank frame rate on budget Android WebViews —
  no `backdrop-filter`/blur anywhere, no large animated gradients, no GIF/
  video, shadows capped at one per element and mostly absent, and the only
  animatable properties are `transform`/`opacity` (compositor-only, doesn't
  trigger layout or paint of large surfaces). Loading/pulse states use plain
  opacity pulses instead of shimmer gradients for the same reason.
- **1280×800 landscape, fixed-purpose kiosk use:** the grid in §9 is built
  for exactly this canvas — a persistent bottom tab bar and top status strip
  that never need to scroll or reflow, and a content area sized so every
  screen's controls fit without vertical scrolling (this is a glance-and-tap
  surface, not a scrolling app).
  Note the tablet's native panel is actually 1920×1200; if the PWA is ever
  run un-scaled at native resolution, every token above holds — just
  multiply the whole canvas by 1.5 (browser `devicePixelRatio` handles this
  transparently since all sizing is CSS px, not raw pixels).
- **Touch-only, no cursor, no keyboard normally attached:** targets are sized
  at 72–120px (§8) — 1.6–2.7× the web accessibility minimum — because there's
  no mouse precision to fall back on, and because the tablet will typically
  be mounted or propped rather than held, adding a few degrees of
  parallax/error to every tap.
- **Android 14 PWA in fullscreen/kiosk mode:** the design assumes the OS
  status/nav bars are hidden (fullscreen display mode), which is why the app
  supplies its own 40px status strip and why the bottom tab bar sits flush
  to the true screen edge — matching the platform convention Android users
  already have muscle memory for, while claiming the edge real estate
  fullscreen mode frees up.
- **TFT-LCD (not OLED) panel:** true burn-in isn't a real risk, so the idle
  screen doesn't need aggressive pixel-shifting or forced-dark inversion —
  just the light, cheap position drift described in §13, which is enough
  insurance against long-duration static-image retention without adding any
  animation cost while idle.
- **Single control cluster per function, physically separated destructive
  actions:** because this tablet sits in a fixed location and gets tapped
  quickly/often (media control, launching apps) but only occasionally for
  power actions, isolating shutdown/restart into a low-traffic corner behind
  a confirmation dialog directly reduces the real-world cost of an
  accidental brush against the glass.

---

## 17. Token Reference (quick copy)

```css
:root {
  /* backgrounds */
  --bg-0: #0A0C0F;
  --bg-1: #12161B;
  --bg-2: #181D24;
  --bg-3: #1F252D;
  --bg-4: #262D36;
  --bg-overlay: rgba(6,8,10,0.82);

  /* borders */
  --border-subtle: #20262D;
  --border-default: #323A44;
  --border-strong: #454F5C;

  /* text */
  --text-primary: #F2F5F7;
  --text-secondary: #9AA5B1;
  --text-tertiary: #5D6670;
  --text-inverse: #06121A;

  /* accent */
  --accent: #29D3E8;
  --accent-hover: #4EE0F2;
  --accent-active: #1AB8CC;
  --accent-dim-bg: rgba(41,211,232,0.12);
  --accent-border: rgba(41,211,232,0.45);
  --accent-glow: rgba(41,211,232,0.35);

  /* semantic */
  --success: #35D48A;
  --warning: #FFB020;
  --danger: #F5455C;
  --danger-active: #D6304A;
  --info: #4C9EFF;

  /* type */
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --font-mono: ui-monospace, "Cascadia Mono", "Roboto Mono", "SFMono-Regular", Consolas, monospace;

  /* spacing */
  --space-1: 4px;  --space-2: 8px;  --space-3: 12px; --space-4: 16px; --space-5: 24px;
  --space-6: 32px; --space-7: 40px; --space-8: 48px; --space-9: 64px; --space-10: 80px;

  /* radius */
  --radius-sm: 8px; --radius-md: 14px; --radius-lg: 20px; --radius-xl: 28px; --radius-full: 999px;

  /* motion */
  --ease-standard: cubic-bezier(0.2, 0, 0, 1);
  --ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
  --motion-micro: 100ms;
  --motion-sm: 150ms;
  --motion-md: 200ms;
}
```
