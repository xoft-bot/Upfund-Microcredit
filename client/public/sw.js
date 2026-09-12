const SHELL_CACHE = 'letsgrow-shell-v2';
const SHELL_ASSETS = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg'];
const API_PATHS = ['/api/', '/health'];
const STATIC_DESTINATIONS = new Set(['document', 'script', 'style', 'image', 'font', 'manifest']);

function isApiRequest(url) {
  return API_PATHS.some((path) => url.pathname === path.slice(0, -1) || url.pathname.startsWith(path));
}

function isStaticShellRequest(request, url) {
  return request.method === 'GET'
    && url.origin === self.location.origin
    && !isApiRequest(url)
    && STATIC_DESTINATIONS.has(request.destination);
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (!isStaticShellRequest(request, url)) return;
  event.respondWith(
    fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        void caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
      }
      return response;
    }).catch(() => caches.match(request).then((cached) => cached ?? caches.match('/index.html'))),
  );
});