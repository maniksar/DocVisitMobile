const cacheName = 'docvisitmobile-static-v1';
const staticAssetPattern = /\.(?:css|js|png|svg|webp|webmanifest|woff2?)$/i;

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key.startsWith('docvisitmobile-') && key !== cacheName).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);
  if (
    event.request.method !== 'GET' ||
    requestUrl.origin !== self.location.origin ||
    requestUrl.pathname.startsWith('/api/') ||
    !staticAssetPattern.test(requestUrl.pathname)
  ) {
    return;
  }

  event.respondWith((async () => {
    let response;
    try {
      response = await fetch(event.request);
    } catch (error) {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      throw error;
    }

    if (response.ok && response.type === 'basic') {
      try {
        const cache = await caches.open(cacheName);
        await cache.put(event.request, response.clone());
      } catch (error) {
        console.error('DocVisitMobile static asset cache failed:', error);
      }
    }
    return response;
  })());
});
