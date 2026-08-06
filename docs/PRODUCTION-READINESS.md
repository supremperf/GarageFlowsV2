<!-- SOURCE DE VÉRITÉ — NE PAS marquer ce fichier comme historique. -->

# GarageFlows — État de préparation à la production (SOURCE DE VÉRITÉ)

> Ce document est la **seule source de vérité** sur l'état de préparation à la
> production. En cas de contradiction avec tout autre rapport du dépôt, **ce
> document fait foi**. Les anciens rapports d'étape sont marqués **HISTORIQUE**
> et renvoient ici (voir `docs/history/`).

## 1. Identité de la version auditée

| Champ | Valeur |
|---|---|
| Produit | **GarageFlows** (desktop Electron + PWA/serveur) |
| Version applicative | **1.1.0** (`package.json`) — `src/config/app.ts` réaligné sur 1.1.0 |
| Branche | `claude/garageflow-final-unified-merge-ub0l67` |
| Commit de base | `d650beb` (+ présent lot : monnaie / docs / marque) |
| Date de dernière validation | **2026-08-06** |
| Environnement de validation | CI/Linux (Node), **sans** Windows/PowerShell, **sans** PostgreSQL/Neon réel, **sans** navigateur e2e stable |

## 2. Verdict global

> **PAS « production-ready ». Statut : PRÉPARÉ — NON DÉPLOYÉ — SOUS CONDITIONS.**

Le code est mûr et validé par l'outillage disponible (types, lint, tests
unitaires, build, `prisma validate`). Il **n'est pas** déployé en production et
il **reste des bloqueurs d'infrastructure et des actions manuelles obligatoires**
(rotation de secrets, convergence du schéma Neon, réparation post-rotation,
décision sur la clé de licence, validations Windows et externes). Tant que la
section 6 comporte un **BLOQUEUR** ou une **ACTION MANUELLE REQUISE** non levés,
le produit **ne doit pas** être présenté comme prêt pour la production.

Statuts employés : **VALIDÉ** · **ÉCHEC** · **NON EXÉCUTÉ** · **ACTION MANUELLE REQUISE** · **BLOQUEUR** · **RISQUE ACCEPTÉ**.

## 3. Contrôles réellement exécutés (2026-08-06)

<!-- BLOC-VALIDATION-DEBUT : rempli à partir de l'exécution réelle -->

| Contrôle | Commande | Résultat | Détail |
|---|---|---|---|
| Types | `npm run type-check` (`tsc --noEmit`) | **VALIDÉ** | 0 erreur |
| Lint | `npm run lint` (`next lint`) | **VALIDÉ** | 0 erreur/avertissement |
| Tests unitaires/intégration | `npm test` (`vitest run`) | **VALIDÉ** | 1008 passés · 26 ignorés · 100 fichiers |
| Build | `npm run build` (`prisma generate ×2 + next build`) | **VALIDÉ** | *Compiled successfully* · 16/16 pages |
| Schéma desktop | `npm run db:desktop:validate` | **VALIDÉ** | SQLite valide |
| Schéma serveur | `npm run db:server:validate` | **VALIDÉ** | PostgreSQL valide (URL factices en CI) |
| Version SemVer | `node scripts/check-version.js` | **VALIDÉ** | 1.1.0 cohérent (app.ts réaligné) |
| Marque | `node scripts/check-branding.mjs` | **VALIDÉ** | 543 fichiers · manifestes + icônes OK |
| Cohérence docs | `node scripts/check-docs-consistency.mjs` | **VALIDÉ** | aucune affirmation contradictoire active |

<!-- BLOC-VALIDATION-FIN -->

## 4. Contrôles NON exécutés ici (nécessitent un autre environnement)

| Contrôle | Statut | Comment reproduire |
|---|---|---|
| E2E Playwright (`npm run test:e2e`) | **NON EXÉCUTÉ** | poste avec navigateur ; `npx playwright test` |
| Migration Prisma sur base **avec données** | **NON EXÉCUTÉ** | Neon de staging ; §7 |
| Build Electron / Windows, Fuses, Authenticode | **NON EXÉCUTÉ** | poste Windows ; `npm run dist` |
| `RESET-GARAGEFLOW.cmd` (PowerShell) | **NON EXÉCUTÉ** | poste Windows ; voir `EINVOICING_RESET_COMPATIBILITY.md §6` |
| Gitleaks / scan de secrets | **NON EXÉCUTÉ** | CI dédiée |
| Concurrence PostgreSQL réelle, preuve de restauration | **NON EXÉCUTÉ** | staging Neon + Upstash |

> ⚠️ Les scripts `test:unit`, `test:integration`, `test:security`,
> `test:isolation`, `build:electron`, `build:pwa` **n'existent pas** dans
> `package.json` : ne pas les invoquer ni prétendre les avoir exécutés. Les tests
> de sécurité / d'isolation existent **en tant que fichiers** et tournent dans
> `npm test` (vitest), pas comme scripts npm distincts.

## 5. Bloqueurs de CODE

**Aucun bloqueur de code connu** à cette date (types/lint/tests/build au vert).
Cette ligne ne vaut que pour le **code** : elle ne signifie pas « production
prête » — voir §6.

## 6. Bloqueurs d'INFRASTRUCTURE & actions manuelles (À LEVER avant production)

| # | Élément | Statut | Détail / source |
|---|---|---|---|
| B1 | Rotation des secrets exposés (`GARAGEFLOW_API_KEY`, `NEXTAUTH_SECRET` distinct, `LICENSE_ADMIN_API_KEY`, DB Neon) + purge d'historique git | **BLOQUEUR** | `docs/SECRETS_ROTATION.md`, `docs/ENTERPRISE_AUDIT.md §0` |
| B2 | Convergence/migration du schéma Neon prod (migrations `20260804*`/`20260805*`/einvoicing `20260806` **non appliquées** → HTTP 500 observé) via DDL idempotent, puis réalignement `_prisma_migrations` | **BLOQUEUR** | `docs/POST_ROTATION_RECOVERY.md §7` |
| B3 | Réparation post-rotation (re-MAC `recordMac`, reset des appareils, re-chiffrement SMTP, ré-inscription 2FA) après la rotation destructive du 2026-08-04 | **ACTION MANUELLE REQUISE** | `docs/POST_ROTATION_RECOVERY.md` |
| B4 | **Décision** sur la paire ECDSA de licence : revenir à l'ancienne clé (`7bed3cb7…`) **ou** ré-émettre toutes les licences | **BLOQUEUR** | `docs/POST_ROTATION_RECOVERY.md §3` |
| B5 | Validation Windows réelle : build Electron, Fuses / `EnableEmbeddedAsarIntegrityValidation`, signature Authenticode, `RESET-GARAGEFLOW.cmd` (dry-run), keygen GUI | **ACTION MANUELLE REQUISE** | `docs/HARDENING_REPORT.md §4` |
| B6 | Validations externes : FEC/TVA (expert-comptable), RGPD/juridique, connecteurs fournisseurs, e-invoicing Phases 3-6, tests de charge PostgreSQL + preuve de restauration end-to-end | **ACTION MANUELLE REQUISE** | `docs/EINVOICING_ARCHITECTURE.md`, `docs/HARDENING_REPORT.md` |
| B7 | `GF_INTEGRITY_MODE=enforce` uniquement **après** validation du build Windows signé | **ACTION MANUELLE REQUISE** | `docs/CONFIGURATION.md` |

## 7. Risques acceptés (non bloquants)

- **RISQUE ACCEPTÉ** — Stockage : quelques colonnes de **totaux** restent en Float
  en base **pendant la transition** (colonnes `*Cents` ajoutées, source de vérité,
  Float maintenu en miroir dérivé). Le retrait des colonnes Float se fait par
  l'opérateur **après** vérification sur données réelles (voir `docs/MIGRATION-MONEY.md`).
  La **correction du calcul** monétaire est, elle, déjà garantie (centimes entiers).
- **RISQUE ACCEPTÉ** — `EnableEmbeddedAsarIntegrityValidation=false` tant que le
  build Windows signé n'est pas validé (réévaluer avant release — B5).
- **RISQUE ACCEPTÉ** — Numérotation FAC des brouillons pouvant laisser des trous
  FEC (voir `docs/HARDENING_REPORT.md §5`), à arbitrer avec l'expert-comptable.

## 8. Conditions précises pour déclarer « production prête »

Le produit pourra être déclaré prêt **uniquement** lorsque **tous** les points
suivants sont vrais et **datés** :

1. B1 à B7 (§6) marqués **VALIDÉ** avec preuve.
2. E2E, migration sur données, build Windows signé, Gitleaks : **VALIDÉ** (§4).
3. Une **baseline de tests unique**, datée et rattachée à un SHA (fin des comptes
   divergents — voir §9).
4. Ce document mis à jour (date, commit, statuts) et `check-docs-consistency`
   au vert.

## 9. Note sur les baselines de tests divergentes

Les anciens rapports annoncent des totaux de tests différents (137, 204, 694,
740, 760/765, 843, 869, 912, 947…), chacun « tout vert » sur une branche/instant
distinct. **Seule** la baseline de la §3, datée et rattachée au commit courant,
fait foi. Les autres comptes sont des instantanés historiques (voir `docs/history/`).

## 10. Documents rattachés

- **Runbooks vivants** (procédures, pointent vers ce document) :
  `PRODUCTION_DEPLOYMENT.md`, `SECRETS_ROTATION.md`, `ROTATION_SECRETS.md`,
  `POST_ROTATION_RECOVERY.md`, `CONFIGURATION.md`, `EINVOICING_*.md`,
  `MIGRATION-MONEY.md`, `DATABASE_ARCHITECTURE.md`, `README.md`, `CHANGELOG.md`.
- **Annexes historiques** (instantanés figés, ne font plus foi) : `docs/history/`
  et les rapports racine marqués **HISTORIQUE**.
