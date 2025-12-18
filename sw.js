const cacheName = 'notes-pwa-v1';
const appShell = [
    '/',
    '/index.html',
    '/styles.css',
    '/manifest.webmanifest',
    '/src/app.js',
    '/src/db.js',
    '/src/ui.js',
    '/src/util.js'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(cacheName).then((cache) => cache.addAll(appShell))
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.map((k) => (k === cacheName ? null : caches.delete(k))))
        )
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    event.respondWith(
        caches.match(req).then((cached) => cached || fetch(req))
    );
});
