# Tests responsive E2E (Playwright)

Deux entrées :

- **`responsive.spec.ts`** — suite `playwright test` (config `playwright.config.ts`) :
  6 gabarits d'écran, checks publics (page de connexion) + checks authentifiés
  (si `E2E_EMAIL` / `E2E_PASSWORD` fournis).
- **`audit.mjs`** — audit authentifié complet + captures avant/après, exécuté
  contre une instance locale seedée. C'est lui qui a produit les captures de
  validation (390×844, 844×390, 768×1024, 1440×900).

## Lancer l'audit authentifié en local

L'app est protégée par une porte de licence (middleware) + une session NextAuth.
En local on utilise SQLite + la seed, on désactive l'enforcement de licence et on
forge un cookie `gf_session` signé avec le **même** `NEXTAUTH_SECRET` que le serveur.

```bash
# 1. Env local (SQLite + secret + désactivation enforcement licence en DEV)
cat > .env <<EOF
DATABASE_URL="file:./dev.db"
DIRECT_URL="file:./dev.db"
NEXTAUTH_SECRET="<un secret fort ≥ 16 caractères>"
NEXTAUTH_URL="http://localhost:3000"
LICENSE_ENFORCEMENT=off          # DEV uniquement (cf. src/lib/license/session.ts)
EOF

# 2. Base seedée : garage démo, 5 mécaniciens, 13 interventions du jour
npx prisma db push --schema prisma/schema.prisma --skip-generate
npm run db:seed                  # affiche les identifiants du compte démo

# 3. Serveur (mode dev : SQLite autorisé, contrairement à la prod)
npx next dev -p 3000

# 4. Audit (identifiants de démo via l'env ; navigateur Chromium préinstallé)
NEXTAUTH_SECRET="<le même secret qu'en .env>" \
E2E_PASSWORD="<mot de passe du compte démo>" \
BASE_URL=http://localhost:3000 LABEL=after MODE=full \
  node e2e/audit.mjs
```

Sorties : `e2e/shots/<label>/*.png` + `results.json` (non versionnés).

## Suite `playwright test` AUTHENTIFIÉE — recette vérifiée (2026-08-13)

Sans `E2E_EMAIL` / `E2E_PASSWORD` / `E2E_LICENSE`, les tests d'application se
déclarent `skipped` : la suite passe alors 54/54 mais ne mesure QUE la page de
connexion. Pour exercer réellement l'application sur les six gabarits :

```bash
# Base dédiée + compte connu
DATABASE_URL="file:$PWD/prisma/e2e.db" npx prisma db push --skip-generate --accept-data-loss
DATABASE_URL="file:$PWD/prisma/e2e.db" SEED_ADMIN_PASSWORD="<mot de passe>"   npx ts-node --project tsconfig.seed.json prisma/seed.ts

# Serveur dédié. Les limites de débit sont DESSERRÉES pour la recette seulement :
# six gabarits en parallèle depuis 127.0.0.1 déclenchent des protections
# calibrées pour la production, la session est alors invalidée en cours de suite
# et les tests d'application retombent sur l'écran de connexion.
DATABASE_URL="file:$PWD/prisma/e2e.db" NEXTAUTH_URL="http://localhost:3100" NEXTAUTH_SECRET="<secret fort>" RATE_LIMIT_LOGIN_MAX=100000 RATE_LIMIT_API_MAX=100000 RATE_LIMIT_LICENSE_STATUS_MAX=100000 RATE_LIMIT_LICENSE_ACTIVATE_MAX=100000   npx next dev -p 3100

# Suite (licence GF2 signée par la clé de CE déploiement)
BASE_URL=http://localhost:3100 E2E_EMAIL="<compte>" E2E_PASSWORD="<mot de passe>" E2E_LICENSE="GF2.…" npx playwright test
```

**Ce qu'il faut savoir avant d'interpréter un échec.** La suite reste
partiellement instable dans cette configuration : les échecs observés ne sont
jamais les mêmes gabarits d'une exécution à l'autre, ils portent toujours sur
les tests d'application, et la page servie au moment de l'échec est **l'écran de
connexion** — la session a été perdue en cours de route. Chaque gabarit relancé
SEUL passe (`--project=mobile-landscape` → 15/15). Ce n'est donc pas un défaut
de mise en page : c'est un serveur de DÉVELOPPEMENT sollicité par six contextes
simultanés depuis une seule IP. Mesuré : 6 échecs sans desserrage des limites,
2 avec — sur 90 tests.

Un échec **reproductible sur un gabarit lancé seul** est, lui, un vrai défaut.

## Contre une Preview Vercel

Renseigner `BASE_URL` sur l'URL de la Preview et fournir des identifiants de test
valides sur la base connectée à cette Preview. Prérequis côté déploiement : une
base PostgreSQL de test isolée (jamais la production), `NEXTAUTH_SECRET`, Redis
(rate-limit multi-instance requis en production PWA — cf. `src/lib/env.ts`).
