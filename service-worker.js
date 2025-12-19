/* service-worker.js
   Simple offline cache for Cyber Solutions LLC Schedule Manager
*/

const CACHE_NAME = "csm-schedule-manager-cache-v6";

const ASSETS = [
  "./",
  "./login.html",
  "./index.html",
  "./employees.html",
  "./locations.html",
  "./jobs.html",
  "./shifts.html",
  "./crews.html",
  "./export.html",
  "./users.html",
  "./settings.html",
  "./account.html",
  "./employee-requests.html",
  "./print.html",
  "./my-schedule.html",
  "./admin.html",
  "./manifest.json",
  "./service-worker.js",
  "./assets/styles.css",
  "./assets/config.example.js",
  "./assets/store.js",
  "./assets/app.js",
  "./assets/pdf.js"
];

// Install: cache core assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Activate: cleanup old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => (k !== CACHE_NAME ? caches.delete(k) : null)))
    )
  );
  self.clients.claim();
});

// Fetch: cache-first, fallback to network, then fallback to cache
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only handle GET
  if (req.method !== "GET") return;

  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;

      return fetch(req).then(res => {
        // Cache successful responses
        const copy = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
        return res;
      }).catch(() => caches.match("./index.html"));
    })
  );
});
