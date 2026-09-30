// Establish a cache name
const cacheName = "0.0.27";

// Assets to precache, resolved relative to this script's own location so
// this works both at a domain root and under a GitHub Pages project path
// (e.g. https://user.github.io/repo-name/).
const precacheUrls = [
  "./",
  "./index.html",
  "./design.css",
  "./app.js",
  "./card-scan.js",
  "./image-editor.js",
  "./assets/vendor/long-press-event/long-press-event.js",
  "./worker.js",
  "./assets/vendor/beercss/beer.min.css",
  "./assets/vendor/beercss/beer.min.js",
  "./assets/vendor/beercss/material-symbols-outlined.woff2",
  "./assets/vendor/material-dynamic-colors/material-dynamic-colors.min.js",
  "./assets/vendor/zxing/browser.js",
  "./assets/vendor/zxing/library.js",
  "./assets/vendor/zxing/ts-custom-error.js",
  "./manifest.json",
  "./LICENSE",
  "./assets/vendor/beercss/LICENSE",
  "./assets/vendor/beercss/LICENSE-material-symbols",
  "./assets/vendor/material-dynamic-colors/LICENSE",
  "./assets/vendor/material-dynamic-colors/LICENSE-material-color-utilities",
  "./assets/vendor/zxing/LICENSE-zxing-browser",
  "./assets/vendor/zxing/LICENSE-zxing-library",
  "./assets/vendor/zxing/LICENSE-ts-custom-error",
  "./assets/vendor/long-press-event/LICENSE",
  "./assets/logo/logo.svg?v=2",
  "./assets/logo/favicon.png?v=2",
  "./assets/logo/apple-touch-icon.png?v=2",
  "./assets/logo/icon-192.png",
  "./assets/logo/icon-512.png",
  "./assets/logo/icon-maskable-192.png",
  "./assets/logo/icon-maskable-512.png",
].map((path) => new URL(path, self.location).href);

self.addEventListener("install", (event) => {
  // Activate a new version right away instead of waiting for every tab to
  // close, otherwise the old cached app.js keeps being served after updates
  self.skipWaiting();

  // Precache assets on install
  event.waitUntil(
    caches.open(cacheName).then((cache) => {
      return cache.addAll(precacheUrls);
    })
  );
});

self.addEventListener("activate", (event) => {
  // Drop caches from older versions of this service worker
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== cacheName).map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  // Is this one of our precached assets?
  const isPrecachedRequest = precacheUrls.includes(event.request.url);

  if (isPrecachedRequest) {
    // Grab the precached asset from the cache
    event.respondWith(
      caches.open(cacheName).then((cache) => {
        return cache.match(event.request.url);
      })
    );
  } else {
    // Go to the network
    return;
  }
});
