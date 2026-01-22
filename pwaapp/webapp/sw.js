const CACHE_NAME = 'offline-cache-v40';
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
        
        // Helper function to query IndexedDB
        const getFromDB = () => {
            return new Promise((resolve, reject) => {
                console.log('[SW] Attempting to retrieve from IndexedDB for:', event.request.url);
                const dbName = "pwaapp-db";
                const storeName = "odata-store";
                
                // Derive the key from the request URL path.
                // Decode URI component to handle encoded characters in URL if any
                const parsedUrl = new URL(event.request.url);
                let key = decodeURIComponent(parsedUrl.pathname);
                
                console.log('[SW] Original Key extracted:', key);

                // Start: Fix path prefix issue
                // The key stored in IndexedDB is "/sap/opu/odata/..." (from Component.ts)
                // references: requestUrl = "/sap/opu/odata/sap/ZGP_DENUSER_SRV/zi_denuser";
                // But the SW might see "/pwaapp/sap/opu/odata/..." depending on deployment.
                // We normalize the key to start with "/sap/".
                const sapIndex = key.indexOf('/sap/');
                if (sapIndex >= 0) {
                    key = key.substring(sapIndex);
                    console.log('[SW] Normalized Key to:', key);
                } else {
                     console.log('[SW] No /sap/ prefix found in key.');
                }
                // End: Fix path prefix issue
                
                const request = indexedDB.open(dbName, 3);
                
                request.onsuccess = (e) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains(storeName)) {
                        console.warn('[SW] Object store not found:', storeName);
                        resolve(new Response('{"d":{"results":[]}}', {
                            headers: { 'Content-Type': 'application/json' }
                        }));
                        return;
                    }

                    const transaction = db.transaction([storeName], "readonly");
                    const store = transaction.objectStore(storeName);

                    // Special handling for $count (counting the array in the parent entity)
                    if (key.endsWith('/$count')) {
                        console.log('[SW] Intercepted $count request');
                        // Remove '/$count' to find the collection key
                        // "key" is already normalized to start with /sap/...
                        const collectionKey = key.substring(0, key.length - 7); 
                        
                        const countReq = store.get(collectionKey);
                        countReq.onsuccess = () => {
                            let countVal = 0;
                            if (countReq.result && countReq.result.d && Array.isArray(countReq.result.d.results)) {
                                countVal = countReq.result.d.results.length;
                            }
                            console.log('[SW] Returning offline count:', countVal);
                            resolve(new Response(countVal.toString(), {
                                headers: { 'Content-Type': 'text/plain' }
                            }));
                        };
                        countReq.onerror = () => {
                            // If fail, return 0
                             resolve(new Response('0', {
                                headers: { 'Content-Type': 'text/plain' }
                            }));
                        };
                        return;
                    }

                    const getRequest = store.get(key);
                    
                    getRequest.onsuccess = () => {
                        if (getRequest.result) {
                            console.log('[SW] Data found in IndexedDB for key:', key);
                            resolve(new Response(JSON.stringify(getRequest.result), {
                                headers: { 'Content-Type': 'application/json' }
                            }));
                        } else {
                            console.warn('[SW] No data found in IndexedDB for key:', key);
                            resolve(new Response('{"d":{"results":[]}}', {
                                headers: { 'Content-Type': 'application/json' }
                            }));
                        }
                    };
                    getRequest.onerror = (err) => {
                        console.error('[SW] IndexedDB get error:', err);
                        resolve(new Response('{"d":{"results":[]}}', {
                            headers: { 'Content-Type': 'application/json' }
                        }));
                    };
                };
                
                request.onerror = (e) => {
                    console.error('[SW] IndexedDB open error:', e);
                    resolve(new Response('{"d":{"results":[]}}', {
                        headers: { 'Content-Type': 'application/json' }
                    }));
                };
            });
        };

        // If explicitly offline, go straight to DB
        // User Requirement: Strict separation. 
        // If Online -> Network only (no fallback to DB to avoid "mixed" signals or stale data if backend fails).
        // If Offline -> DB only.
        if (!navigator.onLine) {
             console.log('[SW] Offline detected, fetching from DB...');
             event.respondWith(getFromDB());
        } else {
             // Online mode: Go to network.
             // If this fails, we let it fail, ensuring we don't serve cached/DB data while "Online".
             console.log('[SW] Online mode detected, forwarding to network:', event.request.url);
             event.respondWith(
                fetch(event.request).then(response => {
                    console.log('[SW] Network request successful');
                    return response;
                })
            );
        }
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
