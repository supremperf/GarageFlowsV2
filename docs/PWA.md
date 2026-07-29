# GarageFlow — Progressive Web App (`app.garageflows.fr`)

Documentation complète de la PWA GarageFlow : architecture, dossiers concernés,
modifications apportées, configuration des sous-domaines et étapes de déploiement.

> **En une phrase :** la PWA n'est **pas** une nouvelle application — c'est le
> **même code Next.js** que le logiciel de bureau (`GarageFlow.exe`), déployé sur
> le sous-domaine `app.garageflows.fr` avec les métadonnées, le manifeste et le
> Service Worker nécessaires pour être **installable** sur mobile et desktop.
> **Aucune logique métier n'est dupliquée.**

---

## 1. Architecture d'ensemble

Trois « surfaces » partagent **une seule et même base de code applicative** et
**une infrastructure commune** :

```
                    ┌─────────────────────────────────────────────┐
                    │          Infrastructure commune             │
                    │                                             │
                    │   PostgreSQL  ·  NextAuth  ·  Licences       │
                    │   Permissions ·  Comptes utilisateurs        │
                    └───────────────▲───────────────▲─────────────┘
                                    │               │
       même code Next.js           │               │  même code Next.js
   (route handlers /api + Prisma)  │               │
                                    │               │
   ┌───────────────────────┐  ┌────┴───────────┐  ┌┴────────────────────────┐
   │  GarageFlow.exe        │  │ app.garageflows │  │ garageflows.fr          │
   │  (Electron + Next.js   │  │      .fr        │  │ (garagesite3 —          │
   │   standalone, local)   │  │  PWA installable│  │  vitrine + serveur      │
   │                        │  │  (ce dépôt,     │  │  de licences)           │
   │                        │  │   cible web)    │  │                         │
   └───────────────────────┘  └─────────────────┘  └─────────────────────────┘
        GarageFlowsV2               GarageFlowsV2            garagesite3
```

| Produit | Dépôt | Rôle | Distribution |
|---|---|---|---|
| **GarageFlow.exe** | `GarageFlowsV2` | App de bureau (Electron encapsule le build Next.js `standalone`) | Installeur Windows NSIS |
| **app.garageflows.fr** | `GarageFlowsV2` | **PWA installable** (Android, iOS/iPadOS, Windows, macOS) | Web (Vercel / hôte Node) |
| **garageflows.fr** | `garagesite3` | Site vitrine + serveur officiel des licences + back-office | Web (Vercel) |

**Pourquoi aucune duplication ?** La PWA et le `.exe` sont **le même projet
`GarageFlowsV2`**. Le `.exe` lance le serveur Next.js `standalone` localement ;
`app.garageflows.fr` lance **exactement le même serveur** sur un hébergement web.
Les deux utilisent les mêmes route handlers `src/app/api/**`, le même client
Prisma, le même NextAuth et — pointés vers **la même base PostgreSQL** — les mêmes
données, licences, permissions et comptes. La PWA n'ajoute que la couche
« installable » (manifeste + Service Worker + métadonnées), strictement
additive et sans effet sur la logique métier.

---

## 2. Comment fonctionne la PWA

### 2.1 Web App Manifest — `public/manifest.webmanifest`
Manifeste complet : `id`, `scope`, `start_url`, `display: standalone`
(+ `display_override`), `orientation`, `background_color`/`theme_color`,
`categories`, jeu complet d'icônes (72 → 512 px) dont deux icônes **maskable**
(Android adaptive icons), et **raccourcis** (`shortcuts`) : Planning, Nouveau
rendez-vous, Tableau de bord, Stock.

### 2.2 Service Worker — `public/sw.js`
Cache « intelligent », **une stratégie par type de ressource** :

| Ressource | Stratégie | Raison |
|---|---|---|
| `/api/*` | **network-only** (jamais mis en cache) | données sensibles / multi-comptes |
| Navigations HTML | **network-first** + repli `/offline` | contenu frais, tolérant hors-ligne |
| `/_next/static`, JS, CSS, polices | **cache-first** | fichiers hachés = immuables |
| Images, `/icons`, `/splash` | **stale-while-revalidate** | rapide + rafraîchi en tâche de fond |
| Autres GET même origine | **stale-while-revalidate** | équilibre vitesse / fraîcheur |

- Pré-cache à l'installation de l'« app-shell » **public** uniquement
  (`/offline`, manifeste, icônes clés) — jamais de page authentifiée.
- Nettoyage automatique des anciens caches à l'activation (versionnés `gf-*`).
- **Navigation Preload** activé pour accélérer la première navigation réseau.
- Limitation du nombre d'entrées (images / pages) pour borner l'espace disque.

### 2.3 Mises à jour automatiques
- Le Service Worker est servi en **`Cache-Control: no-cache`** (`next.config.mjs`)
  → chaque déploiement est détecté.
- `src/components/pwa/PwaRegister.tsx` détecte la nouvelle version (worker en
  état `installed` alors qu'un contrôleur existe), affiche une bannière
  **« Mise à jour disponible »**, et au clic envoie `SKIP_WAITING` → le nouveau
  worker s'active → **rechargement automatique**.
- Vérifications périodiques (toutes les heures) et au retour sur l'onglet.
- Pour publier une nouvelle version : incrémentez `CACHE_VERSION` en tête de
  `public/sw.js` (ou laissez le no-cache faire son travail au redéploiement).

### 2.4 Installation
- **Android / Chrome / Edge / desktop** : `beforeinstallprompt` est capturé et un
  bouton **« Installer »** déclenche l'invite native
  (`src/components/pwa/InstallPrompt.tsx`).
- **iOS / iPadOS (Safari)** : pas d'API d'installation → instructions
  **« Partager → Sur l'écran d'accueil »** affichées automatiquement.
- Masqué si l'app est déjà installée (`display-mode: standalone`) ou récemment
  rejeté (mémorisé 14 jours dans `localStorage`).

### 2.5 Plein écran & expérience native
- `display: standalone` + `viewport-fit: cover` → plein écran, sans barre
  d'URL, gestion des encoches (safe-area).
- **Splash screens iOS** générés pour tous les iPhone/iPad (portrait + paysage),
  branchés via `appleWebApp.startupImage` (table `src/lib/pwaAssets.ts`).
- `apple-touch-icon`, `apple-mobile-web-app-*`, `theme-color` = `#0f1629`
  (barre d'état sombre, cohérente avec l'UI).

---

## 3. Dossiers & fichiers concernés

### Ajoutés (`GarageFlowsV2`)
```
public/
  manifest.webmanifest              ← manifeste PWA complet
  sw.js                             ← Service Worker (cache + updates)
  apple-touch-icon.png              ← icône iOS 180×180
  icons/                            ← icônes 72→512 + maskable + favicons (16 fichiers)
  splash/                           ← splash screens iOS portrait+paysage (30 fichiers)
src/
  app/offline/page.tsx              ← page de repli hors-ligne (publique)
  components/pwa/
    index.tsx                       ← <PWA/> : point de montage unique
    PwaRegister.tsx                 ← enregistrement SW + bannière de mise à jour
    InstallPrompt.tsx               ← invite d'installation (Android + iOS)
    PwaShortcutHandler.tsx          ← raccourcis manifeste (?view / ?action)
  lib/pwaAssets.ts                  ← table des splash screens (AUTO-GÉNÉRÉ)
scripts/
  generate-pwa-assets.js            ← (re)génère icônes + splash depuis icon.svg
docs/
  PWA.md                            ← ce document
```

### Modifiés (`GarageFlowsV2`)
| Fichier | Modification | Impact |
|---|---|---|
| `src/app/layout.tsx` | metadata PWA (manifest, `appleWebApp`+splash, `icons`), `viewport` (themeColor, viewport-fit), montage `<PWA/>` | additif |
| `src/middleware.ts` | exemption des assets PWA (`/sw.js`, `/manifest.webmanifest`, `/offline`, `/icons`, `/splash`, fichiers statiques) du gate licence/auth | additif |
| `next.config.mjs` | en-têtes `Cache-Control: no-cache` + `Service-Worker-Allowed` pour `/sw.js` ; `Cache-Control` du manifeste | additif |
| `public/site.webmanifest` | **supprimé** (remplacé par `manifest.webmanifest`, complet) | — |

### Modifiés (`garagesite3` — `garageflows.fr`)
| Fichier | Modification |
|---|---|
| `src/lib/site.ts` | ajout de `appUrl` (`NEXT_PUBLIC_APP_URL` → `https://app.garageflows.fr`) |
| `src/components/ui/OpenAppButton.tsx` | **nouveau** bouton « Ouvrir l'application » |
| `src/components/layout/Navbar.tsx` | bouton ajouté (menu desktop + mobile) |
| `src/components/sections/Hero.tsx` | bouton ajouté en CTA principal |

> ⚠️ **Point critique — middleware.** GarageFlowsV2 protège toutes les pages par
> un gate licence + authentification. Sans l'exemption ajoutée dans
> `src/middleware.ts`, `/sw.js`, `/manifest.webmanifest` et les icônes seraient
> redirigés vers `/license` et **l'installation échouerait**. C'est déjà pris en
> charge.

---

## 4. (Re)génération des icônes & splash screens

Source unique : `icon.svg` (vectoriel, rendu net à toute taille).

```bash
# depuis GarageFlowsV2/ (sharp est déjà en devDependencies)
node scripts/generate-pwa-assets.js
```
Cela régénère `public/icons/*`, `public/splash/*`, `public/apple-touch-icon.png`
et `src/lib/pwaAssets.ts`. Les fichiers générés sont **commités** dans le dépôt.

---

## 5. Configuration des sous-domaines

### DNS (registrar du domaine `garageflows.fr`)
| Sous-domaine | Type | Cible |
|---|---|---|
| `garageflows.fr` (apex) | A / ALIAS | hébergeur de **garagesite3** (vitrine + back-office) |
| `www.garageflows.fr` | CNAME | `garageflows.fr` |
| `api.garageflows.fr` | CNAME | hébergeur de **garagesite3** (même déploiement — API / serveur de licences) |
| `app.garageflows.fr` | CNAME | hébergeur de **GarageFlowsV2** (cible web — **PWA**) |

> HTTPS est **obligatoire** pour une PWA (Service Worker). Les certificats sont
> gérés automatiquement par Vercel (ou via Let's Encrypt sur un hôte Node).

### Vercel (recommandé)
- Projet **`garageflows-site`** (dépôt `garagesite3`) → domaines `garageflows.fr`
  **et** `api.garageflows.fr` (deux domaines, un seul déploiement ; l'API de
  licences est exposée sous `api.garageflows.fr` via `NEXT_PUBLIC_API_URL`).
- Projet **`garageflows-app`** (dépôt `GarageFlowsV2`) → domaine `app.garageflows.fr`.
- Chaque projet possède ses variables d'environnement (section 6).

### Cookies / SSO inter-sous-domaines (optionnel)
Pour partager la session entre `garageflows.fr` et `app.garageflows.fr`, définir
le cookie de session sur le domaine parent `.garageflows.fr`. Par défaut, la PWA
gère sa propre connexion sur `app.garageflows.fr` (mêmes identifiants, même base).

### Topologie des sous-domaines (décidée)
Trois rôles, trois sous-domaines, **sans collision** :

| Rôle | Dépôt | Domaine | Variable |
|---|---|---|---|
| Vitrine + back-office | `garagesite3` | `garageflows.fr` | — |
| **Serveur de licences / control-plane / API** | `garagesite3` | **`api.garageflows.fr`** | `NEXT_PUBLIC_API_URL` |
| **PWA / application** | `GarageFlowsV2` (cible web) | **`app.garageflows.fr`** | `NEXTAUTH_URL`, `NEXT_PUBLIC_APP_URL` |

> **Décision** : `app.garageflows.fr` est **exclusivement** la PWA. Le serveur
> de licences (dépôt `garagesite3`), auparavant étiqueté `app.garageflows.fr`,
> est basculé sur **`api.garageflows.fr`** — c'est l'origine publique utilisée
> pour les URLs de téléchargement/mises à jour (`NEXT_PUBLIC_API_URL`) et pointée
> par `GF_LICENSE_SERVER` côté desktop/PWA. Ce changement est purement
> **configuration + commentaires** (le code est piloté par variables
> d'environnement) : aucune logique métier modifiée.

---

## 6. Variables d'environnement

### `GarageFlowsV2` (PWA / app) — voir `.env.example`
| Variable | Rôle |
|---|---|
| `DATABASE_URL` | **La même** PostgreSQL que le desktop et le serveur de licences → données synchronisées |
| `NEXTAUTH_SECRET` | **Identique** partout → sessions valides sur toutes les surfaces |
| `NEXTAUTH_URL` | `https://app.garageflows.fr` (URL propre de la PWA) |
| `NEXT_PUBLIC_APP_URL` | `https://app.garageflows.fr` (utilisé par `metadataBase`) |
| `GF_LICENSE_SERVER` | `https://api.garageflows.fr` — serveur de licences / control-plane |

### `garagesite3` (vitrine + API de licences)
| Variable | Rôle |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://api.garageflows.fr` — origine publique du serveur de licences / API |
| `NEXT_PUBLIC_APP_URL` | `https://app.garageflows.fr` — cible du bouton « Ouvrir l'application » |

> **Synchronisation des données** = conséquence directe d'un `DATABASE_URL` et
> d'un `NEXTAUTH_SECRET` **partagés**. Aucune réplication ni logique
> supplémentaire n'est nécessaire.

---

## 7. Étapes de déploiement

1. **Base de données** : une instance PostgreSQL unique, accessible par le
   desktop, la PWA et le serveur de licences (`DATABASE_URL` identique).
2. **Déployer garagesite3** sur `garageflows.fr` (inclut `prisma migrate deploy`).
3. **Déployer GarageFlowsV2 (cible web)** sur `app.garageflows.fr` :
   `npm ci && npm run build && npm start` (ou déploiement Vercel).
   Renseigner `DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`,
   `NEXT_PUBLIC_APP_URL`.
4. **DNS** : créer l'enregistrement `app.garageflows.fr` (section 5) ; vérifier
   le HTTPS.
5. **Vérifier la PWA** : ouvrir `https://app.garageflows.fr`, Lighthouse →
   catégorie *PWA* « installable », tester l'installation (section 8).
6. **Desktop** : `npm run dist` produit `GarageFlow.exe` (inchangé).

---

## 8. Tests & checklist de non-régression

- [ ] **Build** `GarageFlowsV2` : `npm run build` réussit.
- [ ] **Build** `garagesite3` : `next build` réussit ; bouton « Ouvrir
      l'application » visible (Navbar desktop + mobile + Hero) et pointant vers
      `app.garageflows.fr`.
- [ ] **Manifeste** servi sur `/manifest.webmanifest` (pas de redirection vers `/license`).
- [ ] **Service Worker** enregistré (`/sw.js`, scope `/`) ; onglet *Application*
      des DevTools.
- [ ] **Installation Android/desktop** : invite native + icône sur l'écran d'accueil.
- [ ] **Installation iOS/iPadOS** : instructions Partager → Écran d'accueil ;
      splash screen + icône corrects ; ouverture en plein écran (standalone).
- [ ] **Hors-ligne** : couper le réseau → page `/offline` servie ; retour réseau → OK.
- [ ] **Mise à jour** : redéployer → bannière « Mise à jour disponible » →
      rechargement automatique.
- [ ] **Auth / licences / données** : connexion sur `app.garageflows.fr`, données
      identiques au desktop (même base).
- [ ] **Sécurité** : `/api/*` jamais mis en cache par le SW ; CSP inchangée ;
      HTTPS forcé.
- [ ] **Responsive** : mobile, tablette, desktop.

### Lighthouse (rapide)
```bash
npx lighthouse https://app.garageflows.fr --only-categories=pwa --view
```

---

## 9. Sécurité — points clés

- Le Service Worker **ne met jamais `/api/*` en cache** : aucune donnée sensible
  ni jeton de session ne persiste côté client. Le pré-cache ne contient que des
  ressources publiques.
- La **CSP existante est inchangée** ; `worker-src`/`manifest-src` héritent de
  `default-src 'self'` — le SW (même origine) et le manifeste sont autorisés.
- Le middleware de licence/auth reste appliqué à **toutes les pages** ; seules
  les ressources statiques publiques nécessaires à l'installation sont exemptées.
- HTTPS obligatoire (prérequis Service Worker).
- **Isolation desktop** : le Service Worker n'est **pas** enregistré dans l'app
  Electron (`GarageFlow.exe`) — détection via `window.electronAPI` — afin de ne
  pas interférer avec son mécanisme de mise à jour natif. L'invite d'installation
  ne s'y affiche jamais non plus. `GarageFlow.exe` est donc inchangé.
```
