const CACHE_NAME = 'offline-cache-v11';
const URLS_TO_CACHE = [
    'index.html',
    'pwamanifest.json',
    'resources/sap-ui-version.json'
];

self.addEventListener('install', (event) => {
    // Remove skipWaiting to allow user to confirm update
    // self.skipWaiting(); 

    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('Opened cache');
            return cache.addAll(URLS_TO_CACHE);
        })
    );
});

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

self.addEventListener('activate', (event) => {
    // Delete old caches and take control
    event.waitUntil(
        Promise.all([
            self.clients.claim(),
            caches.keys().then((cacheKeys) => {
                return Promise.all(
                    cacheKeys.map((key) => {
                        // Only delete caches that start with 'offline-cache-' and are not the current cache
                        if (key.startsWith('offline-cache-') && key !== CACHE_NAME) {
                            console.log('Deleting old cache:', key);
                            return caches.delete(key);
                        }
                    })
                );
            })
        ])
    );
});

self.addEventListener('fetch', (event) => {
    // 1. Navigation requests (HTML pages) -> Network first, fall back to Cache, then Offline Page
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request).catch(async () => {
                const cache = await caches.open(CACHE_NAME);
                const cachedResponse = await cache.match(event.request);
                if (cachedResponse) {
                    return cachedResponse;
                }
            })
        );
        return;
    }

    // 2. UI5 Resources -> Cache First, falling back to network
    // We use Cache First here for performance and offline capability.
    // Ideally, we'd version the cache or use Stale-While-Revalidate, 
    // but Cache First is safer for "fully offline" requirements.
    if (event.request.url.includes('/resources/') || 
        event.request.url.includes('/test-resources/')) {
        event.respondWith(
            caches.open(CACHE_NAME).then((cache) => {
                return cache.match(event.request).then((response) => {
                    return response || fetch(event.request).then((networkResponse) => {
                        cache.put(event.request, networkResponse.clone());
                        return networkResponse;
                    });
                });
            })
        );
        return;
    }

    // 3. Application files (Component.js, Views, Controllers, manifest.json, etc.)
    // We treat these like resources: Cache First or Stale-While-Revalidate.
    // This simple match handles all same-origin requests not already handled.
    event.respondWith(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.match(event.request).then((response) => {
                return response || fetch(event.request).then((networkResponse) => {
                    cache.put(event.request, networkResponse.clone());
                    return networkResponse;
                });
            });
        })
    );
});
