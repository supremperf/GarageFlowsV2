<!-- doc-role: canonical-baseline -->
<!-- doc-status: actif -->

# GarageFlows V15.1 — CANONICAL TECHNICAL BASELINE

> **This document is the single canonical source of truth for the current
> GarageFlows technical verification state.** Tout autre document qui donne un
> état de production ou des résultats de tests doit pointer ici. Les comptes de
> tests, le commit et la toolchain proviennent de
> `artifacts/verification/baseline.json` (généré par
> `scripts/generate-verification-baseline.mjs` — jamais recopié à la main).
> La cohérence est vérifiée en CI par `scripts/check-docs-consistency.mjs`.

## Identification

| Champ | Valeur |
|---|---|
| Version | 1.1.0 |
| Commit de mesure | voir `artifacts/verification/baseline.json` (champ `commit`) — jamais recopié à la main |
| Branch | `claude/garageflow-final-unified-merge-ub0l67` |
| Date UTC | **2026-08-13** (regénérée à l'issue du programme MSAP) |
| Identité de build | **absente** — `gitIdentity: false`. La mesure a été faite depuis un répertoire de travail qui n'est pas un dépôt git : les comptes sont réels, le commit ne l'est pas. **À regénérer depuis le dépôt (`npm run verify:baseline`) avant tout tag.** |
| Méthode de validation | `npm test` (rapport JSON vitest) + `check:consistency`. `npm run release:gate` : 12 PASS · 3 ÉCHEC dus à l'absence de dépôt git · 3 NON EXÉCUTÉ (services absents) — les 3 échecs rejoués dans un checkout git passent. Détail : `docs/audit/2026-08-12-MSAP/RAPPORT-FINAL.md` §31 |

## Toolchain & tests (mesure machine)

Section **AUTO-GÉNÉRÉE** depuis `artifacts/verification/baseline.json`
(`npm run baseline:generate`) — ne pas éditer à la main. Le garde-fou
`check-docs-consistency` échoue si elle diverge de la baseline machine (comptes
de tests ou versions **résolues** de la toolchain). PostgreSQL 16.13 et Redis 7
(locaux réels) exécutent les suites conditionnelles décrites plus bas.

<!-- BEGIN AUTO-GENERATED BASELINE (source: artifacts/verification/baseline.json — `npm run baseline:generate`) -->

### Toolchain (versions RÉSOLUES / verrouillées)

> `Version résolue` = version réellement installée / verrouillée (package-lock).
> `Plage déclarée` = contrainte semver du package.json (jamais présentée comme la version installée).

| Composant | Version résolue | Plage déclarée |
|---|---|---|
| Node | v22.23.2 | — |
| npm | 10.9.8 | — |
| Next.js | 14.2.35 | ^14.2.35 |
| React | 18.3.1 | ^18.3.1 |
| React DOM | 18.3.1 | ^18.3.1 |
| TypeScript | 5.9.3 | ^5 |
| Prisma (CLI) | 5.22.0 | ^5.16.1 |
| @prisma/client | 5.22.0 | ^5.16.1 |
| Electron | 31.7.7 | ^31.7.7 |
| Vitest | 4.1.5 | ^4.1.5 |
| OS | win32 x64 | — |

### Tests (suite standard `npm test`, reproductible sans service externe)

| Champ | Valeur |
|---|---|
| Test files | 206 |
| Tests discovered | 2294 |
| Tests passed | 2259 |
| Tests failed | 0 |
| Tests skipped | 35 |

Commit : `n/a` · Branche : `n/a` · Généré (UTC) : `2026-08-13T13:28:07.612Z`

<!-- END AUTO-GENERATED BASELINE -->

## Static quality

- **TypeScript** : 0 erreur (`tsc --noEmit`)
- **Lint** : 0 (`next lint`)
- **Build** : OK — 16 pages ; CSP de production vérifiée au runtime (sans `unsafe-eval`)

## Suites conditionnelles (services réels, hors compte standard)

Les comptes standard (bloc AUTO ci-dessus) proviennent de la suite `npm test`,
reproductible **sans** service externe.

> **Mesure du 2026-08-07**, conservée comme preuve : l'environnement disposait
> alors de PostgreSQL et de Redis réels. **La regénération du 2026-08-13 n'en
> disposait pas** — ces suites y sont `BLOCKED_EXTERNAL` et le bloc AUTO
> ci-dessus ne les compte pas. Les résultats ci-dessous ne sont donc PAS une
> revendication d'état courant.

**En plus**, exécutées sur services
réels : PostgreSQL 16.13 → **21 tests verts** (numérotation 50 requêtes
parallèles, stock, licences/sièges, sessions) ; Redis 7 → **5 tests verts**
(rate-limit multi-instance). **2 tests restants** exigent un jeton de licence
réel (poste opérateur). E2E : parcours métier 13 étapes via vrais handlers +
Playwright responsive 3× vert contre le build de production.

## Financial integrity

- **Monetary Float fields : 0** (garde `check:money-fields`)
- **Tax rate representation** : `taxRate Float` (4 modèles × 2 schémas) = un
  TAUX, pas un montant — non monétaire, documenté
- **Financial guard** : `check:money-fields` + `check:money-calculations` +
  `check:money-json` (chaînées dans `check:consistency`)

## Security

- **Auth** : NextAuth, secret fail-closed (démarrage refusé sans — observé)
- **RBAC** : deny-by-default, matrice 128 cellules testée
- **Tenant isolation** : matrice 63 tests + audit statique 141 routes (0 faille)
- **Secrets** : 0 fuite fichiers suivis (gitleaks) ; historique = secrets déjà
  recensés compromis (rotation outillée)
- **Licensing** : signatures ECDSA, plafond d'appareils atomique prouvé (PG réel)
- **Rate limiting** : distribué fail-closed, prouvé multi-instance (Redis réel)
- **CSP** : production sans `unsafe-eval` (runtime vérifié) ; `'unsafe-inline'`
  scripts = exception verrouillée par test (nonce = ouvert)
- **Electron** : contextIsolation/sandbox/webSecurity actifs, fuses au packaging

## E-invoicing

- **Canonical model** : EN 16931 (sous-ensemble) — fait, testé
- **EN16931 mapping** : `docs/einvoicing/EN16931_MAPPING.md`
- **CII** : profil Factur-X MINIMUM, fail-closed
- **Factur-X** : XML MINIMUM généré ; PDF/A-3 non produit
- **XSD** : validé contre le XSD officiel Factur-X 1.09 MINIMUM (xmllint, 1 passage)
- **Accredited platform integration** : AUCUNE (architecture d'adaptateurs prête,
  registre volontairement vide) — conformité NON revendiquée

## Desktop

- **Build / Installer** : NON EXÉCUTÉ (conteneur Linux)
- **Authenticode** : NON EXÉCUTÉ (pas de certificat) — pipeline documenté
- **Update security** : fail-closed testé (signature/hash/anti-downgrade)

## PWA

Manifest & icônes : gardes `check:pwa` vertes. Service worker : sans
rechargement forcé. Installability : responsive prouvé (Playwright 3× vert).

## Operations

- **Health checks** : `/api/health` (public minimal / Electron), `/api/admin/monitoring`
- **Logging** : structuré + redaction (testée)
- **Backups** : restauration desktop prouvée par test ; serveur = procédure
- **Disaster recovery** : runbook (RPO/RTO = OBJECTIFS, exercice réel requis)
- **Load tests** : script fourni (staging-only), AUCUN chiffre exécuté

## Due diligence

SBOM (2 dépôts) · OSS license audit (0 BLOCKER) · Data inventory · Risk
register (48 findings) · Data room (10 volets).

## Compteurs de risques

- **Open code risks** : 8 (voir `docs/data-room/09-risks/OPEN_ITEMS.md`) — aucun critique
- **External actions** : 5 (secrets, purge historique, Authenticode, staging, restore)
- **External validations** : juridique + comptable + e-invoicing réglementaire

## Final classification

**`DUE_DILIGENCE_READY_WITH_CONDITIONS`** (voir définitions ci-dessous et
`docs/audit/PRODUCTION_STATUS_LEVELS.md`).

Justification : tout ce qui est prouvable dans l'environnement disponible est
prouvé et reproductible en une commande (`npm run release:gate`) ; **aucun
défaut connu ouvert, à aucun niveau de gravité** — 66 findings confirmés et
corrigés au terme du programme MSAP du 2026-08-12/13
(`docs/audit/2026-08-12-MSAP/`) ; conditions = validations externes (rotation
secrets prouvée, build Windows signé, déploiement staging/production réel,
raccordement e-invoicing). `PRODUCTION_VERIFIED` exigerait en plus l'exécution
réelle sur infrastructure de production (jamais simulée ici).

## Restrictions — NON vérifié dans cet environnement

Build/installation/upgrade Windows réels ; Authenticode ; SmartScreen ; rendu
WebKit/Safari réel ; déploiement Neon/Vercel/Upstash ; test de charge réel ;
exercice de restauration serveur chronométré ; rotation effective des secrets
(outil fourni, action opérateur) ; validations juridiques/comptables/
réglementaires — voir `docs/data-room/09-risks/EXTERNAL_VALIDATIONS.md`.
