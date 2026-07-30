# PWA GarageFlow (app.garageflows.fr)

L'application web installable partage l'API, la base, l'authentification et les
licences avec le desktop Electron ; ce sont des produits **distincts** :
`GarageFlow.exe` (Electron), `garageflows.fr` (vitrine), `app.garageflows.fr` (PWA).

## Éléments livrés

| Élément | Fichier |
|---|---|
| Manifeste complet | `public/manifest.webmanifest` (name, short_name, id, start_url, scope, display standalone + override, background/theme, icônes any+maskable 192/512, apple-touch, shortcuts) |
| Service Worker | `public/sw.js` |
| Page hors-ligne | `public/offline.html` |
| Enregistrement + MàJ | `src/components/PwaRegister.tsx` |
| Liens/méta | `src/app/layout.tsx` (manifest, theme-color, apple-web-app, icons, robots noindex) |
| Icônes | `public/icons/*` (générées via `sharp` depuis `icon.png`) |

## Stratégies de cache (SÛRES par défaut)

- **Assets statiques** (`/_next/static`, `/icons`, manifest) → *cache-first*
  (immuables, hashés par Next).
- **Navigations** (pages HTML) → *network-first* ; repli cache puis
  `offline.html` en cas de coupure.
- **`/api/*` et toute requête non-GET** → **JAMAIS mis en cache**. On ne met
  jamais en cache de session, de jeton ni de réponse authentifiée (fuite de
  données entre utilisateurs impossible via le SW).
- **Invalidation** : nom de cache versionné (`gf-v1-*`) ; purge des anciens à
  l'`activate`. Bump `VERSION` à chaque évolution du SW.

## Mises à jour du SW

`PwaRegister` détecte un SW « installed » en attente et propose « Mettre à jour »
→ `postMessage('SKIP_WAITING')` → `controllerchange` → rechargement contrôlé.

## Installation

- **Android / Chromium desktop** : `beforeinstallprompt` géré par le navigateur
  (bannière native) ; app installable (manifeste + SW + HTTPS).
- **iOS/iPadify** : « Partager → Sur l'écran d'accueil » (apple-touch-icon +
  `apple-mobile-web-app-capable` fournis). Pas de `beforeinstallprompt` (limite iOS).
- **Détection standalone** : `display-mode: standalone`.

## Sécurité PWA

- **HTTPS obligatoire** (le SW ne s'enregistre que si `isSecureContext`).
- **Pas d'enregistrement sous Electron** (`PwaRegister` détecte `window.electronAPI`).
- **CSP** stricte (voir `next.config.mjs`) : `object-src 'none'`,
  `worker-src 'self' blob:`, `frame-ancestors 'none'`, `connect-src 'self'`.
- Cookies de session `HttpOnly`/`Secure`/`SameSite`, protection CSRF côté serveur,
  purge des caches à la déconnexion (le SW ne stocke aucune réponse authentifiée).

## À vérifier après déploiement (non exécutable ici, sans HTTPS ni navigateur)

- **Lighthouse PWA** sur `https://app.garageflows.fr` (installable, SW, offline).
- Enregistrement du SW (DevTools › Application › Service Workers).
- Installation desktop + Android ; comportement iOS documenté.
- Absence de fuite de données entre sessions après changement d'utilisateur.

> Note d'honnêteté : les icônes/manifeste/SW/offline sont réels et testés
> (`src/lib/__tests__/pwa.test.ts`), mais l'audit Lighthouse et les tests
> d'installation réels nécessitent un déploiement HTTPS + navigateur, non
> disponibles dans cet environnement — à exécuter en préproduction.
