# Déploiement PWA — application web installable

> Document de data room. Décrit comment l'application Next.js partagée est servie
> en **PWA** (`app.garageflows.fr`) : manifeste, service worker, comportement
> hors-ligne et déploiement. Approfondit et référence `docs/PWA.md`.

## 1. Positionnement

L'application web installable partage l'API, la base, l'authentification et les
licences avec le desktop Electron, mais reste un **produit distinct** :

- `GarageFlow.exe` — client Electron (dépôt `GarageFlowsV2`) ;
- `garageflows.fr` — vitrine (dépôt `garagesite3`) ;
- `app.garageflows.fr` — **PWA** (dépôt `GarageFlowsV2`, cible web).

En cible web, l'app tourne comme une application Next.js standard adossée à
**PostgreSQL** (le même code choisit le client Prisma serveur quand
`DATABASE_URL` est `postgresql://…`). Voir `docs/DEPLOYMENT_GUIDE.md` et
`docs/ENVIRONMENT_VARIABLES.md` pour l'infrastructure et les secrets requis
(`DATABASE_URL` PostgreSQL, `NEXTAUTH_SECRET`, `DEVICE_TOKEN_PEPPER`, Upstash
Redis — démarrage refusé en prod si absents).

## 2. Éléments PWA livrés (réels)

| Élément | Fichier |
|---|---|
| Manifeste | `public/manifest.webmanifest` (name, short_name, id, start_url, scope, `display: standalone`, background/theme, icônes any + maskable 192/512, apple-touch, shortcuts) |
| Service Worker | `public/sw.js` |
| Page hors-ligne | `public/offline.html` |
| Enregistrement + MàJ du SW | `src/components/PwaRegister.tsx` |
| Liens/méta | `src/app/layout.tsx` (manifest, theme-color, apple-web-app, icons, robots noindex) |
| Icônes | `public/icons/*` (générées via `sharp` depuis `icon.png`) |

## 3. Stratégies de cache (sûres par défaut)

- **Assets statiques** (`/_next/static`, `/icons`, manifest) → *cache-first*
  (immuables, hashés par Next).
- **Navigations** (pages HTML) → *network-first* ; repli cache puis
  `offline.html` en cas de coupure.
- **`/api/*` et toute requête non-GET** → **jamais mises en cache**. Aucune
  session, aucun jeton, aucune réponse authentifiée n'est mise en cache — pas de
  fuite de données entre utilisateurs via le SW.
- **Invalidation** : nom de cache versionné (`gf-v1-*`), purge des anciens à
  l'`activate`. Bumper `VERSION` à chaque évolution du SW.

## 4. Mises à jour du service worker

`PwaRegister` détecte un SW « installed » en attente et propose « Mettre à jour »
→ `postMessage('SKIP_WAITING')` → `controllerchange` → rechargement contrôlé.

## 5. Installation

- **Android / Chromium desktop** : `beforeinstallprompt` géré par le navigateur
  (bannière native). App installable dès lors que manifeste + SW + HTTPS sont
  présents.
- **iOS / iPadOS** : « Partager → Sur l'écran d'accueil » (apple-touch-icon +
  `apple-mobile-web-app-capable` fournis). Pas de `beforeinstallprompt` (limite
  iOS).
- **Détection standalone** : `display-mode: standalone`.

## 6. Sécurité PWA

- **HTTPS obligatoire** : le SW ne s'enregistre que si `isSecureContext`.
- **Pas d'enregistrement sous Electron** : `PwaRegister` détecte
  `window.electronAPI` et n'installe pas le SW.
- **CSP stricte** (`next.config.mjs`) : `object-src 'none'`,
  `worker-src 'self' blob:`, `frame-ancestors 'none'`, `connect-src 'self'`.
- Cookies de session `HttpOnly` / `Secure` / `SameSite`, protection CSRF côté
  serveur, purge des caches à la déconnexion.
- `app.garageflows.fr` est **non indexé** (metadata `robots` + `X-Robots-Tag`
  + `robots.ts`).

## 7. Déploiement et DNS

1. Déployer la cible web `GarageFlowsV2` sur Vercel (ou un hôte Node), avec les
   variables PostgreSQL/Redis de production (voir `docs/DEPLOYMENT_GUIDE.md`).
2. DNS : `app` (CNAME) → hébergeur de la cible web (voir
   `garagesite3/docs/DOMAINS.md`).
3. HTTPS obligatoire (prérequis du SW + HSTS en production).

## 8. Vérifications post-déploiement (non exécutables sans HTTPS + navigateur)

- **Lighthouse PWA** sur `https://app.garageflows.fr` (installable, SW, offline).
- Enregistrement du SW (DevTools › Application › Service Workers).
- Installation desktop + Android ; comportement iOS documenté.
- Absence de fuite de données entre sessions après changement d'utilisateur.

> **Note d'honnêteté (reprise de `docs/PWA.md`).** Le manifeste, le SW, la page
> offline et les icônes sont réels et testés (`src/lib/__tests__/pwa.test.ts`),
> mais ce test est mince (~72 lignes) au regard de la surface offline/SW, et il
> n'existe **aucun test E2E** (Playwright/Cypress) pour cette surface. L'audit
> Lighthouse et les tests d'installation réels nécessitent un déploiement HTTPS +
> navigateur, à réaliser en préproduction. Voir le risque « zéro E2E » dans
> `docs/ACQUISITION_READINESS_AUDIT.md`.

---
*Voir aussi : [`docs/ACQUISITION_READINESS_AUDIT.md`](./ACQUISITION_READINESS_AUDIT.md) pour l'audit complet de préparation à la cession.*
