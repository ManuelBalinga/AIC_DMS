const CACHE = "aic-docs-shell-v1";
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const offlinePage = await fetch("/offline");
    if (!offlinePage.ok) throw new Error("Could not cache the offline shell.");
    await cache.put("/offline", offlinePage.clone());
    await cache.add("/manifest.webmanifest");

    // `cache.add('/offline')` stores only the HTML, not the page-specific JS
    // referenced by it. Discover those immutable build assets now so the first
    // offline visit works even if the reader never opened /offline while online.
    const html = await offlinePage.text();
    const assets = new Set(
      [...html.matchAll(/(?:src|href)="([^"?#]*\/_next\/static\/[^"?#]+)"/g)]
        .map((match) => match[1]),
    );
    await Promise.all([...assets].map((asset) => cache.add(asset)));
  })());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;

  // Authenticated pages, APIs and signed document URLs must never enter this
  // cache. Document bytes live only in the per-user IndexedDB lease store.
  const cacheable = url.pathname === "/offline" || url.pathname === "/manifest.webmanifest" || url.pathname.startsWith("/_next/static/");
  if (!cacheable) return;

  event.respondWith(
    caches.match(url.pathname === "/offline" ? "/offline" : event.request).then((cached) => cached || fetch(event.request).then((response) => {
      if (response.ok) caches.open(CACHE).then((cache) => cache.put(event.request, response.clone()));
      return response;
    })),
  );
});
