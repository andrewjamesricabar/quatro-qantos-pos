const CACHE_NAME = "qq-pos-cache-v2";

const CORE_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./Images/QQ Logo.jpg"
];

// App-shell files change often as the app gets updated, so they must always be
// re-checked against the network — a cache-first strategy here would freeze
// the app on whatever version happened to be cached on first install, with no
// way for it to ever pick up a later update.
const NETWORK_FIRST_PATHS = ["/index.html", "/app.js", "/styles.css", "/manifest.json", "/"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

function isNetworkFirst(url) {
  return NETWORK_FIRST_PATHS.some((path) => url.pathname === path || url.pathname.endsWith(path));
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  if (isNetworkFirst(url)) {
    // Network-first: always try to get the latest app code; fall back to the
    // last cached copy only when actually offline.
    event.respondWith(
      fetch(event.request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first for everything else (menu photos, etc.) — these rarely change
  // and benefit from not being re-fetched every time.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      }).catch(() => cached);
    })
  );
});
