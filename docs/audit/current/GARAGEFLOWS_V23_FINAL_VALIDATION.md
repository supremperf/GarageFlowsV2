<!-- doc-numbers: journal -->
# GARAGEFLOWS — V23 VALIDATION (session de remédiation ciblée)

> **Honnêteté de portée.** Ce document consigne ce qui a été RÉELLEMENT livré et
> vérifié pendant cette session vers l'objectif V23, et ce qui reste OUVERT ou
> EXTERNE. Il ne prétend PAS que tous les lots V23 sont terminés. Les preuves sont
> reproductibles ; rien n'est simulé (§ Règle N°1). Environnement : conteneur
> Linux headless (pas de Windows/wine, pas de PostgreSQL/Redis de prod, pas de
> certificat Authenticode, pas d'identifiants de plateformes e-invoicing).

## Baseline

- Commit de départ réel : `git rev-parse HEAD` = **e0e7f2a** (vérifié, non supposé).
- Commit à la fin de cette session : voir `release-manifest.json` (généré) / dernier `git log`.
- Branche : `claude/garageflow-final-unified-merge-ub0l67`.
- Toolchain : Node v22.22.2 · npm 10.9.7 · Next 14.2.35 · React 18.3.1 · Electron 31.7.7 · Prisma 5.22.0.
- Gates au départ (rejouées) : tsc 0 · lint 0/0 · vitest 0 failed · build 16/16 · release:gate:fast PASS.

## Livré cette session (avec preuve)

| Lot | Domaine | Livré | Preuve |
|---|---|---|---|
| 5 | SAST / CodeQL (AUD-048) | `.github/workflows/codeql.yml` (JS/TS, security-extended, PR+push+weekly) | fichier workflow ; s'exécute côté GitHub Actions |
| 4 | Audit runtime Electron empaqueté | `scripts/check-desktop-runtime-audit.mjs` — porte **bloquante** auditant Electron (que `--omit=dev` ignorait), dérogation datée ; wired dans `ci.yml` | gate PASS ; **bloque** sur dérogation expirée/absente (testé exit=1) |
| 11 | Secrets compromis | `docs/security/SECRET_ROTATION_REQUIRED.md` (inventaire, procédure, ordre, tests — aucune valeur réelle) | fichier ; statut EXTERNAL_ACTION_REQUIRED |
| 1 | Preuves de release | `scripts/generate-release-manifest.mjs` → `release-manifest.json` (commit-bound, source unique = baseline.json), `--check` anti-staleness | manifest généré ; `--check` PASS |

## Report V22 déjà en base (rappel, corrigé/vérifié précédemment)

Écran blanc desktop RÉSOLU (APP_ORIGIN=localhost) · `restore.js` réparé + validé ·
révocation admin effective en base (P1) · TOCTOU devis/OR (P2×2) · TVA centrale
exacte · révocation complète des appareils à la réattribution mécanicien.

## Tableau final (Avant → Après)

| Domaine | Avant | Après | Preuve | Statut |
|---|---|---|---|---|
| Release evidence | docs multiples, comptes possiblement divergents | manifest commit-bound + source unique + `--check` | generate-release-manifest.mjs | **MITIGATED** (déplacement history/ non fait) |
| Mechanic credential rotation | seuls devices 'active' révoqués | tous devices révoqués (active+deactivated) + seats=1 | e0e7f2a + assign/route.ts | **MITIGATED** (re-émission de clé = admin-side, EXTERNAL #8bis) |
| HWID | Python/Electron reconstruisent séparément | inchangé | — | **OPEN** (AUD-036 ; refonte spec+impl partagée non faite) |
| Web dependencies | audit-ci `--omit=dev` | inchangé (déjà OK) | audit-ci.js | **OK** (3 dérogées datées) |
| Electron dependencies | non audité (devDep) | porte bloquante dédiée | check-desktop-runtime-audit.mjs | **FIXED** |
| SAST | AUD-048 aucun | CodeQL actif | codeql.yml | **FIXED** |
| Authenticated E2E | skip si pas de creds | inchangé | — | **OPEN** (tenant éphémère non implémenté) |
| Next.js | 14.2.x | inchangé | — | **OPEN** (migration majeure non validable ici sans E2E complet) |
| Electron | 31.7.7 | inchangé (audité + dérogé) | EXTERNAL_BLOCKERS #3 | **EXTERNAL** (montée = validation Windows) |
| AUD-056 installer | hypothèse | inchangé | — | **OPEN/EXTERNAL** (matrice Windows non écrite cette session) |
| Authenticode | absent | inchangé | — | **EXTERNAL** (certificat requis) |
| Secrets rotation | fuite colmatée au packaging | inventaire + procédure | SECRET_ROTATION_REQUIRED.md | **EXTERNAL_ACTION_REQUIRED** |
| PostgreSQL | gardes statiques | inchangé | check-postgres-migration-verification | **EXTERNAL** (pas d'instance) |
| Redis | code présent | inchangé | — | **EXTERNAL** (pas d'instance) |
| E-invoicing | 0 adapter | inchangé | — | **EXTERNAL** (pas de credentials) |
| Control plane | clé statique + revalidation DB admin | inchangé | api-helpers isAdminSession | **MITIGATED** (MFA/RBAC = évolution) |

## Verdict

**DUE_DILIGENCE_READY_WITH_CONDITIONS.**

Amélioré cette session : SAST actif (CodeQL), audit du runtime Electron empaqueté
fiable et bloquant, inventaire de rotation des secrets, manifeste de release
commit-bound. Restent, pour atteindre `DUE_DILIGENCE_READY` selon les critères du
prompt : HWID canonique (AUD-036), E2E authentifié automatique, et re-émission de
credential mécanicien à la réattribution — tous INTERNES et non encore faits
(honnêtement OPEN, non masqués). `PRODUCTION_READY` reste conditionné aux
validations externes (Windows réel + Authenticode, PostgreSQL/Redis de prod,
intégrations e-invoicing) listées dans `EXTERNAL_BLOCKERS.md`.
