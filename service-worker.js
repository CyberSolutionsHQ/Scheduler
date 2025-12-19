/* service-worker.js
   Simple offline cache for Cyber Solutions LLC Schedule Manager
*/

const CACHE_NAME = "csm-schedule-manager-cache-v7";

const ASSETS = [
  "./",
  "./login.html",
  "./index.html",
  "./dashboard.html",
  "./employees.html",
  "./job-sites.html",
  "./schedule.html",
  "./my-shifts.html",
  "./requests.html",
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
  "./assets/pdf.js",
  "./js/supabaseClient.js",
  "./js/auth.js",
  "./js/ui.js",
  "./js/date.js",
  "./js/pages/index.js",
  "./js/pages/login.js",
  "./js/pages/dashboard.js",
  "./js/pages/employees.js",
  "./js/pages/job-sites.js",
  "./js/pages/schedule.js",
  "./js/pages/my-shifts.js",
  "./js/pages/requests.js"
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
  if (new URL(req.url).pathname.endsWith("/js/config.js")) {
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
