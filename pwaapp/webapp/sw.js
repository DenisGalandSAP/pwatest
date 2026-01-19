const CACHE_NAME = 'offline-cache-v27';
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
                        if (key !== CACHE_NAME) {
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
    // Ignore chrome extensions and other non-http protocols
    if (!event.request.url.startsWith('http')) {
        return;
    }

    // Ignore non-GET requests (POST, PUT, DELETE, etc.)
    if (event.request.method !== 'GET') {
        return;
    }

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
    if (event.request.url.includes('/resources/')) {
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

    // Special handling for ZGP_DENUSER_SRV/zi_denuser to support offline from IndexedDB
    if (event.request.url.includes('/sap/opu/odata/sap/ZGP_DENUSER_SRV/zi_denuser')) {
        event.respondWith(
            fetch(event.request).catch(() => {
                return new Promise((resolve, reject) => {
                    const dbName = "pwaapp-db";
                    const storeName = "odata-store";
                    // match the key used in Component.ts: relative path might be tricky if sw sees full url.
                    // Component.ts used: "/sap/opu/odata/sap/ZGP_DENUSER_SRV/zi_denuser"
                    // Helper to get relative path matches or just use the known key
                    const key = "/sap/opu/odata/sap/ZGP_DENUSER_SRV/zi_denuser"; 
                    
                    // Open with version 2 to match Component.ts
                    const request = indexedDB.open(dbName, 2);
                    
                    request.onsuccess = (e) => {
                        const db = e.target.result;
                        // Check if store exists first
                        if (!db.objectStoreNames.contains(storeName)) {
                             // Fallback if db exists but store doesn't (weird state but possible)
                            resolve(new Response('{"d":{"results":[]}}', {
                                headers: { 'Content-Type': 'application/json' }
                            }));
                            return;
                        }

                        const transaction = db.transaction([storeName], "readonly");
                        const store = transaction.objectStore(storeName);
                        const getRequest = store.get(key);
                        
                        getRequest.onsuccess = () => {
                            if (getRequest.result) {
                                resolve(new Response(JSON.stringify(getRequest.result), {
                                    headers: { 'Content-Type': 'application/json' }
                                }));
                            } else {
                                // No data found, return empty result
                                resolve(new Response('{"d":{"results":[]}}', {
                                    headers: { 'Content-Type': 'application/json' }
                                }));
                            }
                        };
                        getRequest.onerror = () => {
                             resolve(new Response('{"d":{"results":[]}}', {
                                headers: { 'Content-Type': 'application/json' }
                            }));
                        };
                    };
                    
                    request.onerror = (e) => {
                         // DB open failed
                         resolve(new Response('{"d":{"results":[]}}', {
                                headers: { 'Content-Type': 'application/json' }
                        }));
                    };
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
