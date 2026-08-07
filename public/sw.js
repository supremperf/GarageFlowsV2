/*
 * Service Worker GarageFlow (PWA app.garageflows.fr).
 *
 * Stratégies de cache MAÎTRISÉES et SÛRES :
 *  - assets statiques immuables (/_next/static, /icons) → cache-first ;
 *  - navigations (pages HTML) → network-first + repli page hors-ligne ;
 *  - /api/* et requêtes non-GET → JAMAIS mis en cache (réseau uniquement).
 *    On ne met jamais en cache de session, de token ni de réponse authentifiée.
 *  - invalidation : le nom de cache est versionné ; les anciens sont purgés.
 */
const VERSION = 'gf-v1'
const STATIC_CACHE = `${VERSION}-static`
const PAGE_CACHE = `${VERSION}-pages`
const OFFLINE_URL = '/offline.html'

const PRECACHE = [OFFLINE_URL, '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png']

self.addEventListener('install', (event) => {
  // On NE force PAS l'activation ici (pas de self.skipWaiting() à l'install) : un
  // nouveau SW qui prendrait le contrôle immédiatement déclencherait un
  // rechargement de page NON CONSENTI (controllerchange), avec perte de la saisie
  // en cours (devis, OR, fiche véhicule). Le nouveau SW RESTE EN ATTENTE ; la
  // page propose « Mettre à jour » et n'active le nouveau SW que sur clic de
  // l'utilisateur, via le message SKIP_WAITING ci-dessous.
  event.waitUntil(caches.open(STATIC_CACHE).then((c) => c.addAll(PRECACHE)))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  )
})

// Messages de la page : activation forcée + purge des caches à la déconnexion.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
  // À la déconnexion, on efface le cache de pages (aucune page privée ne doit
  // survivre pour un autre utilisateur du même appareil). Le cache statique
  // (assets publics versionnés) est conservé.
  if (event.data === 'CLEAR_PRIVATE_CACHE') {
    event.waitUntil(caches.delete(PAGE_CACHE))
  }
})

function isStaticAsset(url) {
  return url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/') ||
    url.pathname === '/manifest.webmanifest'
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Ne gérer que le même-origine et les GET. Tout le reste passe au réseau.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return

  // SÉCURITÉ : jamais de cache pour l'API (données authentifiées / sensibles).
  if (url.pathname.startsWith('/api/')) return

  // Assets statiques immuables → cache-first.
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then((hit) =>
        hit || fetch(request).then((res) => {
          const copy = res.clone()
          caches.open(STATIC_CACHE).then((c) => c.put(request, copy))
          return res
        }),
      ),
    )
    return
  }

  // Navigations (pages) → network-first, repli cache puis page hors-ligne.
  // On ne met en cache QUE si le serveur l'autorise : une réponse portant
  // Cache-Control: no-store (pages authentifiées) n'est jamais stockée.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const cc = res.headers.get('Cache-Control') || ''
          const cacheable = res.ok && !/no-store|private/i.test(cc)
          if (cacheable) {
            const copy = res.clone()
            caches.open(PAGE_CACHE).then((c) => c.put(request, copy))
          }
          return res
        })
        .catch(() => caches.match(request).then((hit) => hit || caches.match(OFFLINE_URL))),
    )
    return
  }
})
