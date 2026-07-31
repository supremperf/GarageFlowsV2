# 16 — Limitations connues (liste maîtresse)

_Document de data room M&A. Vérifié de première main le 2026-07-31._

> Liste **franche et exhaustive** de chaque écart/limitation relevé par l'audit à sept domaines et la synthèse. Objectif : qu'aucun acquéreur ne découvre une surprise après closing. Classée par gravité. Chaque ligne cite la source dans le code.

## 1. Bloqueurs critiques (P0) — actifs externes, pas du code

| # | Limitation | Source |
|---|---|---|
| C1 | **Produit inexploitable/non monétisable sans transfert des 2 clés privées de signature** (licence ECC/ECDSA P-256 + update Ed25519). Clés **absentes du dépôt** (`keys/private.pem` gitignored, clé update = env serveur). | `electron/main.js:98-104`, `electron/update-verify.js:20-33`, `.gitignore` |
| C2 | **Dépendance au backend control-plane vivant** (api.garageflows.fr) — activation/heartbeat/révocation/release/crash y transitent. Le desktop est la moitié du produit. | `electron/update-verify.js:29-33`, `electron/main.js:145,982,1016` |
| C3 | **Domaines garageflows.fr codés en dur** dans les allowlists update/download et endpoints licence — propriété DNS/hébergement à transférer. | `electron/update-verify.js:29-33` |
| C4 | **Aucune cession de PI in-repo** — pas de chain-of-title inspectable ; ownership contractuel uniquement. | `package.json` (`private:true`, pas de LICENSE d'origine) |

## 2. Écarts élevés (gaps produit majeurs)

| # | Limitation | Source |
|---|---|---|
| H1 | **Zéro e-invoicing** (Factur-X/UBL/CII/ZUGFeRD/Chorus Pro/PDP/e-reporting) — enjeu légal marché français 2026-2027. | `prisma/schema.prisma:337-384` |
| H2 | **Une seule taxe TVA au niveau en-tête** ; `InvoiceLine` sans `vatRate`/`vatCategory` → pas de ventilation par taux (EN16931 impossible). | `prisma/schema.prisma:362, 374-384` |
| H3 | **Pas de snapshot de montants figés** sur facture émise (totaux recalculés à chaque lecture). | `src/lib/billing.ts:38` |
| H4 | **Pas de modèle Avoir ni Paiement** — pourtant l'UI dit « créez un avoir ». Corrections/rapprochement impossibles en produit. | `src/app/api/invoices/[id]/route.ts:37` |
| H5 | **API publique `/api/v1` = démo en mémoire non persistante** (reset au cold start, non partagée entre lambdas). | `garagesite3/src/lib/api/store.ts:1-8, 242-256` |
| H6 | **Aucun système de webhooks** malgré le cadrage intégration. | `blob-upload/route.ts:70-72` |
| H7 | **Installeur Windows non signé** (SmartScreen « éditeur inconnu ») ; **un seul target** (Windows nsis x64). | `package.json:132-157` |
| H8 | **Verrou dur 72 h hors-ligne** → `app.quit()` ; contredit le pitch offline. | `electron/main.js:298-299,1193-1206` |
| H9 | **Zéro test E2E et zéro test de composant UI** sur 3 surfaces ; couverture mesurée jamais gatée. | `package.json` (pas de Playwright), `vitest.config.ts` |
| H10 | **White-label quasi non câblé** : ~2 consommateurs `BRAND.*`, ~146 littéraux « GarageFlow » codés en dur, 8 hex en dur. | `src/app/layout.tsx:7`, `GarageFlowLogo.tsx:45` |
| H11 | **Aucun import de données** (CSV/Excel/mapping/dry-run) — CSV export-only. | `src/lib/reports/csv.ts:1` |
| H12 | **Aucune hiérarchie organisation/multi-garage** au-dessus de `Garage`. | `prisma/schema.prisma:24` |

## 3. Écarts moyens (durcissement / dette)

| # | Limitation | Source |
|---|---|---|
| M1 | **Clé admin unique partagée** (control-plane) en `sessionStorage`, pas d'IAM/MFA/RBAC/rotation ; compromission = contrôle total du licensing. | `garagesite3/src/lib/licenses/auth.ts:28-41`, `admin/_lib/client.ts:9-52` |
| M2 | **Backup/restore & monitoring : code complet, aucune UI/nav** — inutilisables par un non-technicien. | `src/app/api/admin/backups/route.ts:1`, settings sans BackupTab |
| M3 | **Auto-rollback** : code prêt mais planification cron ajoutée seulement cette session (`vercel.json`) — auparavant non déclenché seul. | `garagesite3/src/lib/releases/service.ts:206-228` |
| M4 | **Bypass rate-limit 2FA portail** via `X-Forwarded-For` non filtré + pas de lockout 2FA par compte → brute-force TOTP possible. | `src/lib/portal/auth-helpers.ts:31-35` |
| M5 | **Secrets TOTP portail stockés en clair** en base. | `src/app/api/portal/auth/2fa/setup/route.ts:18` |
| M6 | **Anti-tamper local JS-only** + secret embarqué extractible ; licence **fail-open** hors-ligne ; binaire non signé → DRM best-effort. | `electron/integrity.js:22-26`, `electron/main.js:1042,1054` |
| M7 | **Schéma desktop non reproductible depuis migrations** (2 patches, pas de baseline/`migration_lock.toml`) — repose sur `db push` + template DB. | `prisma/migrations/` |
| M8 | **Observabilité** sans IDs de corrélation/trace ni export métriques. | `src/lib/logger.ts:51` |
| M9 | **Pas de tests de charge / benchmark** — aucune scalabilité prouvée. | Absence dans les 2 dépôts |
| M10 | **`electron/*.js` livrés = copies non testées** de `src` — divergence possible sans que la CI le voie. | `electron/update-verify.js` |

## 4. Écarts faibles / notes de maintenance

| # | Limitation | Source |
|---|---|---|
| L1 | CORS API v1 retombe sur `'*'` si non configuré. | `garagesite3/src/lib/api/http.ts:9` |
| L2 | Dates `issueDate`/`dueDate` stockées en `String`, pas `DateTime`. | `prisma/schema.prisma:359` |
| L3 | Electron 31 en retard sur les correctifs Chromium/Node ; Next 14/15 split ; next-auth v4 (piste dépréciée). | `GarageFlowsV2/package.json:79,57` |
| L4 | Pas de champ `engines` (version Node non contrainte). | `package.json` (les 2 dépôts) |
| L5 | Audit de dépendances de garagesite3 **non bloquant** (continue-on-error), contrairement au desktop. | `garagesite3/.github/workflows/ci.yml` |
| L6 | Limiters publics (crash, SSE) en mémoire par instance (serverless). | `garagesite3/src/app/api/crash/route.ts:18-21` |
| L7 | garagesite3 : `eslint.ignoreDuringBuilds:true` (lint reste en étape CI séparée). | `garagesite3/next.config.mjs` |
| L8 | Backup codes portail : SHA-256 non salé (acceptable car haute entropie). | `src/lib/portal/backup-codes.ts` |
| L9 | `plate-lookup` dépend d'une API tierce gratuite sans SLA (`api-immat.com`). | `plate-lookup/route.ts:30-33` |
| L10 | `keys/public.pem` absent → build **avertit seulement**, peut livrer un artefact dégradé. | `scripts/post-build.js:170-181` |

## 5. Caveats de vérification (limites de la due diligence elle-même)

- Existence/validité/propriété exclusive des **clés privées et du backend** : **non vérifiables** (hors dépôt).
- Propriété des **domaines** garageflows.fr : **non vérifiable** depuis le code.
- **Aucun** run de l'installeur Windows packagé ni de l'UI live (pas d'E2E) — comportement runtime **inféré des sources**.
- Les tests d'intégration Postgres/Redis **s'auto-skippent** localement ; les comptes de passage CI n'ont pas été reproduits indépendamment.
- Fondamentaux business (revenus, clients, trafic, churn) : **hors périmètre code**, à diligencer séparément.

---
_Voir aussi : [docs/ACQUISITION_READINESS_AUDIT.md](../ACQUISITION_READINESS_AUDIT.md)._
