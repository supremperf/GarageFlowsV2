# Architecture cloud — Control-plane GarageFlow (garagesite3)

> Document de data room — diligence technique M&A. Factuel. Dépôt :
> `/home/user/garagesite3`. Stack : **Next.js 15 (App Router) + PostgreSQL/Prisma
> + Vercel**. Maturité : *beta*. Statut par composant : **Opérationnel** /
> **Partiel** / **Code seul** / **NON CONSTRUIT**.

## 1. Nature du composant

`garagesite3` combine une **vitrine marketing** et un **control-plane de
licences / mises à jour** réellement capable pour l'application desktop
GarageFlow. Le cœur licence / device-auth / release / crash / modules /
notifications / audit est **réel, adossé à Prisma, fail-closed, et couvert par
135 tests unitaires verts**. Cette partie est proche d'une qualité de
production. En revanche, l'**API publique `/api/v1`** annoncée comme « REST API
pour connecter des logiciels tiers » est une **démo en mémoire non persistante**
(voir §6). Le control-plane est l'actif réel ; l'API d'intégration et les
webhooks sont à considérer comme non construits.

Le cloud **ne stocke aucune donnée métier** (factures, clients…) : uniquement
licences, devices, releases, crash, audit, leads/newsletter.

## 2. Schéma PostgreSQL — 13 modèles

Fichier : `garagesite3/prisma/schema.prisma`. Modèles (13) :

| Domaine | Modèles |
|---|---|
| Licences | `LicenseKey`, `Device`, `LicenseEvent` |
| Releases | `AppRelease`, `ReleaseEvent` |
| Modules / entitlements | `Module`, `LicenseModule` |
| Notifications | `Notification`, `NotificationReceipt` |
| Crash | `CrashReport` |
| Audit | `AuditLog` |
| Marketing | `Lead`, `NewsletterSubscriber` |

Hygiène de schéma : `@@index`/`@@unique` appropriés, cascades, HWID jamais
stocké en clair (HMAC-SHA256 uniquement). Migrations : **5 migrations ordonnées**
+ `migration_lock.toml` pinné PostgreSQL (`prisma/migrations/` : `0_init`,
`add_app_release`, `control_plane_extensions`, `add_leads_newsletter`,
`add_device_auth`).

## 3. Services cœur — **Opérationnel**

### 3.1 Service de licences (`src/lib/licenses/service.ts`)
- Vérification cryptographique **ES256/ECDSA P-256** contre une clé publique
  P-256 réelle embarquée (`verify.ts:74-141`, `public-key.ts:8-13`), sans jamais
  lever d'exception.
- **Device auth** : tokens device opaques signés HMAC avec `tokenVersion` pour
  révocation (`device-token.ts:76-135`) ; HWID stocké seulement en HMAC-SHA256.
- **Enforcement de sièges TOCTOU-safe** : `SELECT … FOR UPDATE` (verrou
  pessimiste) dans une transaction Prisma avec recomptage de contrôle
  (`service.ts:411-472`) ; test d'intégration Postgres (skip par défaut).
- **Heartbeat strict fail-closed** : la route `check` renvoie 503 sur erreur
  d'infra plutôt que `allowed:true` (jamais d'autorisation sur défaillance DB).

### 3.2 Releases & mises à jour (`src/lib/releases/`)
- Publication + rollout/rollback manuel (`rolloutPercent`, ciblage, rollback
  immédiat) — `publishRelease`/`updateRelease` (`service.ts:105-157`, `171-228`),
  route admin PATCH, UI `/admin/updates`. **Opérationnel.**
- **Manifeste de MAJ signé Ed25519** (`manifest.ts:40-79`), sérialisation
  canonique déterministe identique au client Electron ; émis uniquement si
  `UPDATE_SIGNING_PRIVATE_KEY`/`KEY_ID` configurés (sinon `null`). **Opérationnel.**
- **Rollback automatique sur crash** : `autoRollbackIfUnhealthy` implémenté et
  durci contre l'abus (seuls les HWID de devices enregistrés comptent,
  `crashes/service.ts:202-221`). **Réserve :** d'origine **aucun cron Vercel** ne
  l'invoquait (`vercel.json` absent) — un **Vercel Cron avec auth fail-closed
  `CRON_SECRET`** a été ajouté cette session.

### 3.3 Autres services opérationnels
- **Crash reporting** : fingerprinting, groupement, stats, triage
  (`crashes/service.ts` + `/api/crash` + `/admin/crashes`).
- **Modules / entitlements** : `computeEffectiveModules`, renvoyés dans
  activate/check (`modules/service.ts`, UI `/admin/modules`).
- **Notifications** ciblées avec accusés (`notifications/service.ts`).
- **Journal d'audit global** recherchable/CSV (`server/audit.ts`, `AuditLog`).
- **Upload d'installateur** via Vercel Blob (`blob-upload/route.ts`, gated clé
  admin ; renvoie 501 si `BLOB_READ_WRITE_TOKEN` absent).

## 4. API admin et authentification — **Opérationnel (avec réserve IAM)**

- Toute la surface `/api/admin/*` est gardée par **une seule clé maître**
  `LICENSE_ADMIN_API_KEY`, comparée en **temps constant** côté serveur
  (`src/lib/licenses/auth.ts:28-41`) + rate-limit distribué + audit
  (`src/lib/server/admin.ts:33-66`).
- SSE admin via cookie-token HMAC court (`sse-token.ts`) — la clé maître n'est
  jamais placée dans l'URL EventSource.
- **Réserve de divulgation (identité admin) :** pas de modèle multi-utilisateur.
  Le back-office navigateur conserve la clé maître en `sessionStorage` et
  l'envoie à chaque requête (`src/app/admin/_lib/client.ts:9-52`) —
  exposable par XSS, aucun compte par opérateur, pas de RBAC, rotation nécessitant
  un redéploiement. Les entrées d'audit ne sont pas attribuables à une personne.

## 5. Rate limiting et environnement fail-closed — **Opérationnel**

- **Rate limiting distribué** sur les routes sensibles via **Upstash Redis**,
  avec politique **fail-closed en production** (`rate-limit-distributed.ts:96-129`) :
  activate/check/admin renvoient **503** plutôt que de dégrader silencieusement.
- **Validation d'environnement au démarrage** : refus de démarrer en production
  si des secrets sont manquants/trop courts/valeurs d'exemple
  (`src/lib/env.ts:63-103`, câblé via `instrumentation.ts`). En prod, requiert
  `DEVICE_TOKEN_SECRET` (≥32), `HWID_HMAC_SECRET` (≥32),
  `UPSTASH_REDIS_REST_URL`/`TOKEN`.
- Durcissement web : CSP stricte, HSTS en prod, `noindex` sur `/admin`,
  `X-Frame-Options: DENY` (`next.config.mjs:12-54`).
- **Réserve :** `next.config.mjs` fixe `eslint: { ignoreDuringBuilds: true }`
  (ESLint sauté au build ; le typecheck et un lint séparé restent exécutés en CI).
  L'audit de dépendances CI est `continue-on-error` (non bloquant), contrairement
  au dépôt desktop.

## 6. API publique `/api/v1` — **Démo en mémoire (NON persistant)**

- Toutes les ressources `/api/v1/*` (clients, véhicules, factures, devis, pièces,
  rendez-vous, mécaniciens) sont adossées à une **`Map` en mémoire amorcée par
  clé d'API**, **explicitement documentée comme non persistante**
  (`src/lib/api/store.ts:1-8`). Sur Vercel serverless : écritures perdues à chaque
  cold start, non partagées entre instances → **non fonctionnel comme surface
  d'intégration de production**.
- Une route OpenAPI existe (`v1/openapi.json`) et l'isolation par clé fonctionne,
  mais le **rate limiter v1 est une `Map` par instance** (`src/lib/api/auth.ts:48-67`),
  **non distribué** — contrairement aux routes de licence.
- CORS par défaut à `*` si `GARAGEFLOW_API_CORS_ORIGIN` non défini
  (`src/lib/api/http.ts:9`), contredisant le commentaire de `.env.example`.
- **Aucun système de webhook / événement sortant** malgré le cadrage
  « intégration » (seul le callback `onUploadCompleted` de Vercel Blob existe, et
  il est inactif). **NON CONSTRUIT.**

> **Divulgation valorisation :** ne pas valoriser `/api/v1` comme une plateforme
> d'intégration fonctionnelle. La rendre réelle exige de brancher `store.ts` sur
> la base, avec autorisation par clé, rate limiting distribué et webhooks.

## 7. Chiffres vérifiés (session 2026-07-31)

| Indicateur | Valeur |
|---|---|
| Modèles Prisma | 13 |
| Routes API | 56 (dont `/api/v1/*` versionné + `v1/openapi.json`) |
| Tests unitaires (hors intégration) | 140 passés / 0 échec (18 suites) |
| `tsc --noEmit` | exit 0 |
| Migrations | 5 ordonnées + `migration_lock.toml` (PostgreSQL) |

> Réserve : la suite complète inclut des tests d'intégration PostgreSQL/Redis
> exécutés en CI, non reproduits localement. L'état réel du déploiement Vercel
> (scheduling cron, configuration des clés de signature) n'a pas pu être observé.

## 8. Rappel — actifs P0 hors dépôt

Le control-plane ne peut opérer que si sont transférés : la **clé privée de
signature des MAJ Ed25519** (variable serveur, absente du dépôt), la **clé privée
de licence P-256**, le **backend/base en fonctionnement** (`api.garageflows.fr`),
les **domaines/DNS/hébergement** `garageflows.fr`, et une **cession de PI écrite**.
Ce sont des **conditions de closing** (transferts d'actifs externes), pas des
livrables de code.

---
*Réf. croisée : voir `docs/ACQUISITION_READINESS_AUDIT.md` pour la synthèse des risques classés et des scores de préparation.*
