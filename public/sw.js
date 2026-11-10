// Lets Nomol start without internet in the hall: every successful GET (app, MediaPipe WASM and
// pose model from their CDNs) is cached, and the cache is used when the network fails.
// Network first, so new deploys and model updates arrive whenever there is a connection.
const CACHE = 'nomol-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// The first visit loads before this worker takes over, so the page sends what it already loaded.
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'cache') return;
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(
        event.data.urls
          .filter((url) => url.startsWith('http'))
          .map(async (url) => (await cache.match(url)) || cache.add(url).catch(() => {})),
      ),
    ),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || !request.url.startsWith('http')) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const response = await fetch(request);
        // Partial (range) responses can't be cached.
        if (response.status === 200 || response.type === 'opaque') {
          await cache.put(request, response.clone());
        }
        return response;
      } catch (error) {
        const cached = await cache.match(request);
        if (cached) return cached;
        throw error;
      }
    })(),
  );
});
