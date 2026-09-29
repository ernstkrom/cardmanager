// Establish a cache name
const cacheName = "0.0.1";

// Assets to precache
const precachedAssets = [
  "/",
  "/index.html",
  "/design.css",
  "/app.js",
  "/long-press-event.js",
  "/toastify.css",
  "/toastify.js",
  "/assets/logo/logo.svg",
  "/assets/screenshots/desktop.png",
  "/assets/screenshots/mobile.png",
];

self.addEventListener("install", (event) => {
  // Precache assets on install
  event.waitUntil(
    caches.open(cacheName).then((cache) => {
      return cache.addAll(precachedAssets);
    })
  );
});

self.addEventListener("fetch", (event) => {
  // Is this one of our precached assets?
  const url = new URL(event.request.url);
  const isPrecachedRequest = precachedAssets.includes(url.pathname);

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
