// RasoiLink Bharat-Mode Service Worker
// Enables 100% offline menu browsing, local order queueing, and background asset caching

const CACHE_NAME = 'rasoilink-bharat-v2';

const PRECACHE_ASSETS = [
  '/',
  '/kitchen.html',
  '/landing',
  '/static/css/main.css',
  '/static/js/app.js',
  '/static/js/kitchen.js',
  '/static/js/chatbot.js',
  '/static/js/i18n.js',
  '/static/js/voice-assistant.js',
  '/static/js/offline-sync.js',
  '/static/js/group-hunger.js',
  '/static/js/waste-profit.js',
  '/static/js/safekitchen.js',
  '/static/js/qrcode-generator.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[RasoiLink SW] Pre-caching Bharat Mode assets');
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('[RasoiLink SW] Pre-cache partial warning:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[RasoiLink SW] Cleaning old cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // For API requests: Try Network first, fallback to Cache for GET /api/menu and /api/store/settings
  if (url.pathname.startsWith('/api/')) {
    if (event.request.method === 'GET') {
      event.respondWith(
        fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const clone = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
            }
            return networkResponse;
          })
          .catch(() => {
            return caches.match(event.request).then((cachedResponse) => {
              if (cachedResponse) return cachedResponse;
              return new Response(JSON.stringify({ offline: true, message: "Bharat Offline Mode Active" }), {
                headers: { 'Content-Type': 'application/json' }
              });
            });
          })
      );
      return;
    }
    // Non-GET requests pass directly to network (client offline-sync.js intercepts offline POSTs)
    return;
  }

  // For Static Assets & HTML: Stale-While-Revalidate
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return networkResponse;
      }).catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});
