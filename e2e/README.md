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

## Contre une Preview Vercel

Renseigner `BASE_URL` sur l'URL de la Preview et fournir des identifiants de test
valides sur la base connectée à cette Preview. Prérequis côté déploiement : une
base PostgreSQL de test isolée (jamais la production), `NEXTAUTH_SECRET`, Redis
(rate-limit multi-instance requis en production PWA — cf. `src/lib/env.ts`).
