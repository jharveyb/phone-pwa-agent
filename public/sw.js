// Service worker: asset caching only. Stale-while-revalidate for the 34 MB tailscale wasm (first fetch over the
// tailnet takes minutes; a rebuilt wasm is picked up on the *next* reload, or purge with scripts/phone-reload.sh --purge).
// Network for everything else. No offline app shell, no interception of the agent's traffic.
const CACHE = "phone-agent-assets-v1";
self.addEventListener("install", () => { self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(self.clients.claim()); });
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || !url.pathname.endsWith("main.wasm")) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(e.request);
    const refresh = fetch(e.request).then((res) => { if (res.ok) cache.put(e.request, res.clone()); return res; });
    if (hit) { e.waitUntil(refresh.catch(() => {})); return hit; }
    return refresh;
  })());
});
