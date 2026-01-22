const CACHE_NAME = 'offline-cache-v44';
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
                                let results = countReq.result.d.results;

                                // Apply filters to count
                                const params = parsedUrl.searchParams;
                                const filter = params.get('$filter');

                                if (filter) {
                                    const substringMatch = /substringof\('([^']*)',\s*([a-zA-Z0-9_.]+)\)/.exec(filter);
                                    if (substringMatch) {
                                        const searchVal = substringMatch[1];
                                        const propName = substringMatch[2];
                                        results = results.filter(item => {
                                            return item[propName] && String(item[propName]).includes(searchVal);
                                        });
                                    } else {
                                        results = [];
                                    }
                                }

                                countVal = results.length;
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

                            let data = getRequest.result;

                            // Check if we need to apply OData system query options ($skip, $top, $select)
                            // We only apply this if it looks like a collection (has d.results array)
                            if (data && data.d && Array.isArray(data.d.results)) {
                                let results = [...data.d.results]; // Clone array

                                const params = parsedUrl.searchParams;
                                const skip = parseInt(params.get('$skip') || '0', 10);
                                const top = parseInt(params.get('$top') || '0', 10);
                                const select = params.get('$select');
                                const filter = params.get('$filter');

                                // Apply $filter
                                if (filter) {
                                    // Parse filter once
                                    // Basic support for substringof('Value', Property)
                                    // Example: substringof('USER',Username) inside URL: $filter=substringof('USER',Username)
                                    // Regex allows for dots in property names e.g. To.Property
                                    const substringMatch = /substringof\('([^']*)',\s*([a-zA-Z0-9_.]+)\)/.exec(filter);
                                    
                                    if (substringMatch) {
                                        const searchVal = substringMatch[1];
                                        const propName = substringMatch[2];
                                        results = results.filter(item => {
                                            return item[propName] && String(item[propName]).includes(searchVal);
                                        });
                                    } else {
                                        // If filter is provided but we can't parse it (or it's not substringof),
                                        // we return NO results to avoid "leaking" all data when a filter was expected.
                                        console.warn('[SW] Unhandled $filter expression:', filter);
                                        results = [];
                                    }
                                }

                                // Apply $skip
                                if (skip > 0) {
                                    results = results.slice(skip);
                                }

                                // Apply $top
                                if (top > 0) {
                                    results = results.slice(0, top);
                                }

                                // Apply $select
                                if (select) {
                                    const fields = select.split(',').map(f => f.trim());
                                    results = results.map(item => {
                                        const newItem = {};
                                        // Keep metadata if exists
                                        if (item.__metadata) newItem.__metadata = item.__metadata;

                                        fields.forEach(field => {
                                            if (Object.prototype.hasOwnProperty.call(item, field)) {
                                                newItem[field] = item[field];
                                            }
                                        });
                                        return newItem;
                                    });
                                }

                                // Construct new response object
                                const responseData = {
                                    d: {
                                        results: results
                                    }
                                };
                                
                                resolve(new Response(JSON.stringify(responseData), {
                                    headers: { 'Content-Type': 'application/json' }
                                }));
                            } else {
                                resolve(new Response(JSON.stringify(getRequest.result), {
                                    headers: { 'Content-Type': 'application/json' }
                                }));
                            }
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
