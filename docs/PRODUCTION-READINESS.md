<!-- doc-status: actif -->

# GarageFlows — Résumé de préparation à la production

> **Ce document est un RÉSUMÉ de production. Pour la baseline machine et les
> mesures historiques, voir [`docs/audit/FINAL_VERIFICATION_BASELINE.md`](./audit/FINAL_VERIFICATION_BASELINE.md).
> Pour la revalidation ponctuelle du worktree Arena au 2026-10-22, voir le
> [rapport du candidat](./audit/2026-10-22/CANDIDATE_READINESS.md) : il est lié à
> sa branche/HEAD, non commité, et ne remplace pas la baseline machine.**
> Les chiffres historiques ci-dessous (§3, datés 2026-08-06) sont conservés comme
> instantané et NE représentent PAS l'état courant.

## 1. Identité (voir la baseline canonique pour les valeurs faisant foi)

| Champ | Valeur |
|---|---|
| Produit | **GarageFlows** (desktop Electron + PWA/serveur) |
| Version applicative | **1.1.0** (`package.json`) |
| Branche | `claude/garageflow-final-unified-merge-ub0l67` |
| État courant (commit, tests, toolchain) | → `FINAL_VERIFICATION_BASELINE.md` / `artifacts/verification/baseline.json` |
| Classification courante | **`DUE_DILIGENCE_READY_WITH_CONDITIONS`** (cf. `docs/audit/PRODUCTION_STATUS_LEVELS.md`) |

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

## 3. Baseline historique — instantané 2026-08-06 (NON courant)

> ⚠ **Historical result — not current baseline.** Les chiffres de ce tableau
> sont un instantané figé du 2026-08-06 (commit `5fd3dfa`). L'état **courant**
> faisant foi est dans `FINAL_VERIFICATION_BASELINE.md` /
> `artifacts/verification/baseline.json`. Conservé pour la traçabilité de
> l'évolution, jamais à confondre avec l'actuel.

<!-- BLOC-VALIDATION-DEBUT : instantané historique 2026-08-06 -->

| Contrôle | Commande | Résultat | Détail |
|---|---|---|---|
| Types | `npm run type-check` (`tsc --noEmit`) | **VALIDÉ** | 0 erreur |
| Lint | `npm run lint` (`next lint`) | **VALIDÉ** | 0 erreur/avertissement |
| Tests unitaires/intégration | `npm test` (`vitest run`) | **VALIDÉ** | *(instantané historique)* 1 040 passés · 26 ignorés · 104 fichiers ; avec `TEST_POSTGRES_URL` : 1 059 passés — **compte courant : voir baseline canonique** |
| Tests monétaires dédiés | `test:money` / `test:money-json` / `test:migration` | **VALIDÉ** | 4 décimales, JSON v1→v2, backfill, idempotence, **échecs simulés avec rollback**, sauvegarde pré-migration |
| Build | `npm run build` (`prisma generate ×2 + next build`) | **VALIDÉ** | *Compiled successfully* · 16/16 pages |
| Schéma desktop | `npm run db:desktop:validate` | **VALIDÉ** | SQLite valide · template au schéma final **baseliné** (179/179) |
| Schéma serveur | `npm run db:server:validate` | **VALIDÉ** | PostgreSQL valide |
| Migrations PostgreSQL sur base **VIDE** | `node scripts/validate-server-db.js` | **VALIDÉ** | **exécution réelle** (PG 16.13 local) : 12 migrations `migrate deploy`, statut propre, migration JSON v2 (0 doc), smoke CRUD |
| Migrations PostgreSQL sur base **PEUPLÉE** | psql (séquence legacy → migrations → contrôles) | **VALIDÉ** | **exécution réelle** : données Float legacy insérées, 17 colonnes converties exactement (65,5→655000 ; 12,3456→123456 ; NULL↔NULL), **test négatif** : valeur corrompue → `RAISE EXCEPTION` nommant la colonne, rollback total prouvé, puis DROP réussi (0 colonne Float restante) |
| Migration JSON v1→v2 PostgreSQL | `npm run db:server:migrate-json` | **VALIDÉ** | **exécution réelle** : WorkOrder v1 migré (12,3456×3 → `lineTotalCents` 3704), ordre **signé GELÉ verbatim**, total divergent → échec SANS écriture, ré-exécution idempotente |
| Version SemVer | `node scripts/check-version.js` | **VALIDÉ** | 1.1.0 cohérent |
| Marque (strict, repo entier) | `npm run check:branding` | **VALIDÉ** | 601 fichiers (src+scripts+keygen+cmd/ps1+racine) |
| PWA (manifestes + dimensions d'icônes) | `npm run check:pwa` | **VALIDÉ** | maskable 192/512 exactes |
| Monnaie — stockage | `npm run check:money` | **VALIDÉ** | **0 champ monétaire Float** (règle : zéro, bloquante) |
| Monnaie — calculs | `npm run check:money-calculations` | **VALIDÉ** | 0 calcul financier direct hors couche centrale |
| Monnaie — JSON persistants | `npm run check:money-json` | **VALIDÉ** | écritures via sérialiseurs v2 uniquement (3 exceptions justifiées, garde anti-exception-morte) |
| Sûreté des migrations | `npm run check:migration-safety` | **VALIDÉ** | runner atomique fail-closed, DROP⇒verifySql, ordre Electron sauvegarde→serveur→migration→fenêtre |
| Modèle SQLite (réel) | `npm run check:sqlite-template` | **VALIDÉ** | `integrity_check` ok, 0 violation FK, baseline 179/179, checksums conformes, schéma final |
| Migrations PostgreSQL (statique) | `npm run check:pg-migrations` | **VALIDÉ** | bijection 17/17 DROP⇔vérification, bloc de contrôle avant tout DROP |
| Cohérence docs | `node scripts/check-docs-consistency.mjs` | **VALIDÉ** | aucune affirmation contradictoire active |

<!-- BLOC-VALIDATION-FIN -->

## 4. Contrôles NON exécutés ici (nécessitent un autre environnement)

| Contrôle | Statut | Comment reproduire |
|---|---|---|
| E2E Playwright (`npm run test:e2e`) | **NON EXÉCUTÉ** | poste avec navigateur ; `npx playwright test` |
| Migration sur les données **de production réelles** (Neon) | **NON EXÉCUTÉ** | staging Neon (dump prod restauré) ; la séquence complète a été validée sur PG 16 local avec données legacy synthétiques (§3) — pas sur le dump réel |
| Build Electron / Windows, Fuses, Authenticode | **NON EXÉCUTÉ** | poste Windows ; `npm run dist` |
| Démarrage Electron réel (sauvegarde pré-migration + gate fail-closed) | **NON EXÉCUTÉ** (logique testée unitairement + ordre contrôlé par `check:migration-safety`) | poste Windows : premier lancement post-MàJ sur base ancienne |
| `RESET-GARAGEFLOW.cmd` (PowerShell) | **NON EXÉCUTÉ** | poste Windows ; voir `EINVOICING_RESET_COMPATIBILITY.md §6` |
| Gitleaks / scan de secrets | **NON EXÉCUTÉ** | CI dédiée |
| Rate limiting multi-instance (Redis) | **NON EXÉCUTÉ** (7 tests ignorés) | `TEST_REDIS_URL` vers un Redis de test |
| Preuve de restauration end-to-end | **NON EXÉCUTÉ** | staging Neon + Upstash |

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
| B5b | **Rename Windows `productName`→GarageFlows** : vérifier sur Win10/11 la mise à jour **en place** d'une install existante « GarageFlow » (appId inchangé), la **conservation des données** via l'épinglage userData sur `%APPDATA%\GarageFlow`, l'exe/raccourci/désinstalleur « GarageFlows », et le **pont de MàJ** (flux `product` conservé = « GarageFlow » interne) | **ACTION MANUELLE REQUISE** | `docs/PRODUCTION-READINESS.md` §Marque, `electron/main.js` (setPath userData) |
| B6 | Validations externes : FEC/TVA (expert-comptable), RGPD/juridique, connecteurs fournisseurs, e-invoicing Phases 3-6, tests de charge PostgreSQL + preuve de restauration end-to-end | **ACTION MANUELLE REQUISE** | `docs/EINVOICING_ARCHITECTURE.md`, `docs/HARDENING_REPORT.md` |
| B7 | `GF_INTEGRITY_MODE=enforce` uniquement **après** validation du build Windows signé | **ACTION MANUELLE REQUISE** | `docs/CONFIGURATION.md` |
| B8 | **Migration monétaire sur données réelles** : sauvegarde → staging (dump prod) → `db:server:deploy` (migrations à vérification par colonne) → `db:server:migrate-json` (JSON v1→v2, `--dry-run` d'abord) → contrôles → prod. La séquence complète (y compris échecs/rollback) est **prouvée sur PG 16 local avec données legacy synthétiques** — il reste à l'exécuter sur le dump réel. Desktop : sauvegarde pré-migration vérifiée puis migration fail-closed au démarrage (automatique) | **ACTION MANUELLE REQUISE** | `docs/MIGRATION-MONEY.md §6, §8, §9` |

## 7. Risques acceptés (non bloquants)

- **TERMINÉ (schéma) / ACTION MANUELLE (données prod)** — Monnaie : **plus aucun
  champ monétaire Float** dans les deux schémas (règle CI bloquante) ; stockage en
  entiers exacts (centimes + dix-millièmes), précision 4 décimales prouvée
  (`12,3456 × 3 = 37,04 €`), anciennes colonnes **supprimées**, aucune double
  écriture. Reste : exécuter la chaîne de migrations sur les **données réelles**
  (staging puis prod, sauvegarde préalable) — la vérification bloquante intégrée
  aux migrations refuse toute divergence. Procédure : `docs/MIGRATION-MONEY.md §6`.
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
740, 760/765, 843, 869, 912, 947, 1 040, 1 059, 1 301…), chacun « tout vert » sur
une branche/instant distinct — ce sont des **instantanés historiques** (*Historical
result — not current baseline*). **Le seul compte courant faisant foi** est celui
de la baseline canonique `FINAL_VERIFICATION_BASELINE.md`, dérivé de
`artifacts/verification/baseline.json` (généré, jamais recopié). Le garde-fou
`check-docs-consistency` interdit qu'un compte différent soit présenté comme
courant dans un document actif.

## 9bis. Marque & identité Windows (rename `GarageFlows`)

La marque **visible** est désormais **GarageFlows** partout : UI web/PWA, dialogues
et titre de fenêtre Electron, e-mails, `productName`/exe/installeur/raccourci/
désinstalleur, `copyright`, `author`. Garde-fou strict : `npm run check:branding`
(exceptions techniques précises **listées**, aucune liste blanche fourre-tout).

**Identifiants techniques CONSERVÉS** (renommer casserait installs/MàJ/crypto — chaque
occurrence est documentée par le garde-fou) :

| Identifiant | Fichier | Fonction | Pourquoi conservé |
|---|---|---|---|
| `com.garageflow.app` | `package.json` build.appId, `main.js` setAppUserModelId | identité OS + clé updater NSIS | changer = nouvelle identité applicative, casse l'auto‑update en place |
| `%APPDATA%\GarageFlow` (userData) | `main.js` `app.setPath('userData', …)` | dossier données (garageflow.db, licence, secret) | **épinglé** au nom historique → les installs existantes conservent leurs données malgré `productName`=GarageFlows |
| `garageflow.db`, `Software\GarageFlow` | `main.js`, `installer.nsh` | fichier BD + clé registre | chemins/clés des installs existantes |
| `GarageFlow-server` | `main.js` serviceName | keytar (identité OS) | orphelinerait les identifiants stockés |
| `GarageFlow/<version>` | `main.js` User-Agent | UA HTTP licence/MàJ | allowlist serveur potentielle |
| `EXPECTED_PRODUCT='GarageFlow'` + flux `product` | `electron/update-verify.js` | identité **interne** du flux de MàJ (invisible) | **pont de MàJ** : un client déjà installé rejetterait un flux `product` différent → on conserve pour ne pas casser la MàJ de la flotte actuelle |
| `LIC_SALT`, `DB_MAC_SALT`, `::v2::kdf::salt` | `main.js`, `secure-key.js` | sels KDF/MAC | changer rend indéchiffrables les données locales existantes |
| `GARAGEFLOW_API_KEY` | env + `.env.example` | clé control‑plane | casserait tous les déploiements |

**À valider sur Windows** (non exécutable ici) : voir bloqueur **B5b** (§6).

## 10. Documents rattachés

- **Runbooks vivants** (procédures, pointent vers ce document) :
  `PRODUCTION_DEPLOYMENT.md`, `SECRETS_ROTATION.md`, `ROTATION_SECRETS.md`,
  `POST_ROTATION_RECOVERY.md`, `CONFIGURATION.md`, `EINVOICING_*.md`,
  `MIGRATION-MONEY.md`, `DATABASE_ARCHITECTURE.md`, `README.md`, `CHANGELOG.md`.
- **Annexes historiques** (instantanés figés, ne font plus foi) : les rapports à
  la racine et dans `docs/` portant le marqueur `doc-status: historique`.
