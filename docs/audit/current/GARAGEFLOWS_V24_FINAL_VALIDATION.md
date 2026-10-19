<!-- doc-numbers: journal -->
# GARAGEFLOWS — V24 VALIDATION (remédiation ciblée)

> Portée honnête : ce qui a été RÉELLEMENT livré/vérifié cette session, et ce qui
> reste OUVERT (interne, à poursuivre) ou EXTERNE (hors environnement). Rien n'est
> simulé. Environnement : conteneur Linux headless (pas de Windows/wine,
> PostgreSQL/Redis de prod, certificat Authenticode, ni credentials e-invoicing).

## Baseline (réelle, vérifiée — non supposée)

- `git rev-parse HEAD` au départ : **d6f3289** ; branche `claude/garageflow-final-unified-merge-ub0l67` ; arbre propre.
- Toolchain : Node v22.22.2 · npm 10.9.7 · Next 14.2.35 · React 18.3.1 · Electron 31.7.7 · Prisma 5.22.0.
- Gates rejouées : tsc 0 · lint 0/0 · **vitest 1563 passed / 29 skipped / 0 failed (1592)** · release:gate:fast PASS.

## Livré cette session (avec preuve)

| Lot | Livré | Preuve |
|---|---|---|
| B — Preuves de release | `scripts/verify-artifact.mjs` (+`release:verify-artifact`) : vérif d'artefact **dual-mode** (repository : commit==HEAD ; artifact : identité via manifeste, **sans .git**). `post-build.js` **inclut** `release-manifest.json` dans le standalone → présent dans le ZIP. | repo PASS · ZIP propre PASS · ZIP+.env FAIL(1) · ZIP+.env.example PASS |
| E — Desktop audit dans la gate | `release:gate` exécute désormais l'audit runtime Electron empaqueté **et** génère+vérifie le manifeste (plus seulement en CI). | release:gate:fast : « Audit runtime desktop empaqueté (Electron) » OK |
| F — SAST | `codeql.yml` validé : JS/TS, `security-extended`, PR+push+weekly, permissions minimales (`security-events: write`). | fichier workflow |
| H — Skips | Les 29 skips sont **tous** conditionnels à un prérequis (`TEST_POSTGRES_URL`, `TEST_REDIS_URL`, PEM, token) — ils s'exécutent en CI quand le service est fourni. Aucun skip « dette » masquant un test. | analyse `describe.skipIf`/`runIf` |

## Tableau (Avant → Après)

| Domaine | Avant | Après | Preuve | Statut |
|---|---|---|---|---|
| Release evidence | manifest généré, non embarqué | manifest commit-bound **inclus au ZIP** + gate | post-build.js, final-release-gate.mjs | **FIXED** (interne) |
| Artifact verification | inexistante | `release:verify-artifact` dual-mode (sans .git) | verify-artifact.mjs | **FIXED** (interne) |
| Mechanic credentials | devices 'active' révoqués | tous devices révoqués + seats=1 | assign/route.ts (e0e7f2a) | **MITIGATED** (re-émission = admin-side, EXTERNAL_BLOCKERS #8bis) |
| HWID | Python/Electron sources séparées | inchangé | — | **OPEN** (AUD-036 — spec+impl partagée à faire) |
| SAST | CodeQL ajouté | validé (couverture/permissions/planif) | codeql.yml | **FIXED** |
| Web dependency audit | audit-ci `--omit=dev` | inchangé (3 dérogées datées) | audit-ci.js | **OK** |
| Desktop audit | CI seulement | **dans release:gate** + CI, bloquant | final-release-gate.mjs | **FIXED** |
| Authenticated E2E | skip sans creds | inchangé | — | **OPEN** (tenant éphémère à implémenter) |
| Test skips | 29 | 29 (tous prérequis-gated, documentés) | ce doc | **OK** (aucun masquage) |
| Next.js | 14.2.35 | inchangé | — | **OPEN** (migration majeure non validable sans E2E complet ici) |
| Electron | 31.7.7 | audité + dérogé daté | check-desktop-runtime-audit | **EXTERNAL** (montée = validation Windows) |
| AUD-056 | hypothèse | inchangé | — | **EXTERNAL** (Windows requis) |
| Authenticode | absent | inchangé | EXTERNAL_BLOCKERS #2 | **EXTERNAL** (certificat) |
| Secrets | fuite colmatée + inventaire | vérif d'artefact refuse tout .env réel | verify-artifact.mjs, SECRET_ROTATION_REQUIRED.md | **MITIGATED** (rotation = EXTERNAL) |
| E-invoicing | 0 adapter | inchangé | — | **EXTERNAL** (credentials) |
| Control plane | revalidation DB admin | inchangé | api-helpers isAdminSession | **MITIGATED** (MFA/RBAC = évolution) |
| Documentation | multi-baseline | manifeste source unique + docs current/ | check-docs-consistency | **MITIGATED** (history/ non réorganisé) |

## Validation finale (HEAD de fin de session)

tsc 0 · lint 0/0 · **vitest 1563/1592 (29 skipped, 0 failed)** · check:consistency PASS ·
audit prod PASS · audit desktop Electron PASS · manifest+verify-artifact PASS ·
release:gate:fast PASS. Artefact simulé (extraction sans .git) : `release:verify-artifact` PASS ;
refuse un `.env` réel injecté ; accepte `.env.example`.

## Verdict

**DUE_DILIGENCE_READY_WITH_CONDITIONS.**

Progrès V24 : preuves de release réparées (manifeste commit-bound embarqué +
vérification d'artefact sans .git), audit Electron desktop désormais dans la
release gate, SAST validé, skips clarifiés (aucun masquage). Restent INTERNES et
OUVERTS avant `DUE_DILIGENCE_READY` : HWID canonique (AUD-036), E2E authentifié
automatique, et re-émission de credential mécanicien à la réattribution — non
faits cette session (honnêtement OPEN, non maquillés). `PRODUCTION_READY` demeure
conditionné aux validations externes (Windows + Authenticode, PostgreSQL/Redis de
prod, e-invoicing) listées dans `EXTERNAL_BLOCKERS.md`.
