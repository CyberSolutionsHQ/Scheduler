/* service-worker.js
   Simple offline cache for Cyber Solutions LLC Schedule Manager
*/

const CACHE_NAME = "csm-schedule-manager-cache-v8";

const ASSETS = [
  "./",
  "./account.html",
  "./employees.html",
  "./crews.html",
  "./change-pin.html",
  "./dashboard.html",
  "./employee-requests.html",
  "./export.html",
  "./index.html",
  "./job-sites.html",
  "./jobs.html",
  "./locations.html",
  "./login.html",
  "./my-schedule.html",
  "./my-shifts.html",
  "./print.html",
  "./requests.html",
  "./schedule.html",
  "./settings.html",
  "./shifts.html",
  "./users.html",
  "./admin.html",
  "./manifest.json",
  "./service-worker.js",
  "./assets/styles.css"
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

  // Always fetch config fresh (deploy-time setting). Do not allow stale SW cache.
  const path = new URL(req.url).pathname || "";
  if (path.endsWith("/runtime-config.js")) {
    event.respondWith(fetch(req, { cache: "no-store" }));
    return;
  }

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
