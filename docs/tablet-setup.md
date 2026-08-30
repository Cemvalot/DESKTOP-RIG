# Tablet Setup — Samsung Galaxy Tab A8 (SM-X200)

This is a one-time setup guide for turning the household's Galaxy Tab A8 into a
dedicated, permanently-mounted control panel for the Launchpad dashboard. It's
written for whoever physically sets up the tablet — no developer background
assumed.

**Device this guide is written for**: Samsung Galaxy Tab A8 (SM-X200), 10.5",
Android 14, One UI 6.1, 3 GB RAM, 32 GB storage. The dashboard itself is
designed for a 1280×800 logical canvas; the tablet's native panel (1920×1200)
scales it automatically, so you don't need to change any display/resolution
setting on the tablet.

**Scope of this guide**: stock, non-rooted Android only. See §9 ("What NOT to
do") for why.

---

## 1. Finding the PC's local address and opening the dashboard

The dashboard is served directly by the Launchpad service running on the
Windows PC — there's no separate website or app store listing. You reach it by
typing the PC's local network address into the tablet's browser.

1. **Find the PC's LAN IP address.** With the Launchpad service running on the
   Windows PC, the easiest way is to look at its own console/terminal window —
   it prints its address and a 6-character pairing code every time it starts,
   something like:
   ```
   Launchpad service running at http://192.168.1.42:8787
   Pairing code: 7K4XQ9  (expires in 5 minutes)
   ```
   If that window isn't visible, open Command Prompt on the PC and run
   `ipconfig`, then look for "IPv4 Address" under the active Wi-Fi or Ethernet
   adapter (e.g. `192.168.1.42`).
2. **On the tablet**, open **Chrome** (the pre-installed default browser on
   One UI 6.1) and type the address into the address bar exactly as shown,
   including the port number, e.g.:
   ```
   http://192.168.1.42:8787/
   ```
   Do not use `https://` — the service runs plain HTTP on the home network by
   design (see `docs/architecture-security.md` §3.4).
3. The dashboard should load and show its **pairing screen**. Type the
   6-character code shown on the PC into the tablet. (The code is single-use
   and expires after 5 minutes — if it's expired, just check the PC console
   for a fresh one; a new code is generated automatically.) Once accepted,
   the tablet is paired and stays paired indefinitely — you won't need to
   repeat this unless the tablet's browser data is later cleared.

---

## 2. Installing as a PWA / adding to home screen

The dashboard is a Progressive Web App (PWA) — its `manifest.json` declares
`"display": "fullscreen"` and `"orientation": "landscape"`, so once installed
it opens with no browser address bar, no tabs, and no status/navigation chrome
at all (stronger than the more common "standalone" PWA mode, which still
shows a status bar), and Chrome will keep it locked to landscape even if the
tablet is rotated.

To install it:

1. With the dashboard open in Chrome (from step 1 above), tap the **three-dot
   menu** (top right).
2. Look for **"Install app"** (Chrome on Android 14 usually also shows this as
   a banner/pop-up near the address bar within a few seconds of the page
   loading — if you see it, that's the same action, just tap it instead of
   using the menu).
   - If you don't see "Install app," use **"Add to Home screen"** instead —
     on some Chrome/One UI builds this is the label used for the same
     install flow. Either produces the same result for this app.
3. Confirm the install prompt. An icon (a monogram derived from the app's SVG
   icon, since the manifest doesn't bundle raster PNGs) appears on the
   tablet's home screen, labeled "Launchpad."
4. From now on, launch the dashboard by tapping that home-screen icon, not by
   navigating to the address in Chrome. This opens it in its own fullscreen
   window separate from regular browser tabs, and is what all later sections
   of this guide assume you're using.

---

## 3. Fullscreen / kiosk-style configuration

### What you get automatically

Because the manifest specifies `fullscreen` display mode, launching the
installed PWA already hides the status bar and navigation bar in a way a
plain browser tab does not — this is standard Chrome-on-Android behavior for
an app whose manifest requests it, not something you need to configure. You
do not need any extra steps to get "just the dashboard, no browser furniture"
on a normal tap-to-open.

### Locking the tablet into the dashboard: App Pinning

What fullscreen mode does *not* do is stop someone from pressing the system
Home or Recents button/gesture and leaving the app. For that, Android 14 /
One UI 6.1 has a built-in feature called **App Pinning** that requires no
rooting, no third-party software, and no account changes.

**To turn on App Pinning:**

1. Open **Settings → Security and privacy → More security settings** (on
   some One UI 6.1 layouts this is **Settings → Biometrics and security**
   instead — the exact top-level label varies slightly by carrier/region
   build, but "App pinning" is always reachable from a security-related
   settings screen).
2. Tap **App pinning** and turn it **on** (toggle at the top of that screen).
   You'll also see an option "Ask for PIN before unpinning" — turn this on
   too, since it's what stops a curious household member from casually
   unpinning it.

**To pin the dashboard (do this each time, or once if you leave it pinned
long-term):**

1. Open the Launchpad app from the home screen.
2. Open **Recents** (the square/swipe-up-and-hold gesture, depending on
   whether the tablet is set to gesture or button navigation).
3. On the Launchpad card, tap the app icon at the top of the card and choose
   **Pin**.
4. The tablet is now locked to the Launchpad app. Home and Recents gestures
   are suppressed while pinned.

**Limitations — set expectations correctly:** App Pinning is exactly that —
pinning, not a true locked-down kiosk profile. It doesn't prevent someone who
knows the unpin gesture from leaving:

- **To exit**, the standard gesture is to swipe up and hold from the bottom of
  the screen (or, on button navigation, press and hold Back + Recents
  together) — if "Ask for PIN before unpinning" is on, this then prompts for
  the device PIN before releasing the pin.
- It doesn't block notifications from appearing, doesn't prevent the tablet
  from being fully unlocked/reset through Settings by someone who already
  knows the device PIN, and doesn't survive a reboot (see §6).

If you want something closer to a true kiosk profile (blocking Settings
access entirely, surviving reboots automatically, remote management, etc.),
that requires either enrolling the device with a third-party MDM/kiosk-
launcher app from the Play Store, or a work-profile-style "dedicated device"
provisioning flow. **This is optional and advanced** — it typically requires
granting the app Device Admin permissions, which is a meaningfully bigger
trust decision than anything else in this guide (a bad or bugged kiosk app
with Device Admin rights can be very hard to remove without a factory reset).
This guide deliberately does not recommend a specific app or make that call
for you; App Pinning above is the fully-native, zero-additional-trust option
and is sufficient for a household device nobody is actively trying to break
out of.

---

## 4. Keep the screen awake while charging

Since this tablet will sit permanently plugged in as a control panel, you
want the screen to never sleep while charging. There are two ways to do this,
and they are **not equally reliable** — use the first one if at all possible.

### Reliable method: Developer Options → "Stay awake"

This setting keeps the screen on indefinitely as long as the tablet is
plugged into power, overriding the normal screen-timeout setting entirely.

1. Open **Settings → About tablet → Software information**.
2. Tap **Build number** **7 times in a row**. You'll see a countdown toast
   after a few taps ("You are now X steps away from being a developer") and
   then "Developer mode has been enabled."
3. Go back to the main **Settings** screen — a new entry, **Developer
   options**, now appears (usually under **Settings → Developer options**, or
   nested under **Settings → General management → Developer options**
   depending on the One UI 6.1 build).
4. Open **Developer options** and turn on **Stay awake** (sometimes labeled
   "Stay awake while charging"). It sits near the top of the list, under the
   "Debugging" section header is not required — this toggle is separate from
   USB debugging and you don't need to enable anything else in this menu.

### Simpler but weaker fallback: Screen timeout

If you'd rather not enable Developer Options, go to **Settings → Display →
Screen timeout** and set it to its maximum value (typically 10 minutes on
this build). This is **not the same guarantee**: it only delays sleep by a
fixed timer restarted on every touch, so the screen still goes dark after that
many minutes of no interaction — inconvenient for a wall-mounted dashboard
meant to be glanced at, not touched constantly. "Stay awake while charging"
instead ties the screen state directly to charging status, which is what you
actually want for a permanently-docked device. Use the Developer Options
method if you can.

---

## 5. Reducing One UI background activity

Samsung's battery management (One UI's "Adaptive Battery" / app-sleeping
system) is one of the most common reasons a PWA on a Samsung device silently
drops its connection or stops updating in the background — Samsung is
historically more aggressive here than stock Android. Since the dashboard
needs to keep a live WebSocket connection open to the PC, exempt it from this
behavior explicitly. All of the following are ordinary Settings toggles —
**none of this involves ADB, `pm uninstall`, or root**.

### 5.1 Exempt the dashboard from battery restrictions

1. **Settings → Apps → Chrome** (the installed PWA runs inside Chrome's app
   entry, since it has no separate system app of its own — this is normal for
   PWAs and also governs the "Launchpad" home-screen shortcut).
2. Tap **Battery**.
3. Change it from "Optimized"/"Restricted" to **Unrestricted**.
4. Separately, go to **Settings → Battery and device care → Battery → Background
   usage limits**, check the **"Sleeping apps"** and **"Deep sleeping apps"**
   lists, and if Chrome ever appears there, remove it. This is the specific
   Adaptive Battery mechanism referenced above — apps placed in "deep
   sleeping" have their background network/service activity suspended
   entirely, which is exactly what would silently break the dashboard's live
   stats/now-playing updates.

### 5.2 Reduce competing background activity from what's actually installed

This tablet ships with the usual Samsung/Google/carrier app set. You don't
need to (and per §9, shouldn't) remove any of it — but since it's a dedicated
kiosk, not a general-use tablet, it's reasonable to turn off background
activity/notifications for apps that have no role in the kiosk's job. Do this
per-app via **Settings → Apps → [app name] → Notifications** (turn off) and
**Battery** (set to Restricted, not Unrestricted — the opposite of what you
did for Chrome above), never by uninstalling. Concrete candidates that were
actually confirmed present on this tablet's package list (pulled via
`adb shell pm list packages`):

- **Samsung Free** (`com.samsung.android.app.spage`) — the news/briefing feed
  panel; safe to restrict, it's a content-fetching background service with no
  role here.
- **Bixby voice wake-up** (`com.samsung.android.intellivoiceservice`) and
  **Bixby routines backend** (`com.samsung.android.rubin.app`) — Bixby isn't
  used by this kiosk; restricting these stops background wake-word listening
  and routine evaluation.
- **Smart Switch** (`com.samsung.android.smartswitchassistant`,
  `com.sec.android.easyMover`, `com.sec.android.easyMover.Agent`) — only
  relevant during a one-time device migration, not ongoing use.
- **Galaxy Store** (`com.sec.android.app.samsungapps`) and **Samsung Cloud**
  (`com.samsung.android.scloud`) — background sync/update-check services with
  no kiosk purpose.
- **Game Booster / Game Home** (`com.samsung.android.game.gos`,
  `com.samsung.android.game.gamehome`) — irrelevant on a dashboard tablet.
- **Yana / Samsung Free content service** (`de.axelspringer.yana.zeropage`) —
  the background news-briefing content provider that feeds Samsung Free;
  restrict alongside it.
- **Spotify** (`com.spotify.music`), **Instagram** (`com.instagram.android`),
  **Microsoft OneDrive** (`com.microsoft.skydrive`), and **Google
  Duo/Meet** (`com.google.android.apps.tachyon`) — these came preinstalled on
  this unit but aren't part of the kiosk workflow; restrict background
  activity/notifications for whichever of these you don't personally use on
  this tablet.

Two things worth noting from the actual package dump, since they change what
you need to worry about here: this tablet's package list does **not** include
Samsung Pay/Wallet or Samsung Health, so there's no need for guidance on
either — they're simply not installed on this unit. The Knox-family packages
present (`com.samsung.android.knox.*`, `com.samsung.klmsagent`,
`com.skms.android.agent`) are core OS-level device-management/DRM
infrastructure baked into One UI itself, not user-facing bloat you can (or
should) touch — leave those alone entirely.

---

## 6. Auto-reopening the dashboard after a restart

Be aware of a real limitation here: **stock Android/One UI has no built-in
"launch this app on boot" feature**, and App Pinning (§3) does not survive a
reboot either — after any restart, the tablet boots to the lock screen like
normal, unpinned, and nothing reopens automatically. This is a genuine
platform gap, not something this guide is glossing over.

What you *can* get natively, with no extra app:

- If the tablet is left unlocked (no PIN/pattern/biometric lock — reasonable
  for a wall-mounted household device that isn't leaving the house) and the
  Launchpad icon is on the home screen, reopening after a restart is a single
  tap on the icon — no re-pairing needed, since pairing tokens persist across
  restarts.
- You can also long-press the Launchpad icon and add it to whichever home
  screen page is shown first / set it as part of the default launcher's
  "favorites" tray, so it's the very first thing tappable after the lock
  screen.
- After reopening, just re-apply the App Pinning step from §3 if you want the
  lockdown behavior back — it only takes a few seconds.

Genuinely automatic relaunch-on-boot (no tap required at all) is **not**
achievable on stock Android without either a third-party "autostart on boot"
helper app from the Play Store, or a full kiosk-launcher/MDM app of the kind
flagged as optional/advanced in §3 (some of those bundle boot-launch as part
of their device-admin feature set). Same tradeoff applies here: it's a real
option, but it's your call whether the added app/permission is worth it for
this convenience, since power outages/restarts should be infrequent on a
tablet that's otherwise just sitting plugged in.

---

## 7. Consolidated settings checklist

Quick reference — every toggle from this guide in one place:

- [ ] **Settings → Security and privacy → More security settings → App
      pinning** → On, with "Ask for PIN before unpinning" also On (§3)
- [ ] **Settings → About tablet → Software information → Build number**,
      tapped 7×, to unlock Developer options (§4)
- [ ] **Settings → Developer options → Stay awake** → On (§4)
- [ ] **Settings → Apps → Chrome → Battery** → Unrestricted (§5.1)
- [ ] **Settings → Battery and device care → Battery → Background usage
      limits → Sleeping apps / Deep sleeping apps** → confirm Chrome is not
      listed (§5.1)
- [ ] **Settings → Apps → [Samsung Free / Bixby / Smart Switch / Galaxy
      Store / Samsung Cloud / Game Booster / unused preinstalled apps] →
      Battery** → Restricted, and **Notifications** → Off, per §5.2
- [ ] Launchpad icon installed via **Chrome → Install app** and placed on the
      home screen (§2)

---

## 8. How to leave kiosk mode safely

If the tablet is pinned (§3) and you need to get back to normal Android —
to change a setting, restart the app, or hand the tablet to someone for a
different purpose — here's the exact, always-available way out. It never
requires a factory reset or any recovery-mode step.

1. **Gesture navigation** (default on this build): swipe up from the bottom
   of the screen and **hold** for about a second, until you feel/see the pin
   release.
2. **Button navigation** (if the tablet is set to use on-screen Back/Home/
   Recents buttons instead): press and hold **Back** and **Recents**
   together.
3. If "Ask for PIN before unpinning" is enabled (recommended in §3), you'll
   be prompted for the tablet's device PIN immediately after step 1 or 2 —
   enter it to complete the unpin.
4. You're now back at the normal Recents/Home screen with full navigation
   restored. Nothing about the dashboard app itself is affected — reopening
   it and re-pinning (§3) takes a few seconds whenever you want kiosk mode
   back.

---

## 9. What NOT to do

This tablet should stay on **stock, non-rooted Android 14 / One UI 6.1** for
its entire life as a kiosk. Specifically, don't:

- **Root the device or unlock the bootloader.** Rooting disables Samsung
  Knox's hardware-backed security fuse **permanently and irreversibly** (Knox
  trips a physical `e-fuse` the moment the bootloader is unlocked) — this
  isn't just a warranty issue, it also permanently disables Samsung Pay,
  Secure Folder, and several DRM/attestation-backed features even if you
  never plan to use them, and meaningfully raises the risk of bricking the
  tablet entirely if anything goes wrong mid-process, with no factory-support
  path back.
- **Run `adb uninstall` / `pm uninstall` against system packages**, or any
  third-party "debloater" script that does the same. Many of the Samsung
  system packages in this tablet's package list (Knox components, `com.sec.*`
  service daemons, `android.auto_generated_rro_*` overlay packages) are load-
  bearing for One UI's normal operation even when they look like bloat by
  name — removing the wrong one via `pm uninstall --user 0` can break Settings,
  the launcher, or Wi-Fi in ways that are difficult to diagnose and sometimes
  require a factory reset to fix. Everything achievable in §5 above is
  achievable more safely via ordinary Settings toggles (restrict/disable),
  which are reversible with a single tap and don't touch the underlying
  package at all.
- **Disable system-critical services** (anything under Settings you don't
  recognize outside the apps explicitly named in §5.2) on the theory that it
  might help performance or battery life. The 3 GB of RAM on this model is
  the constraint that matters for a single always-open PWA, and that's
  addressed by the battery/background steps above — guessing at deeper
  system service changes risks the same kind of hard-to-diagnose breakage as
  uninstalling system packages, for no meaningful benefit on a device whose
  only real job is displaying one dashboard.

In short: everything this device needs to do — stay awake, stay connected,
open one app in a locked-down way, ignore background bloat — is achievable
through supported, reversible Settings toggles. There's no task in this guide
that requires root, an unlocked bootloader, or system-package removal, so
there's no reason to accept that risk here.
