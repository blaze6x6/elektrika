/* Service worker za Štrom poraba.
 * - Omogoča namestitev (PWA) in zaslon "ni povezave".
 * - NE predpomni API-jev ne strani z osebnimi podatki: vse, kar je za prijavo, gre vedno na omrežje.
 * - Predpomni samo statične, neodvisne datoteke (/_next/static, /icons, offline.html).
 * Ob spremembi te datoteke povišaj VERSION. */
const VERSION = "v3";
const CACHE = `strom-static-${VERSION}`;
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png"];

/* fetch z do 3 poskusi: prehodne omrežne napake (zastarela povezava, zbujanje Wi-Fi-ja)
 * ne smejo takoj pripeljati do offline strani. */
async function fetchRetry(req) {
  let lastError;
  for (let i = 0; i < 3; i++) {
    try {
      return await fetch(req);
    } catch (err) {
      lastError = err;
      if (i < 2) await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastError;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // allSettled: če en vir ni dosegljiv (npr. preusmeritev na prijavo), se SW vseeno namesti
      await Promise.allSettled(PRECACHE.map((u) => cache.add(u)));
      await self.skipWaiting();
    })()
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

  // Navigacija: vedno omrežje (z ponovnimi poskusi); če ga ni, prikaži stran "ni povezave".
  if (req.mode === "navigate") {
    event.respondWith(
      fetchRetry(req).catch(async () => {
        const cached = await caches.match(OFFLINE_URL);
        return (
          cached ||
          new Response("<h1>Ni povezave</h1>", {
            status: 503,
            headers: { "content-type": "text/html; charset=utf-8" },
          })
        );
      })
    );
    return;
  }

  // Statične datoteke z vsebinskim zgoščevanjem v imenu: najprej predpomnilnik.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetchRetry(req).then((res) => {
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
