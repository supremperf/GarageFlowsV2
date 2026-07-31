# Développement local — les deux dépôts

> Document de data room. Décrit l'installation et le cycle de développement local
> des deux dépôts, à partir des scripts `package.json` réels.
>
> - `GarageFlowsV2` : desktop Electron + Next.js 14 + SQLite (mono-poste),
>   avec une cible web/PWA partagée.
> - `garagesite3` : control-plane cloud Next.js 15 + PostgreSQL.

## 1. Prérequis

- **Node.js** ≥ 20 (les deux dépôts déclarent `@types/node@^20`).
- **npm** (lockfiles npm dans les deux dépôts).
- Pour la génération de licences desktop : **Python 3** + `pip install
  cryptography` (voir `scripts/keygen.py`, cf. `docs/WINDOWS_BUILD_GUIDE.md`).
- Pour les tests d'intégration : instances **PostgreSQL** et **Redis** (fournies
  par la CI ; localement optionnelles — les tests se *skippent* proprement sans
  elles).

## 2. `GarageFlowsV2` (desktop + web)

### Installation

```bash
cd GarageFlowsV2
npm install
```

`postinstall` exécute automatiquement `setup-dev.js` (génère un
`NEXTAUTH_SECRET` de dev, prépare `.env`) puis `prisma generate` pour **les deux
schémas** (desktop SQLite + serveur PostgreSQL).

### Base de données (SQLite locale)

```bash
npm run db:push        # applique le schéma desktop à la base SQLite locale
npm run db:seed        # jeu de données de démonstration
npm run db:reset       # db push --force-reset + seed (repart de zéro)
npm run db:studio      # Prisma Studio (inspection visuelle)
```

Schéma serveur (PostgreSQL, cible web) :

```bash
npm run db:server:validate   # valide prisma/server/schema.prisma
npm run db:server:migrate    # migrate dev (base PostgreSQL de dev)
npm run db:server:deploy     # migrate deploy (appliquer en cible)
npm run db:server:check      # validation complète (scripts/validate-server-db.js)
```

### Lancer en développement

```bash
npm run dev            # Next.js seul (web) — predev lance setup-dev.js
npm run dev:electron   # Next.js sur le port 4028 (attendu par Electron)
npm run electron:dev   # lance le shell Electron (ELECTRON_DEV=1)
```

Flux desktop typique : un terminal `npm run dev:electron`, un second
`npm run electron:dev`.

### Qualité : tests, typecheck, lint

```bash
npm test               # vitest run (suite unitaire/intégration)
npm run test:watch     # vitest en mode watch
npm run test:coverage  # couverture v8 (mesurée, non barrée — voir audit)
npm run lint           # next lint (ESLint)
npx tsc --noEmit       # vérification TypeScript stricte
```

**État vérifié (session 2026-07-31)** : sous-ensemble non-intégration
**678 tests OK / 0 échec (64 suites)** ; `tsc --noEmit` exit 0. La suite complète
inclut en plus des tests d'intégration PostgreSQL/Redis (`*.postgres.int.test.ts`,
`*.integration.test.ts`) qui tournent en CI (non reproduits localement).

> Note : `next.config.mjs` ne définit **ni** `ignoreBuildErrors` **ni**
> `ignoreDuringBuilds` — TypeScript **et** ESLint bloquent le build.

## 3. `garagesite3` (control-plane cloud)

### Installation

```bash
cd garagesite3
npm install            # postinstall : prisma generate
```

Copier la configuration : `cp .env.example .env.local` puis renseigner au minimum
`DATABASE_URL` / `DIRECT_DATABASE_URL` (PostgreSQL de dev) et les secrets (en dev,
le repli sur `NEXTAUTH_SECRET` est toléré pour device-auth).

### Base de données (PostgreSQL)

```bash
npm run db:generate      # prisma generate
npm run db:migrate:dev   # prisma migrate dev (crée/applique en dev)
npm run db:migrate       # prisma migrate deploy (cible)
npm run db:studio        # Prisma Studio
```

### Lancer en développement

```bash
npm run dev              # next dev
```

### Qualité : tests, typecheck, lint

```bash
npm test                 # vitest run
npm run test:watch       # vitest watch
npm run typecheck        # tsc --noEmit
npm run lint             # next lint
```

**État vérifié (session 2026-07-31)** : sous-ensemble non-intégration
**140 tests OK / 0 échec (18 suites)** ; `tsc --noEmit` exit 0.

> Note d'honnêteté : `garagesite3/next.config.mjs` définit
> `eslint: { ignoreDuringBuilds: true }` — ESLint est **ignoré au build** mais
> exécuté séparément en CI ; le typecheck reste actif.

### Tests d'intégration (optionnels en local)

Les suites d'intégration se *skippent* automatiquement (`describe.skipIf`) quand
`TEST_DATABASE_URL` / `TEST_POSTGRES_URL` / `TEST_REDIS_URL` sont absentes, donc
`npm test` reste vert localement. En CI, elles s'exécutent contre de vrais
services `postgres:16` + `redis:7`. Pour les rejouer localement, exporter ces URL
vers des instances jetables.

## 4. Portée fonctionnelle (rappels honnêtes)

À garder en tête pendant le développement (voir
`docs/ACQUISITION_READINESS_AUDIT.md`) :

- Modèle opérationnel **mono-garage par installation** — **pas** d'entité
  Organisation/Réseau au-dessus de `Garage` (roadmap).
- **Pas** d'e-invoicing (Factur-X/UBL/CII/PDP) ; **pas** d'assistant d'import
  CSV/Excel générique ; **pas** de tests E2E (Playwright/Cypress).
- L'API publique `/api/v1/*` de `garagesite3` est un **bac à sable en mémoire non
  persistant** (démo), pas une intégration de production.

---
*Voir aussi : [`docs/ACQUISITION_READINESS_AUDIT.md`](./ACQUISITION_READINESS_AUDIT.md) pour l'audit complet de préparation à la cession.*
