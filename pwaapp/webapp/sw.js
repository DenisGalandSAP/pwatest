const CACHE_NAME = 'offline-cache-v55';
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
                    cacheKeys.map(async (key) => {
                        if (key !== CACHE_NAME && key.startsWith('offline-cache-')) {
                            console.log('Migrating resources from old cache:', key);
                            try {
                                const oldCache = await caches.open(key);
                                const newCache = await caches.open(CACHE_NAME);
                                const requests = await oldCache.keys();
                                await Promise.all(requests.map(async (request) => {
                                    if (request.url.includes('/resources/')) {
                                        const response = await oldCache.match(request);
                                        if (response) {
                                            await newCache.put(request, response);
                                        }
                                    }
                                }));
                            } catch (error) {
                                console.error('Migration failed:', error);
                            }
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
                const applyODataFilter = (data, filterStr) => {
                    if (!filterStr) return data;

                    const tokenize = (str) => {
                        const tokens = [];
                        let i = 0;
                        while (i < str.length) {
                            const char = str[i];
                            if (/\s/.test(char)) { i++; continue; }
                            if (['(', ')', ','].includes(char)) { tokens.push({ type: 'PUNCTUATION', value: char }); i++; continue; }
                            if (char === "'") {
                                let val = ""; i++;
                                while (i < str.length) {
                                    if (str[i] === "'" && str[i + 1] === "'") { val += "'"; i += 2; }
                                    else if (str[i] === "'") { i++; break; }
                                    else { val += str[i]; i++; }
                                }
                                tokens.push({ type: 'STRING', value: val });
                                continue;
                            }
                            if (/[\d\-]/.test(char)) {
                                let val = char; i++;
                                while (i < str.length && /[\d\.]/.test(str[i])) { val += str[i]; i++; }
                                tokens.push({ type: 'NUMBER', value: parseFloat(val) });
                                continue;
                            }
                            if (/[a-zA-Z_]/.test(char)) {
                                let val = char; i++;
                                while (i < str.length && /[a-zA-Z0-9_\./]/.test(str[i])) { val += str[i]; i++; }
                                const kws = ['eq', 'ne', 'gt', 'ge', 'lt', 'le', 'and', 'or', 'not', 'null', 'true', 'false'];
                                tokens.push({ type: kws.includes(val.toLowerCase()) ? 'KEYWORD' : 'IDENTIFIER', value: val });
                                continue;
                            }
                            i++;
                        }
                        return tokens;
                    };

                    const parse = (tokens) => {
                        let pos = 0;
                        const peek = () => tokens[pos];
                        const consume = () => tokens[pos++];

                        const parsePrimary = () => {
                            const t = peek();
                            if (!t) throw new Error("Unexpected end");
                            if (t.type === 'PUNCTUATION' && t.value === '(') {
                                consume(); const expr = parseExpression(); consume(); return expr;
                            }
                            if (t.type === 'STRING' || t.type === 'NUMBER') { consume(); return { type: 'LITERAL', value: t.value }; }
                            if (t.type === 'KEYWORD' && (t.value === 'true' || t.value === 'false')) { consume(); return { type: 'LITERAL', value: t.value === 'true' }; }
                            if (t.type === 'KEYWORD' && t.value === 'null') { consume(); return { type: 'LITERAL', value: null }; }
                            if (t.type === 'IDENTIFIER') {
                                const name = consume().value;
                                if (peek() && peek().type === 'PUNCTUATION' && peek().value === '(') {
                                    consume(); const args = [];
                                    if (peek().value !== ')') {
                                        while (true) { args.push(parseExpression()); if (peek().value === ')') break; if (peek() && peek().value === ',') consume(); else break; }
                                    }
                                    consume(); return { type: 'CALL', method: name, args };
                                }
                                return { type: 'PROPERTY', name };
                            }
                            if (t.type === 'KEYWORD' && t.value === 'not') { consume(); return { type: 'UNARY', operator: 'not', right: parsePrimary() }; }
                            throw new Error("Unknown token");
                        };

                        const parseComparison = () => {
                            let left = parsePrimary();
                            const t = peek();
                            if (t && t.type === 'KEYWORD' && ['eq', 'ne', 'gt', 'ge', 'lt', 'le'].includes(t.value)) {
                                const op = consume().value; const right = parsePrimary(); return { type: 'BINARY', operator: op, left, right };
                            }
                            return left;
                        };
                        const parseAnd = () => {
                            let left = parseComparison();
                            while (peek() && peek().type === 'KEYWORD' && peek().value === 'and') { consume(); left = { type: 'BINARY', operator: 'and', left, right: parseComparison() }; }
                            return left;
                        };
                        const parseExpression = () => {
                            let left = parseAnd();
                            while (peek() && peek().type === 'KEYWORD' && peek().value === 'or') { consume(); left = { type: 'BINARY', operator: 'or', left, right: parseAnd() }; }
                            return left;
                        };
                        return parseExpression();
                    };

                    const evaluate = (node, item) => {
                        if (!node) return false;
                        if (node.type === 'LITERAL') return node.value;
                        if (node.type === 'PROPERTY') {
                            return node.name.split('/').reduce((obj, key) => (obj && obj[key] !== undefined) ? obj[key] : null, item);
                        }
                        if (node.type === 'UNARY') return !evaluate(node.right, item);
                        if (node.type === 'BINARY') {
                            const l = evaluate(node.left, item); const r = evaluate(node.right, item);
                            switch (node.operator) {
                                case 'eq': return l == r;
                                case 'ne': return l != r;
                                case 'gt': return l > r;
                                case 'ge': return l >= r;
                                case 'lt': return l < r;
                                case 'le': return l <= r;
                                case 'and': return l && r;
                                case 'or': return l || r;
                            }
                        }
                        if (node.type === 'CALL') {
                            const args = node.args.map(a => evaluate(a, item));
                            const fn = node.method.toLowerCase();
                            if (fn === 'substringof') return String(args[1] || '').includes(String(args[0] || ''));
                            if (fn === 'startswith') return String(args[0] || '').startsWith(String(args[1] || ''));
                            if (fn === 'endswith') return String(args[0] || '').endsWith(String(args[1] || ''));
                            if (fn === 'tolower') return String(args[0] || '').toLowerCase();
                            if (fn === 'toupper') return String(args[0] || '').toUpperCase();
                            if (fn === 'indexof') return String(args[0] || '').indexOf(String(args[1] || ''));
                        }
                        return false;
                    };

                    try {
                        const tokens = tokenize(filterStr);
                        const ast = parse(tokens);
                        return data.filter(item => evaluate(ast, item));
                    } catch (e) {
                        console.warn("[SW] Filter Parsing Error:", e);
                        return [];
                    }
                };

                console.log('[SW] Attempting to retrieve from IndexedDB for:', event.request.url);
                const dbName = "pwaapp-db";
                const storeName = "odata-store";

                const parsedUrl = new URL(event.request.url);
                let key = decodeURIComponent(parsedUrl.pathname);

                console.log('[SW] Original Key extracted:', key);

                const sapIndex = key.indexOf('/sap/');
                if (sapIndex >= 0) {
                    key = key.substring(sapIndex);
                    console.log('[SW] Normalized Key to:', key);
                } else {
                    console.log('[SW] No /sap/ prefix found in key.');
                }

                const request = indexedDB.open(dbName, 4);

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

                    // Check for single entity request
                    const entityRegex = /zi_denuser\('([^']+)'\)$/;
                    const match = key.match(entityRegex);
                    let isSingleEntity = false;
                    let entityKeyUsername = null;
                    let lookupKey = key;

                    if (match) {
                        isSingleEntity = true;
                        entityKeyUsername = match[1];
                        lookupKey = key.replace(entityRegex, 'zi_denuser');
                        console.log(`[SW] Single entity request for ${entityKeyUsername}. Lookup collection: ${lookupKey}`);
                    }

                    // Special handling for $count
                    if (key.endsWith('/$count')) {
                        console.log('[SW] Intercepted $count request');
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
                                    results = applyODataFilter(results, filter);
                                }

                                countVal = results.length;
                            }
                            console.log('[SW] Returning offline count:', countVal);
                            resolve(new Response(countVal.toString(), {
                                headers: { 'Content-Type': 'text/plain' }
                            }));
                        };
                        countReq.onerror = () => {
                            resolve(new Response('0', {
                                headers: { 'Content-Type': 'text/plain' }
                            }));
                        };
                        return;
                    }

                    const getRequest = store.get(lookupKey);

                    getRequest.onsuccess = () => {
                        if (getRequest.result) {
                            console.log('[SW] Data found in IndexedDB for key:', lookupKey);

                            let data = getRequest.result;

                            if (isSingleEntity) {
                                if (data && data.d && Array.isArray(data.d.results)) {
                                    const foundItem = data.d.results.find(item => item.Username === entityKeyUsername);
                                    if (foundItem) {
                                        resolve(new Response(JSON.stringify({ d: foundItem }), {
                                            headers: { 'Content-Type': 'application/json' }
                                        }));
                                    } else {
                                        resolve(new Response('{"error":{"message":{"value":"Entity not found"}}}', {
                                            status: 404,
                                            headers: { 'Content-Type': 'application/json' }
                                        }));
                                    }
                                } else {
                                    resolve(new Response('{"error":{"message":{"value":"Data format error"}}}', {
                                        status: 500,
                                        headers: { 'Content-Type': 'application/json' }
                                    }));
                                }
                                return;
                            }

                            if (data && data.d && Array.isArray(data.d.results)) {
                                // ... existing collection processing ...
                                let results = [...data.d.results];

                                const params = parsedUrl.searchParams;
                                const skip = parseInt(params.get('$skip') || '0', 10);
                                const top = parseInt(params.get('$top') || '0', 10);
                                const select = params.get('$select');
                                const filter = params.get('$filter');

                                // Apply $filter using the new advanced parser
                                if (filter) {
                                    results = applyODataFilter(results, filter);
                                }

                                // Calculate count after filtering but BEFORE paging (top/skip)
                                const totalCount = results.length;
                                const inlineCount = params.get('$inlinecount');

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

                                const responseData = {
                                    d: {
                                        results: results
                                    }
                                };
                                
                                if (inlineCount === 'allpages') {
                                    responseData.d.__count = totalCount;
                                }

                                resolve(new Response(JSON.stringify(responseData), {
                                    headers: { 'Content-Type': 'application/json' }
                                }));
                            } else {
                                resolve(new Response('{"d":{"results":[]}}', {
                                    headers: { 'Content-Type': 'application/json' }
                                }));
                            }
                        } else {
                             // Data not found in DB
                             console.warn('[SW] No data found in IndexedDB for key:', lookupKey);
                             // Attempt to fallback to network if possible, or return empty if we are supposedly "handling" this offline path?
                             // Since we are in the "Offline handler" block for a specific URL pattern, we should failing gracefully.
                             // BUT, if we are ONLINE, we should have let the request pass through? 
                             // The structure of the SW is:
                             // event.respondWith( getFromDB().catch( () => fetch(...) ) ) 
                             // We need to see how getFromDB is called.
                             reject("No data in DB");
                        }
                    };

                    getRequest.onerror = () => {
                        console.error('[SW] Error retrieving from IndexedDB');
                        reject("DB Error");
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
