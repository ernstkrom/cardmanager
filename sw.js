// Establish a cache name
const cacheName = "0.0.10";

// Assets to precache, resolved relative to this script's own location so
// this works both at a domain root and under a GitHub Pages project path
// (e.g. https://user.github.io/repo-name/).
const precacheUrls = [
  "./",
  "./index.html",
  "./design.css",
  "./app.js",
  "./card-scan.js",
  "./long-press-event.js",
  "./worker.js",
  "./vendor/beercss/beer.min.css",
  "./vendor/beercss/beer.min.js",
  "./vendor/beercss/material-symbols-outlined.woff2",
  "./vendor/material-dynamic-colors/material-dynamic-colors.min.js",
  "./vendor/zxing/browser.js",
  "./vendor/zxing/library.js",
  "./vendor/zxing/ts-custom-error.js",
  "./manifest.json",
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
