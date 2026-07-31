# 08 — Tests et qualité

> Les chiffres de tests/builds ci-dessous proviennent de vérifications **de première main** effectuées cette session (2026-07-31). Ce sont les seuls chiffres à citer.

## 1. Résultats de tests / build vérifiés (autoritatifs)

| Dépôt | Tests (sous-ensemble non-intégration) | `tsc --noEmit` |
|---|---|---|
| GarageFlowsV2 (desktop) | **678 passés / 0 échec** (64 suites) — inclut le nouveau `brand.test.ts` (8) | exit 0 |
| garagesite3 (cloud) | **140 passés / 0 échec** (18 suites) — inclut le nouveau `cron-auth.test.ts` (5) | exit 0 |

Notes de vérification :
- Les suites **complètes** incluent en plus des tests d'intégration PostgreSQL/Redis (`*.postgres.int.test.ts`, `*.integration.test.ts`) qui **s'exécutent en CI** mais **n'ont pas été reproduits localement** ici.
- Un run antérieur (avant les changements de session) mesurait 660 passés / 10 skipped côté desktop, avec **1 suite en échec** (`src/integration/suppliers.test.ts` — `beforeAll` exécutant `prisma db push` en timeout à 10 s : **échec d'infra/timing, PAS un échec de logique**).
- Démo vérifiée : `prisma db push` (exit 0) + `npm run db:seed` (exit 0) sur une SQLite jetable → « Garage Demo » avec **5 mécaniciens et 13 jobs**.

## 2. Nature de la suite de tests

- **~87 fichiers de test** au total : 67 dans GarageFlowsV2 (708 cas `it/test` sur 193 blocs `describe`), 20 dans garagesite3 (149 cas).
- **Faible mocking** (seulement 13/67 fichiers V2 utilisent `vi.mock`) → tests majoritairement **d'intégration réels** : SQLite depuis template DB committé, exécution de vrais route handlers Next.js, isolation multi-tenant prouvée avec deux garages.
- Domaines commercialement porteurs bien couverts : isolation multi-tenant, licensing/seats device, HWID, vérification d'update, arrondi money/TVA, OCR/import catalogue.

## 3. CI (les deux dépôts)

Les deux pipelines `.github/workflows/ci.yml` gatent sur **typecheck ET lint ET build ET tests** :
- `tsc --noEmit`, `next lint`, `next build`, migrations sur PostgreSQL vide, suite complète contre **postgres:16 + redis:7** réels (health checks), scan de secrets **Gitleaks**, audit de dépendances.
- Aucun `typescript.ignoreBuildErrors` dans les deux `next.config.mjs` → les erreurs TS bloquent le build.
- GarageFlowsV2 a un **gate d'audit de dépendances bloquant** (`scripts/audit-ci.js`, échoue sur vulns prod high/critical) + un check de cohérence SemVer.

## 4. Gaps de qualité (à énoncer clairement)

| Gap | Détail | Sévérité audit |
|---|---|---|
| **Zéro test E2E** | Aucun Playwright/Cypress/Puppeteer dans les deux dépôts, malgré 3 surfaces (Electron, PWA, vitrine). Toute la couche présentation validée manuellement. | high |
| **Zéro test composant/UI** | 0 fichier `.tsx` de test ; pas de testing-library/jsdom ; tous les tests en environnement `node`. | high |
| **Couverture non gated** | V2 mesure la couverture v8 sans seuils ; site3 sans config de couverture → régressions invisibles. | medium |
| **Fichiers Electron shippés non testés** | `electron/*.js` (main, preload, control-plane, update-verify, integrity) sont des **doublons** des copies `src/lib` ; seuls les copies src sont testées → risque de divergence dans le binaire réellement livré, sur un chemin sensible (vérif signature d'update). | medium |
| **Audit deps non cohérent** | V2 = bloquant ; garagesite3 = `npm audit --audit-level=high` en **continue-on-error** (non bloquant) — le dépôt à plus forte valeur de confiance a le gate le plus faible. | low |
| **`eslint.ignoreDuringBuilds:true` côté cloud** | ESLint sauté au build (mitigé car lint tourne en étape CI séparée). | — |
| **Test PWA mince** | `pwa.test.ts` = 72 lignes, pas de validation offline/service-worker E2E. | — |

## 5. Impact pour l'acquéreur

L'absence totale d'automatisation E2E/UI signifie que toute modification d'interface risque une régression silencieuse. **Construire une couverture E2E pour les trois surfaces est un effort de plusieurs semaines** à budgéter avant tout refactor significatif ; cela contraint la vélocité de changement post-acquisition.

## 6. Hygiène de qualité (positif)

- `@ts-ignore`/`@ts-nocheck` : **1 seul** au total (src+electron). `eslint-disable` : 24.
- Système crypto de licence : ECC P-256 / ECDSA-SHA256, clé publique **réelle** embarquée (bypass dev inactif).
- `.env` gitignored, `.env.example` exemplaire (chaque variable documente objectif/environnement/requis/exemple/comportement-si-absent).

---
*Référence croisée : voir `docs/ACQUISITION_READINESS_AUDIT.md` pour l'audit de préparation complet.*
