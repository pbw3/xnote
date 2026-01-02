const cacheName = 'notes-pwa-debug-v1';
const appShell = [
    '/',
    'favicon.ico',
    '/index.html',
    '/styles.css',
    '/manifest.webmanifest',
    '/src/app.js',
    '/src/db.js',
    '/src/ui.js',
    '/src/util.js',
    '/src/sync/googleAuth.js',
    '/src/sync/driveApi.js',
    '/src/sync/syncEngine.js'
];

function log(...args) {
    // Prefix makes it easy to filter in DevTools (Service Worker console)
    console.log('[SW]', ...args);
}

/**
 * Normalize requests so cache matching works even with cache-busting query strings.
 * @param {Request} req - Original request.
 * @returns {Request} Normalized request.
 */
function normalizeRequest(req) {
    const url = new URL(req.url);
    // Strip query + hash for cache lookup
    url.search = '';
    url.hash = '';
    return new Request(url.toString(), {
        method: req.method,
        headers: req.headers,
        mode: req.mode,
        credentials: req.credentials,
        redirect: req.redirect,
        referrer: req.referrer,
        referrerPolicy: req.referrerPolicy,
        integrity: req.integrity,
        cache: 'default'
    });
}

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        log('install start');
        self.skipWaiting();
        const cache = await caches.open(cacheName);

        // Cache each file individually (never fail whole install).
        await Promise.all(appShell.map(async (url) => {
            try {
                await cache.add(url);
                log('cached', url);
            } catch (e) {
                log('FAILED to cache', url, String(e?.message || e));
            }
        }));

        log('install done');
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        log('activate start');
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => (k === cacheName ? null : caches.delete(k))));
        await self.clients.claim();
        log('activate done');
    })());
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    const url = new URL(req.url);

    // Quick “is SW alive?” endpoint
    if (url.origin === location.origin && url.pathname === '/offline-debug') {
        event.respondWith(
            new Response(`OK ${new Date().toISOString()}`, {
                headers: { 'Content-Type': 'text/plain' }
            })
        );
        return;
    }

    if (req.method !== 'GET') return;

    event.respondWith((async () => {
        // 1) Cache-first (ignore querystrings/cachebust)
        let cached = await caches.match(req, { ignoreSearch: true });

        if (!cached && url.origin === location.origin) {
            // ✅ Try a normalized same-origin URL (fixes //, odd base, etc.)
            const normalizedUrl = new URL(url.pathname, location.origin).toString();
            cached = await caches.match(normalizedUrl, { ignoreSearch: true });
        }

        if (cached) {
            console.log('[SW] CACHE HIT', url.pathname + url.search);
            return cached;
        }

        console.log('[SW] CACHE MISS', url.pathname + url.search);

        // 2) Try network
        try {
            const res = await fetch(req);
            console.log('[SW] NETWORK OK', url.pathname + url.search, res.status);
            return res;
        } catch (e) {
            console.log('[SW] NETWORK FAIL', url.pathname + url.search, String(e?.message || e));

            // 3) Navigation fallback: serve cached index.html
            if (req.mode === 'navigate') {
                const cachedIndex = await caches.match('/index.html', { ignoreSearch: true });
                if (cachedIndex) {
                    console.log('[SW] NAV FALLBACK index.html');
                    return cachedIndex;
                }
                return new Response('Offline (no cached index.html)', { status: 503 });
            }

            // 4) Static fallback by pathname only (handles oddities like double slashes)
            if (url.origin === location.origin) {
                const cache = await caches.open(cacheName);
                const keys = await cache.keys();
                const key = keys.find((k) => new URL(k.url).pathname === url.pathname);
                if (key) {
                    console.log('[SW] PATHNAME HIT', url.pathname, 'from', key.url);
                    const res2 = await cache.match(key);
                    if (res2) return res2;
                }
            }

            // 5) Otherwise fail
            return new Response('Offline fetch failed', { status: 504 });
        }
    })());
});
