# Implementation Baseline — GarageFlowsV2 (vérifié)

_Tous les chiffres proviennent de commandes réellement exécutées dans cet
environnement. Ce document est la **référence faisant autorité** ; il remplace
les compteurs de tests plus anciens et divergents cités ailleurs (660 / 678 /
694 / 726… → **739** aujourd'hui, la suite ayant grossi avec les nouveaux tests)._

## Contexte

| Champ | Valeur |
|---|---|
| Dépôt | `supremperf/GarageFlowsV2` |
| Branche | `claude/garageflow-acquisition-prep-914inr` |
| Commit (HEAD au moment de la mesure) | `4c1192e` |
| Date | 2026-08-01 |
| OS d'exécution | Linux (conteneur) — **Windows non disponible** |
| Node | v22.22.2 |
| npm | 10.9.7 |

## Versions clés

| Paquet | Version (package.json) |
|---|---|
| next | ^14.2.35 |
| react | ^18.3.1 |
| electron | ^31.7.7 |
| prisma / @prisma/client | ^5.16.1 (CLI 5.22.0) |
| typescript | ^5 |
| vitest | ^4.1.5 |
| zod | ^4.3.6 |
| next-auth | ^4.24.15 |

## Résultats de vérification (réels)

| Contrôle | Commande | Résultat |
|---|---|---|
| Lint | `npx next lint` | **PASS** — « ✔ No ESLint warnings or errors » (exit 0) |
| Typecheck | `npx tsc --noEmit -p tsconfig.json` | **PASS** — exit 0 |
| Tests unitaires + intégration (SQLite) | `npx vitest run --no-file-parallelism` (hors `*.int`/`*.postgres.int`) | **PASS** — **739 réussis / 0 échec / 0 ignoré**, **70 suites** |
| Tests d'intégration Postgres/Redis | `*.postgres.int.test.ts`, `*.integration.test.ts` (3 fichiers) | **BLOCKED_ENVIRONMENT** — nécessitent PostgreSQL + Redis (non provisionnés ici) ; exécutés en CI |
| Build web / PWA | `npm run build` (prisma generate ×2 + next build) | **PASS** — « ✓ Compiled successfully », sortie `standalone` présente |
| Packaging Windows | `electron-builder --win` | **BLOCKED_ENVIRONMENT** — nécessite Windows (ou wine + outillage) |
| Prisma validate (desktop) | `npx prisma validate` | **PASS** — schéma valide (37 modèles) |
| Prisma validate (serveur) | `npx prisma validate --schema prisma/server/schema.prisma` | **PASS** avec `DATABASE_URL`/`DIRECT_URL` définis (37 modèles). Sans ces variables : P1012 « Environment variable not found: DIRECT_URL » — **limitation d'environnement, pas une erreur de schéma**. |
| Audit dépendances | `npm audit` (dev+prod) | 30 avis : 1 critical, 24 high, 4 moderate, 1 low — **majoritairement transitifs** (outillage `next`/`vitest`/`sharp`/libvips). Suivi + remédiation : `docs/VULNERABILITY_MANAGEMENT.md`. |

> **Note test-count.** Le nombre exact **739** correspond à l'exécution
> mono-thread ci-dessus. En exécution **parallèle**, 3 suites d'intégration qui
> lancent `prisma db push` dans un `beforeAll` peuvent tomber en *hook timeout*
> (contention d'infra, **non** un échec logique) ; elles passent en isolation.
> Toujours mesurer en mono-thread pour un compte stable.

## Bases de données (séparation stricte — respectée)

| Cible | Schéma | Provider | Variable |
|---|---|---|---|
| Desktop (Electron) | `prisma/schema.prisma` | SQLite | `DATABASE_URL=file:…` (à l'exécution, injecté par Electron) |
| Serveur / PWA | `prisma/server/schema.prisma` | PostgreSQL | `DATABASE_URL` (poolé) + `DIRECT_URL` (migrations) |

- **Migrations desktop** : 2 patchs incrémentaux (`add_record_mac`,
  `add_audit_log_and_indexes`) **sans baseline init** → le desktop s'appuie sur
  `prisma db push` + une base template committée (`garageflow-template.db`).
  **Limitation connue** : pas de mécanisme de migration à l'exécution pour les
  installations existantes (voir `docs/KNOWN_LIMITATIONS.md`).
- **Migrations serveur** : 5 migrations avec baseline (`init_server`,
  `link_license_garage`, `premium_modules`, `enterprise_portal`) +
  `migration_lock.toml` → reproductibles.

## État des fonctionnalités (résumé — détail dans l'audit)

**Terminé & testé (PASS)** : licences ECC/HWID, MàJ signées Ed25519 (SHA-256
avant exécution), isolation multi-tenant garage-scoped (garde FK + tests),
sauvegardes chiffrées (lib), facturation électronique **bibliothèque** (UBL 2.1 +
CII/Factur-X XML, validateur EN 16931 cœur, sandbox, webhook, route API),
marque blanche (config + UI + codegen packaging), calculs financiers en centimes
entiers, upload photo durci (magic bytes), stock atomique.

**Partiel (PARTIAL)** : facturation électronique **sans persistance** (sandbox en
mémoire ; pas de table de transmissions) ; sauvegarde/restauration **sans UI** ;
observabilité partielle.

**Absent (FAIL / non construit)** : hiérarchie **multi-organisation/multi-garage**
opérationnelle (le modèle est mono-garage) ; **transmission PDP réelle** ;
**import CSV/XLSX** ; **E2E Playwright** ; **signature de code Windows**.

**Bloqué par l'environnement/externe** : build/installeur Windows
(BLOCKED_ENVIRONMENT) ; certificat de signature (BLOCKED_EXTERNAL) ; contrat PDP
(BLOCKED_EXTERNAL) ; audit/pentest externe (BLOCKED_EXTERNAL) ; validation
juridique/fiscale (BLOCKED_EXTERNAL).

## Limitations d'environnement (cette session)

- Pas de Windows → build/installeur/signature Electron non exécutables ici.
- Pas de PostgreSQL/Redis provisionnés → suites d'intégration cloud non
  exécutées localement (elles tournent en CI).
- Pas de certificat de signature, de contrat PDP, d'auditeur externe.

_Voir aussi : `docs/ACQUISITION_READINESS_AUDIT.md`,
`docs/FINAL_IMPLEMENTATION_REPORT.md`._
