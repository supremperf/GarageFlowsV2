# Guide de build & release — écosystème GarageFlow

Ce guide couvre les deux produits :

- **GarageFlow Desktop** (`GarageFlowsV2`) — Electron + Next.js, SQLite locale ;
- **GarageFlow Control-Plane / Vitrine / PWA** (`garagesite3`) — Next.js, PostgreSQL/Neon.

Les commandes marquées ✅ ont été **exécutées et vérifiées** pendant l'audit de
production (voir `docs/AUDIT_PRODUCTION_FINAL.md`, tableau de preuves). Celles
marquées ⚠️ nécessitent un environnement externe (Windows, Neon, Vercel) et
n'ont pas pu être exécutées ici — la procédure exacte est fournie.

---

## 1. GarageFlow Desktop (`GarageFlowsV2`)

### 1.1 Prérequis

- Node.js ≥ 20 (audit réalisé avec **Node 22.22.2**, npm 10.9.7).
- Python 3 (uniquement pour la génération de clés de licence — `scripts/keygen.py`).
- Windows + (optionnellement) Wine pour le packaging NSIS final.

### 1.2 Installation

```bash
npm install          # ✅ postinstall = setup-dev + prisma generate (x2 clients)
```

Le `postinstall` :
1. `scripts/setup-dev.js` — crée un `.env` de dev depuis `.env.example` et génère
   un `NEXTAUTH_SECRET` aléatoire (jamais commité) ;
2. `prisma generate` — client **desktop** SQLite (`@prisma/client`) ;
3. `prisma generate --schema prisma/server/schema.prisma` — client **serveur**
   PostgreSQL (`src/generated/server-client`).

### 1.3 Contrôles qualité (à lancer avant tout release)

```bash
npx tsc --noEmit     # ✅ typecheck — 0 erreur
npx next lint        # ✅ lint — 0 warning/erreur
npm test             # ✅ vitest — 670 tests (24 d'intégration ignorés sans infra)
```

**Tests d'intégration réels** (PostgreSQL + Redis) — dé-ignorés en fournissant
les URLs :

```bash
# PostgreSQL 16 + Redis 7 requis
TEST_POSTGRES_URL="postgresql://user@host:5432/gfv2test" \
TEST_REDIS_URL="127.0.0.1:6379" \
  npx vitest run src/lib/__tests__/license-devices.postgres.int.test.ts \
                 src/lib/__tests__/licensed-session.postgres.int.test.ts \
                 src/lib/__tests__/rate-limit-multi-instance.int.test.ts
# ✅ 24 tests — appareils/licence, session licenciée, rate-limit multi-instance
```

### 1.4 Build web (bundle standalone)

```bash
npm run build        # ✅ prisma generate x2 + next build (output: standalone)
node scripts/post-build.js   # ✅ assemble .next/standalone (statics, prisma, DB template, clé publique)
```

`post-build.js` **supprime tout `.env` du bundle standalone** (durcissement
ajouté pendant l'audit : le desktop reçoit ses variables à l'exécution via
`electron/main.js`, aucun secret ne doit être packagé).

⚠️ **Avant un vrai build de distribution**, générer la paire de clés de licence
si absente (sinon `keys/public.pem` manque et la vérification de licence est
impossible) :

```bash
python scripts/keygen.py --init   # crée keys/private.pem (NE PAS COMMITTER) + keys/public.pem
```

### 1.5 Smoke-test du bundle (sans Electron) ✅

Vérifié pendant l'audit : le serveur standalone démarre et sert l'API contre une
base SQLite réelle.

```bash
cd .next/standalone
cp prisma/garageflow-template.db /tmp/smoke.db
DATABASE_URL="file:/tmp/smoke.db" NEXTAUTH_SECRET="<32+ chars>" \
NEXTAUTH_URL="http://127.0.0.1:4099" ELECTRON=1 NODE_ENV=production \
PORT=4099 HOSTNAME=127.0.0.1 node server.js
# ✅ « Ready in ~200ms » ; GET /api/health → {"ok":true,"db":"connected"}
# ✅ GET /api/clients sans session → 401 UNAUTHENTICATED (auth serveur effective)
# ✅ En-têtes CSP / X-Frame-Options: DENY / nosniff / HSTS présents
```

### 1.6 Packaging Windows (NSIS)

```bash
npm run dist         # ⚠️ npm run build + post-build + electron-builder --win --x64
```

⚠️ **Non exécutable dans cet environnement Linux headless** (nécessite Windows,
ou Wine + mono pour NSIS). Procédure de validation à réaliser sur Windows :
1. Lancer `npm run dist` — produit `dist/GarageFlow Setup <version>.exe`.
2. Installer sur Windows 10 **et** 11 (utilisateur standard, sans droits admin —
   `requestedExecutionLevel: asInvoker`, `perMachine: false`).
3. Vérifier la création de `<userData>/garageflow.db` au premier lancement.
4. Tester un chemin d'installation avec espaces et un nom d'utilisateur accentué.
5. Vérifier la désinstallation et la conservation contrôlée des données.

### 1.7 Migrations (Desktop)

Le desktop **n'utilise pas** `prisma migrate` à l'exécution : la base est créée
par copie du template commité `prisma/garageflow-template.db`, puis les
migrations SQL **idempotentes** de `src/lib/migrations.ts` (≈120 entrées) sont
appliquées au démarrage via `POST /api/internal/migrate` (protégé par
`X-Internal-Key`). Pour faire évoluer le schéma, voir
`docs/DATABASE_ARCHITECTURE.md` (modifier les DEUX schémas + ajouter l'entrée SQL
idempotente + régénérer le template).

---

## 2. Control-Plane / Vitrine / PWA (`garagesite3`)

### 2.1 Installation & contrôles ✅

```bash
npm install          # ✅ postinstall = prisma generate
npx tsc --noEmit     # ✅ typecheck — 0 erreur  (script: npm run typecheck)
npm run lint         # eslint
npm test             # ✅ vitest — 135 tests (13 d'intégration ignorés sans infra)
```

**Tests d'intégration réels** :

```bash
TEST_DATABASE_URL="postgresql://user@host:5432/gftest" \
  npx vitest run src/lib/licenses/__tests__/device-seats.integration.test.ts
# ✅ 9 tests — sièges/concurrence TOCTOU (verrou FOR UPDATE + re-comptage) sur PostgreSQL réel

TEST_REDIS_URL="redis://127.0.0.1:6379" \
  npx vitest run src/lib/server/__tests__/rate-limit-distributed.integration.test.ts
# ✅ 4 tests — limiteur distribué (fenêtre PEXPIRE) sur Redis réel
```

### 2.2 Build ✅

```bash
npm run build        # ✅ prisma generate + next build
```

### 2.3 Migrations (PostgreSQL/Neon)

```bash
# Développement (crée une migration)
npm run db:migrate:dev
# Production (applique les migrations — utilise DIRECT_DATABASE_URL non poolée)
npm run db:migrate            # prisma migrate deploy
```

⚠️ Les migrations doivent utiliser **`DIRECT_DATABASE_URL`** (connexion Neon
directe, non poolée). L'application utilise **`DATABASE_URL`** (poolée). Ne
**jamais** lancer de migration destructrice automatiquement à chaque requête.

### 2.4 Déploiement Vercel

⚠️ **Non exécuté ici** (nécessite un compte Vercel + une base Neon). Procédure :
1. Racine du projet : `garagesite3`. Build command : `npm run build`.
   Install : `npm install`. Node : ≥ 20.
2. Variables d'environnement (voir `docs/CONFIGURATION_GUIDE.md`) — **toutes**
   les variables de production requises, sinon le démarrage est **refusé**
   (fail-closed, `src/lib/env.ts`).
3. Appliquer les migrations avec `DIRECT_DATABASE_URL` avant/à la release.
4. Vérifier `GET /api/health` en preview puis en production.

---

## 3. Ordre de release recommandé

1. `garagesite3` (control-plane) d'abord — c'est la **source de vérité** des
   licences et le serveur de mises à jour. Déployer, migrer, vérifier `/api/health`.
2. Publier la mise à jour desktop **signée** via l'admin control-plane
   (`/api/admin/update/publish`) — voir `docs/UPDATE-SIGNING.md` (garagesite3).
3. Builder et signer l'installateur Desktop (`npm run dist` sur Windows).
4. Le client desktop détecte la mise à jour, **vérifie SHA-256 + signature** du
   manifeste avant installation (aucune installation sans validation crypto).

## 4. Rollback

- **Web/PWA** : redéployer la version Vercel précédente. Ne pas exécuter de
  migration descendante destructrice ; préférer une migration corrective.
- **Desktop** : le mécanisme de mise à jour refuse le downgrade ; un rollback
  se fait en republiant un manifeste signé pointant vers l'installateur ciblé.
