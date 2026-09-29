// Establish a cache name
const cacheName = "0.0.6";

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
  "./assets/logo/logo.svg",
  "./assets/screenshots/desktop.png",
  "./assets/screenshots/mobile.png",
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
