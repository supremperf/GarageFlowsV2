<!-- doc-numbers: journal -->
# GARAGEFLOWS — VALIDATION FINALE DE RELEASE (V25)

> Portée HONNÊTE : ce qui a été RÉELLEMENT livré et PROUVÉ cette session, et ce qui
> reste OUVERT (interne) ou EXTERNE (hors environnement). Rien n'est simulé, aucun
> résultat inventé. « MITIGATED » n'est jamais présenté comme « FIXED ».
> Environnement : conteneur Linux headless — pas de Windows/wine, pas de
> PostgreSQL/Redis de prod, pas de certificat Authenticode, pas de credentials
> e-invoicing, pas de clé PRIVÉE de signature de licence (control-plane).

## Baseline réelle (mesurée, non supposée)

- HEAD de fin de session : **e42557d** · branche `claude/garageflow-final-unified-merge-ub0l67`.
- Toolchain : Node v22.22.2 · Next 14.2.35 · React 18.3.1 · Electron 31.7.7 · Prisma 5.22.0.
- Gates rejouées : **tsc 0** · **ESLint 0/0** · **vitest 1583 passed / 29 skipped / 0 failed (1612)** ·
  `check:consistency` PASS · audit prod PASS · audit desktop Electron PASS ·
  manifeste + verify-artifact (mode dépôt) PASS · **empaquetage + verify-artifact sur ZIP RÉEL extrait (mode artifact) PASS** ·
  `release:gate:fast` PASS (tous les contrôles obligatoires exécutables verts).
- Les 29 skips sont TOUS conditionnés à un prérequis (`TEST_POSTGRES_URL`,
  `TEST_REDIS_URL`, PEM, token, Python) — aucun skip « dette » masquant un test.

## Livré + PROUVÉ cette session (avec preuve reproductible)

| Lot | Livré | Preuve |
|---|---|---|
| **P0-7 — HWID V1 : bascule runtime (code)** | `verify.ts` accepte v0 (64 hex) **et** v1 (`HWID1-<64hex>`) — `isValidHwidFormat`/`verifyHwid`/`hwidVersionOf`, strict et à temps constant, v0↔v1 jamais confondus (64 vs 70). Émetteur `getHwidV1()` (Electron) + `getMachineId()`, **octet-pour-octet identique** à `hwid-v1.ts` et `hwid_v1.py`. Keygen **consomme** la valeur cliente (`--bind-hwid`, ne reconstruit plus). | Round-trip RÉEL sans matériel : `license-keygen-e2e.test.ts` (L7) — client→hwid v1→keygen officiel signe→`verifyLicenseToken`+`verifyHwid` OK, mauvaise machine rejetée. Parité TS==Python==Electron (`full-windows` → `HWID1-acdfae38…56744b`). `hwid-verify.test.ts` : accept/reject v1, pas de confusion v0↔v1. |
| **P0-8 — Clé mécanicien : mitigation réattribution PROUVÉE** | La réattribution révoque DÉFINITIVEMENT **tous** les appareils non révoqués (actifs **et** déconnectés — un `deactivated` retenait un siège), clôture l'historique, recalcule `recordMac`, audite `reassign`. | `assign-route.test.ts` (nouveau) — révocation totale + garde-fous (409/404/400). Route jusque-là non testée. |
| **P0-40 — Preuve de release sur ARTEFACT RÉEL** | `package-artifact.mjs` : `git archive HEAD` (fichiers suivis seulement) + manifeste commit-bound injecté + **SHA-256** (+ sidecar) ; `--verify` extrait dans un dossier **sans .git** et exécute le vrai `verify-artifact.mjs` en **mode artifact**. `unzip-into.mjs` : dézippeur sans dépendance (anti zip-slip). Intégré à `release:gate`. | Exécuté : ZIP 856 fichiers, SHA-256 émis, extrait sans `.git`, verify-artifact PASS en mode artifact ; `release:gate:fast` inclut l'étape et passe. |

## Tableau Avant → Après (domaines clés)

| Domaine | Avant (V24) | Après (V25) | Statut | Preuve |
|---|---|---|---|---|
| HWID canonique (AUD-036) | fondation seule (algorithme + vecteurs + parité) | chaîne de code COMPLÈTE : verify accepte v0+v1, émetteur Electron, keygen consomme, round-trip prouvé | **MITIGATED** (divergence éliminée ; reste bascule défaut LIVE + validation poste réel) | verify.ts, electron/main.js, hwid-v1.test.ts, license-keygen-e2e.test.ts |
| Réattribution mécanicien | révocation appareils livrée, non testée | révocation totale (actifs+déconnectés) **PROUVÉE par test** | **MITIGATED** (ré-émission crypto = control-plane, EXTERNAL_BLOCKERS #8bis) | assign-route.test.ts |
| Preuve d'artefact | verify-artifact mode dépôt uniquement | + empaquetage RÉEL (git archive+manifeste+SHA-256) + verify mode artifact sur ZIP extrait, dans la gate | **FIXED** (interne ; NSIS Windows reste externe) | package-artifact.mjs, unzip-into.mjs, final-release-gate.mjs |
| Suite de tests | 1563 / 1592 | **1583 / 1612** (+20, 0 échec) | **OK** | vitest |

## OUVERT (interne — honnêtement non fait cette session)

- **HWID (AUD-036) → FIXED** : bascule du **défaut LIVE** de l'app vers v1 pour les
  nouvelles activations + validation de la stabilité des champs sur poste Windows
  réel (propriété inhérente à tout HWID, non simulable en conteneur). La chaîne de
  code est livrée et prouvée ; il reste le déploiement réel.
- **E2E authentifié automatique** (tenant éphémère jetable) — non implémenté.
- **Versioning canonique / réorg `docs/audit/history/`** — non fait (la cohérence
  documentaire actuelle est VERTE ; réorganisation cosmétique reportée pour éviter
  un conflit avec une session parallèle active).
- **e-invoicing : durcissement de contrat + faux fournisseur (tests only)** — non fait.
- **Migrations majeures Next.js / Electron** — non faites (non validables sans E2E
  complet + poste réel ici).

## EXTERNE (hors environnement — cf. `EXTERNAL_BLOCKERS.md`, non maquillé)

- Installateur Windows NSIS (electron-builder) + matrice install/update + Authenticode → **Windows + certificat requis**.
- Ré-émission CRYPTOGRAPHIQUE d'une clé mécanicien (nouveau jeton signé) → **clé privée control-plane** (jamais dans l'app/le dépôt).
- PostgreSQL/Redis de prod, e-invoicing (credentials plateforme), rotation de secrets d'infra, vérif live PWA prod.

## Verdict

**DUE_DILIGENCE_READY_WITH_CONDITIONS.**

Progrès V25 réels et prouvés : la chaîne HWID V1 canonique est désormais complète
en code et vérifiée end-to-end (émetteur == référence == Python, keygen consomme,
verify accepte v0+v1, round-trip automatisé) ; la mitigation de réattribution
mécanicien est prouvée par test ; la preuve de release s'exerce sur un ARTEFACT
RÉEL (ZIP extrait, mode artifact, SHA-256), intégrée à la release gate. Restent,
avant `DUE_DILIGENCE_READY` plein, des items INTERNES honnêtement OUVERTS (bascule
LIVE HWID + validation poste réel, E2E authentifié, e-invoicing tests). Le
`PRODUCTION_READY` demeure conditionné aux validations EXTERNES (Windows +
Authenticode, PostgreSQL/Redis de prod, e-invoicing, clé privée control-plane pour
la ré-émission mécanicien) listées dans `EXTERNAL_BLOCKERS.md`. Aucun de ces items
n'est présenté comme résolu ; aucune sécurité n'a été affaiblie pour « passer au vert ».
