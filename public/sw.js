/* Service worker za Štrom poraba.
 * - Omogoča namestitev (PWA) in zaslon "ni povezave".
 * - NE predpomni API-jev ne strani z osebnimi podatki: vse, kar je za prijavo, gre vedno na omrežje.
 * - Predpomni samo statične, neodvisne datoteke (/_next/static, /icons, offline.html).
 * Ob spremembi te datoteke povišaj VERSION. */
const VERSION = "v1";
const CACHE = `strom-static-${VERSION}`;
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("strom-static-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigacija: vedno omrežje; če ga ni, prikaži stran "ni povezave".
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match(OFFLINE_URL).then((r) => r || new Response("Ni povezave", { status: 503 })))
    );
    return;
  }

  // Statične datoteke z vsebinskim zgoščevanjem v imenu: najprej predpomnilnik.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          })
      )
    );
  }
  // Vse ostalo (API, podatki, strani) gre mimo service workerja.
});
