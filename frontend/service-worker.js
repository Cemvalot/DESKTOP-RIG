// frontend/service-worker.js
//
// Offline shell caching per reconciliation.md §1: caches the static app
// shell (HTML/CSS/JS/icons) so the tablet can show cached UI immediately
// after a network blip. Never caches live data — /api/* and the WS
// upgrade are always passed straight to the network.

const CACHE_NAME = "launchpad-shell-v26";

const SHELL_FILES = [
  "./",
  "./index.html",
  "./manifest.json",
  "./assets/icon.svg",
  "./assets/apps/steam.png",
  "./assets/apps/discord.png",
  "./assets/apps/browser.png",
  "./assets/apps/spotify.png",
  "./assets/apps/youtube.png",
  "./assets/apps/netflix.png",
  "./assets/apps/terminal.png",
  "./assets/apps/codex.png",
  "./assets/apps/claude.ico",
  "./assets/apps/chatgpt.png",
  "./src/app.js",
  "./src/styles/tokens.css",
  "./src/styles/base.css",
  "./src/styles/components.css",
  "./src/styles/screens.css",
  "./src/data/provider.js",
  "./src/data/mockProvider.js",
  "./src/data/liveProvider.js",
  "./src/data/index.js",
  "./src/data/seed/apps.json",
  "./src/data/seed/links.json",
  "./src/data/seed/maintenance.json",
  "./src/data/seed/games.json",
  "./src/data/seed/profiles.json",
  "./src/data/seed/smarthome.json",
  "./src/data/seed/service.json",
  "./src/state/store.js",
  "./src/state/commands.js",
  "./src/components/dom.js",
  "./src/components/icons.js",
  "./src/components/feedback.js",
  "./src/components/toast.js",
  "./src/components/confirmDialog.js",
  "./src/components/tile.js",
  "./src/components/statusCard.js",
  "./src/components/editLayout.js",
  "./src/components/navTabs.js",
  "./src/components/statusStrip.js",
  "./src/components/connectionOverlay.js",
  "./src/components/idleScreen.js",
  "./src/components/pairingScreen.js",
  "./src/components/settingsPanel.js",
  "./src/components/historyDrawer.js",
  "./src/screens/home.js",
  "./src/screens/gaming.js",
  "./src/screens/media.js",
  "./src/screens/system.js",
  "./src/screens/smarthome.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isLiveDataRequest(url) {
  return url.pathname.startsWith("/api/") || url.pathname === "/ws" || url.pathname.startsWith("/ws");
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || isLiveDataRequest(url)) {
    return; // let the network handle live data / non-GET / cross-origin as normal
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((res) => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return res;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
