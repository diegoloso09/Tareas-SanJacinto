// Service Worker — Tareas San Jacinto
// Estrategia:
// - App shell (HTML, manifest, íconos, fuentes, SDK Firebase): cache-first con actualización en background.
// - Firestore / APIs Google de auth/installations: NO se cachean (bypass total). Firestore maneja su propio cache offline en IndexedDB.
// - Cualquier otra request GET: stale-while-revalidate.
// - Fallback: si está offline y se pide una navegación, devolvemos index.html del cache.

const CACHE_VERSION = 'v1.0.0';
const SHELL_CACHE = `tareas-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `tareas-runtime-${CACHE_VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png',
  './apple-touch-icon.png',
  './favicon-32.png'
];

// Dominios que SIEMPRE pasan directo a red (sin tocar cache)
const BYPASS_HOSTS = [
  'firestore.googleapis.com',
  'firebaseinstallations.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'firebase.googleapis.com'
];

// Dominios que se pueden cachear como runtime (SDK + fuentes)
const RUNTIME_HOSTS = [
  'www.gstatic.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter(k => k !== SHELL_CACHE && k !== RUNTIME_CACHE)
          .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Bypass total para Firebase APIs (Firestore tiene su propio offline cache)
  if (BYPASS_HOSTS.some(h => url.hostname.includes(h))) {
    return;
  }

  // Navegaciones (cuando el usuario abre la app): cache-first con fallback al shell
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const clone = res.clone();
          caches.open(SHELL_CACHE).then(c => c.put('./index.html', clone));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // App shell mismo origen: cache-first
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const fetchPromise = fetch(req).then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(SHELL_CACHE).then(c => c.put(req, clone));
          }
          return res;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  // CDNs externos (SDK Firebase, Google Fonts): stale-while-revalidate
  if (RUNTIME_HOSTS.some(h => url.hostname.includes(h))) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then((cache) =>
        cache.match(req).then((cached) => {
          const fetchPromise = fetch(req).then((res) => {
            if (res && res.status === 200) cache.put(req, res.clone());
            return res;
          }).catch(() => cached);
          return cached || fetchPromise;
        })
      )
    );
    return;
  }
});

// Permitir que la app fuerce activación del SW nuevo
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
