/*
 * GarageFlow — Service Worker
 * ---------------------------------------------------------------------------
 * Stratégie de cache « intelligente », par type de ressource :
 *
 *   • /api/*                → network-only        (données sensibles / multi-compte,
 *                                                   jamais mises en cache)
 *   • navigations (HTML)    → network-first        + repli hors-ligne (/offline)
 *   • /_next/static, JS/CSS → cache-first          (fichiers hachés = immuables)
 *   • images, /icons, /splash → stale-while-revalidate
 *   • autres GET même origine → stale-while-revalidate
 *
 * Mises à jour : à chaque déploiement, changez CACHE_VERSION (ou le SW est
 * re-téléchargé automatiquement car servi en no-cache). Le nouveau SW s'installe
 * en arrière-plan ; l'application détecte l'état « waiting » et propose une mise
 * à jour en un clic (message SKIP_WAITING → activation immédiate → rechargement).
 */

const CACHE_VERSION = 'v1.0.0';
const PRECACHE = `gf-precache-${CACHE_VERSION}`;
const RUNTIME_STATIC = `gf-static-${CACHE_VERSION}`;
const RUNTIME_IMAGES = `gf-images-${CACHE_VERSION}`;
const RUNTIME_PAGES = `gf-pages-${CACHE_VERSION}`;

const OFFLINE_URL = '/offline';

// Ressources publiques (accessibles sans authentification) mises en cache dès l'install.
const PRECACHE_URLS = [
  OFFLINE_URL,
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/apple-touch-icon.png',
];

const ALL_CACHES = [PRECACHE, RUNTIME_STATIC, RUNTIME_IMAGES, RUNTIME_PAGES];
const MAX_IMAGE_ENTRIES = 80;
const MAX_PAGE_ENTRIES = 40;

// ── Install : pré-cache de l'app-shell public ────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(PRECACHE).then((cache) =>
      // addAll échouerait en bloc si une URL manque : on tolère les absences.
      Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url)))
    )
  );
  // On n'appelle PAS skipWaiting ici : le nouveau SW reste en « waiting »
  // jusqu'à ce que l'utilisateur accepte la mise à jour (ou fermeture des onglets).
});

// ── Activate : nettoyage des anciens caches + prise de contrôle ──────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith('gf-') && !ALL_CACHES.includes(k)).map((k) => caches.delete(k))
      );
      // Navigation Preload accélère la première navigation réseau.
      if (self.registration.navigationPreload) {
        try { await self.registration.navigationPreload.enable(); } catch (_) {}
      }
      await self.clients.claim();
    })()
  );
});

// ── Messages depuis la page (mise à jour immédiate) ──────────────────────────
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING' || event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ── Utilitaires ──────────────────────────────────────────────────────────────
async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  for (let i = 0; i < keys.length - maxEntries; i++) await cache.delete(keys[i]);
}

function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    /\.(?:js|css|woff2?|ttf|otf|eot)$/i.test(url.pathname)
  );
}

function isImage(request, url) {
  return (
    request.destination === 'image' ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith('/splash/') ||
    /\.(?:png|jpg|jpeg|gif|webp|avif|svg|ico)$/i.test(url.pathname)
  );
}

// Cache-first (assets immuables)
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) {
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone());
  }
  return response;
}

// Stale-while-revalidate (images / assets divers)
async function staleWhileRevalidate(request, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok && (response.type === 'basic' || response.type === 'default')) {
        cache.put(request, response.clone());
        if (maxEntries) trimCache(cacheName, maxEntries);
      }
      return response;
    })
    .catch(() => null);
  return cached || (await network) || Response.error();
}

// Network-first (navigations HTML) avec repli hors-ligne
async function navigationHandler(event) {
  const { request } = event;
  try {
    const preload = await event.preloadResponse;
    if (preload) {
      const cache = await caches.open(RUNTIME_PAGES);
      cache.put(request, preload.clone());
      trimCache(RUNTIME_PAGES, MAX_PAGE_ENTRIES);
      return preload;
    }
    const network = await fetch(request);
    if (network && network.ok && network.type === 'basic') {
      const cache = await caches.open(RUNTIME_PAGES);
      cache.put(request, network.clone());
      trimCache(RUNTIME_PAGES, MAX_PAGE_ENTRIES);
    }
    return network;
  } catch (_) {
    const cached = await caches.match(request);
    if (cached) return cached;
    const offline = await caches.match(OFFLINE_URL);
    return offline || new Response('Hors ligne', { status: 503, statusText: 'Offline' });
  }
}

// ── Fetch : aiguillage par type de ressource ─────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Seules les requêtes GET passent par le cache.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Uniquement notre propre origine ; le reste passe directement au réseau.
  if (url.origin !== self.location.origin) return;

  // Ne jamais mettre en cache l'API ni l'authentification (données sensibles / dynamiques).
  if (url.pathname.startsWith('/api/')) return;

  // Navigations (documents HTML) → network-first + offline.
  if (request.mode === 'navigate') {
    event.respondWith(navigationHandler(event));
    return;
  }

  // Assets statiques immuables → cache-first.
  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request, RUNTIME_STATIC));
    return;
  }

  // Images / icônes / splash → stale-while-revalidate.
  if (isImage(request, url)) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_IMAGES, MAX_IMAGE_ENTRIES));
    return;
  }

  // Autres GET même origine → stale-while-revalidate.
  event.respondWith(staleWhileRevalidate(request, RUNTIME_STATIC));
});
