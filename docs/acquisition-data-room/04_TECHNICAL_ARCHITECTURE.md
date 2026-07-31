# 04 — Architecture technique

## 1. Vue d'ensemble

GarageFlow se compose de deux dépôts produisant trois artefacts :

```
┌──────────────────────────────┐        ┌──────────────────────────────────┐
│  Application desktop Electron │        │  Control-plane cloud (garagesite3)│
│  /home/user/GarageFlowsV2     │        │  /home/user/garagesite3           │
│                               │        │                                   │
│  Electron 31 (shell)          │        │  Next.js 15 (App Router)          │
│   └─ utilityProcess.fork      │  HTTPS │  PostgreSQL / Prisma (13 modèles) │
│       Next.js 14 standalone   │◄──────►│  Upstash Redis (rate limit)       │
│       127.0.0.1:4028          │        │  Vercel Blob (installeurs)        │
│   └─ SQLite / Prisma (37 mod.)│        │  api.garageflows.fr               │
└──────────────────────────────┘        └──────────────────────────────────┘
        Application PWA = même codebase Next.js, DB PostgreSQL
```

## 2. Application desktop (Electron)

- **Shell Electron** (`electron/main.js`, ~102 Ko) qui démarre un serveur Next.js standalone embarqué sur `127.0.0.1:4028` via `utilityProcess.fork` de `.next/standalone/server.js` (`main.js:1519-1568`). Le serveur est lié **strictement au loopback** (`HOSTNAME 127.0.0.1`) — jamais exposé au LAN.
- **Durcissement du renderer** : chaque `BrowserWindow` utilise `contextIsolation:true`, `nodeIntegration:false`, `sandbox:true`, `webSecurity:true`, `allowRunningInsecureContent:false` (`main.js:1636-1638, 1714-1718`). Le preload (`electron/preload.js:10-118`) n'expose qu'une API `contextBridge` minimale et explicite, sans accès Node brut.
- **Navigation verrouillée** : `will-navigate`/`will-redirect` bloquent tout ce qui n'est pas sur `http://127.0.0.1:PORT` (`main.js:1825-1839`) ; `setWindowOpenHandler` refuse toute nouvelle fenêtre et n'ouvre en shell qu'une allowlist HTTPS d'hôtes garageflows.fr ; l'attachement de webview est refusé.
- **Persistance** : SQLite via Prisma, **37 modèles** (`prisma/schema.prisma`). La DB est copiée depuis un template committé au premier lancement, avec quarantaine de DB corrompue et backups horaires/quotidiens/hebdomadaires (`main.js:837-892`).
- **Packaging** : `next.config output:'standalone'`, `post-build.js` copie `.next/static`, `public`, le moteur Prisma et le template DB dans le bundle ; `asarUnpack` pour le query engine Prisma Windows ; `binaryTargets` inclut `windows`.

## 3. Control-plane cloud (garagesite3)

- **Next.js 15 (App Router)** + **PostgreSQL/Prisma**, **13 modèles** (LicenseKey, Device, LicenseEvent, AppRelease, ReleaseEvent, Module, LicenseModule, Notification, NotificationReceipt, CrashReport, AuditLog, Lead, NewsletterSubscriber).
- **56 routes API**, dont une API publique versionnée `src/app/api/v1/*` avec route OpenAPI `v1/openapi.json`.
- **Redis distribué (Upstash)** pour le rate limiting fail-closed sur les routes sensibles.
- **Vercel Blob** pour l'upload d'installeurs.
- **Validation d'environnement fail-closed en prod** (`src/lib/env.ts`) : la prod exige `DEVICE_TOKEN_SECRET`(≥32), `HWID_HMAC_SECRET`(≥32), `UPSTASH_REDIS_REST_URL/TOKEN` ; refus de démarrer si secrets manquants/faibles/exemples.

## 4. Schémas de données

| Schéma | Provider | Modèles | Migrations |
|---|---|---|---|
| Desktop `prisma/schema.prisma` | SQLite | 37 | 2 patchs incrémentaux seulement, **pas de baseline init**, pas de `migration_lock.toml` — repose sur `db push` + template DB |
| Miroir serveur `prisma/server/schema.prisma` | PostgreSQL | 37 | 4 migrations ordonnées + `migration_lock.toml` |
| Cloud `garagesite3/prisma/schema.prisma` | PostgreSQL | 13 | 5 migrations ordonnées |

**Parité desktop/serveur excellente** : le diff ne montre que des différences de provider/directUrl/generator/commentaires, **aucune dérive de modèle métier**. Le schéma cloud est un **domaine totalement distinct** (control-plane + leads/newsletter) : il ne contient **aucun** modèle Invoice/Quote/métier.

> **Limitation :** le schéma desktop n'est **pas reproductible depuis les migrations** (pas de baseline). C'est un point d'auditabilité à corriger post-acquisition.

## 5. Cycle de mise à jour (auto-update)

Sécurité réelle, non cosmétique :
1. Le control-plane sert un **manifeste signé Ed25519** (`releases/manifest.ts`, sérialisation canonique déterministe).
2. Le desktop **exige** un manifeste signé valide quand une clé de signature est embarquée (`main.js:1999-2020`), avec anti-downgrade semver et allowlist d'hôtes HTTPS de téléchargement.
3. Le SHA-256 du binaire est calculé en streaming et **comparé en timing-safe AVANT** de lancer l'installeur (`main.js:2144-2173`) ; refus d'exécuter un binaire non vérifié ou de taille incorrecte.

Ordre de fallback : serveur central → admin local → GitHub (non vérifiable).

## 6. Multi-tenant

- Modèle opérationnel **mono-garage par session** (un `garageId` par session).
- Guard tenant typé (`src/lib/tenant.ts`) sans `any`/`ts-ignore` ; scoping `where:{id, garageId}` sur toutes les routes métier + guard `assertRelations` contre l'IDOR de 2e ordre.
- Voir `05_SECURITY_OVERVIEW.md`.

## 7. Dépendances de plateforme externes (P0)

L'application desktop **ne fonctionne pas de bout en bout** sans :
- le backend control-plane (`api.garageflows.fr` / GF_LICENSE_SERVER) pour activation, heartbeat, révocation, crash reporting, publication de releases ;
- les **clés privées de signature** (server-side, absentes du repo) ;
- la propriété des **domaines garageflows.fr** (codés en dur dans les allowlists).

Détail : `07_DEPLOYMENT_MODEL.md`.

## 8. Chiffres vérifiés (structure)

| Élément | Desktop (V2) | Cloud (site3) |
|---|---|---|
| Modèles Prisma | 37 (+ 37 miroir serveur) | 13 |
| Routes API (`route.ts`) | 125 | 56 |
| `@ts-ignore`/`@ts-nocheck` (src+electron) | 1 total | — |
| `tsc --noEmit` | exit 0 | exit 0 |

---
*Référence croisée : voir `docs/ACQUISITION_READINESS_AUDIT.md` pour l'audit de préparation complet.*
