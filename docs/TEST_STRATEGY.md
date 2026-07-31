# Stratégie de test — GarageFlow

_Document de data room M&A. Vérifié de première main le 2026-07-31 en exécutant l'outillage réel des deux dépôts. Les chiffres ci-dessous proviennent de `verified-facts.md` ; ne pas les extrapoler._

## 1. Vue d'ensemble

GarageFlow est livré sous trois formes (application desktop Electron, PWA partageant le même code, et control-plane/site cloud). Le socle de test est **solide côté logique métier et backend**, et **absent côté interface et bout-en-bout**. C'est le point le plus important à retenir : tout ce qui est logique (licences, isolation multi-tenant, TVA, mises à jour signées) est testé avec réalisme ; toute la couche de présentation (React/UI, packaging Electron, service worker PWA) n'est validée que manuellement.

| Indicateur | GarageFlowsV2 (desktop/PWA) | garagesite3 (cloud) |
|---|---|---|
| Suites de tests | 64 (sous-ensemble non-intégration) | 18 (sous-ensemble non-intégration) |
| Tests exécutés localement | **678 passés / 0 échec** | **140 passés / 0 échec** |
| `tsc --noEmit` | exit 0 (propre) | exit 0 (propre) |
| Fichiers de test au total (≈) | ~67 | ~20 |
| Total inter-dépôts (≈) | **~87 fichiers de test** | |

> Le sous-ensemble exécuté localement exclut les tests d'intégration PostgreSQL/Redis (`*.postgres.int.test.ts`, `*.integration.test.ts`), qui **tournent en CI** contre des services `postgres:16` + `redis:7` réels mais n'ont **pas** été reproduits localement lors de cette session. Les comptes ci-dessus sont donc un plancher vérifié, pas le total CI.

## 2. Ce qui est réellement testé (opérationnel)

Runner unique : **Vitest** (`environment: 'node'`). Faible taux de mocking (seulement 13/67 fichiers V2 utilisent `vi.mock`), donc la plupart des tests sont de vraies intégrations sur SQLite/handlers plutôt que des stubs superficiels.

### 2.1 Tests unitaires et de logique métier
- Arithmétique monétaire / TVA en centimes entiers : `src/lib/__tests__/tva.test.ts`, `money.test.ts`, `money-document-consistency.test.ts`.
- Vérification de licence ECDSA P-256 et HWID : `src/lib/__tests__/license-activate.test.ts` (345 lignes), `hwid-verify.test.ts`.
- Vérification des mises à jour signées : `src/lib/__tests__/update-verify.test.ts`.
- White-label (ajouté cette session) : `src/config/__tests__/brand.test.ts` — 8 tests verts sur la config Zod à 3 couches.

### 2.2 Tests d'intégration sur handlers de routes (SQLite réel)
`src/integration/*.test.ts` exécutent les **vrais handlers Next.js** contre une base SQLite temporaire copiée depuis le template committé :
- `catalog.test.ts`, `copilot.test.ts`, `dashboard.test.ts`, `ocr.test.ts`, `quotes-generate.test.ts`, `suppliers.test.ts`.

### 2.3 Isolation multi-tenant (charnière commerciale)
- `src/lib/__tests__/tenant-isolation.test.ts` — instancie **deux garages** sur SQLite temporaire et prouve l'étanchéité croisée.
- `src/lib/__tests__/tenant-guard.test.ts` — garde relationnelle anti-IDOR de 2ᵉ ordre.
- `src/lib/__tests__/require-session-enforcement.test.ts` — prouve **401 sans session**, **403 licence d'un autre garage**, **403 device révoqué** même avec cookie encore signé. La revendication « l'accès API sans licence valide est bloqué » est donc adossée à des tests, pas seulement au code.

### 2.4 Tests d'intégration PostgreSQL / Redis (exécutés en CI)
Ces suites s'auto-ignorent proprement en local via `describe.skipIf` quand `TEST_POSTGRES_URL` / `TEST_DATABASE_URL` / `TEST_REDIS_URL` sont absents, et tournent contre l'infra réelle en CI :
- Desktop : `license-devices.postgres.int.test.ts`, `licensed-session.postgres.int.test.ts`, `rate-limit-multi-instance.int.test.ts`.
- Cloud : `licenses/__tests__/device-seats.integration.test.ts`, `crashes/__tests__/crash-rollback-abuse.integration.test.ts`, `server/__tests__/rate-limit-distributed.integration.test.ts`.

### 2.5 Côté cloud — couverture licence / release / update
- `licenses/__tests__/device-auth.test.ts`, `heartbeat.test.ts` — auth device, heartbeat.
- `releases/__tests__/rollout.test.ts`, `manifest.test.ts` — rollout progressif, manifeste Ed25519 canonique.
- `server/__tests__/cron-auth.test.ts` (ajouté cette session, 5 tests) — auth fail-closed du cron d'auto-rollback via `CRON_SECRET`.

## 3. Intégration continue (CI)

Les **deux** dépôts embarquent `.github/workflows/ci.yml`. La CI ne se limite pas aux tests :

| Étape | GarageFlowsV2 | garagesite3 |
|---|---|---|
| Typecheck (`tsc --noEmit`) | Oui | Oui |
| Lint (ESLint / `next lint`) | Oui (bloquant) | Oui (étape CI séparée) |
| Migrations sur base vide | — | `migrate deploy` sur Postgres vide |
| Tests sur infra réelle | `postgres:16` + `redis:7` | `postgres:16` + `redis:7` |
| Build de production | Oui | Oui |
| Scan de secrets (Gitleaks) | Oui | Oui |
| Audit de dépendances | **Bloquant** (`scripts/audit-ci.js`, high/critical prod) | `npm audit --audit-level=high` **non bloquant** (`continue-on-error`) |

Points de config à connaître :
- **Aucun** `typescript.ignoreBuildErrors` dans les deux `next.config.mjs` → une erreur TS casse le build.
- **GarageFlowsV2** : pas de `eslint.ignoreDuringBuilds`.
- **garagesite3** : `eslint.ignoreDuringBuilds: true` dans `next.config.mjs` — atténué uniquement parce que le lint tourne en étape CI dédiée. À divulguer honnêtement.

## 4. Lacunes honnêtes (à budgéter par l'acquéreur)

| Lacune | Détail | Impact |
|---|---|---|
| **Aucun test E2E** | Pas de Playwright/Cypress/Puppeteer dans aucun `package.json`, aucun dossier `e2e/`. Trois surfaces de livraison (Electron, PWA, site) sans automatisation de bout en bout. | Régressions UI, routage, service-worker/offline, packaging Electron non détectables en CI. Construire l'E2E pour 3 surfaces = effort de plusieurs semaines avant tout refactor sûr. |
| **Aucun test de composant/UI** | 0 fichier `*.test.tsx`, pas de testing-library / jsdom / happy-dom. Toute la couche React est sans couverture automatisée. | La couche de présentation n'est validée que manuellement. |
| **Couverture mesurée mais non gated** | V2 : reporter v8 configuré (`vitest.config.ts`) mais **sans seuils** (`thresholds`). site3 : aucune config de couverture. | Aucun plancher objectif ; la couverture peut s'éroder silencieusement entre l'audit et le closing. |
| **Fichiers Electron du process principal non testés directement** | `electron/main.js`, `preload.js`, `control-plane.js`, `update-verify.js`, `integrity.js` sont des **copies dupliquées** de `src`. Les tests portent sur les copies `src/lib`, pas sur les fichiers réellement embarqués. | Un chemin sensible (vérif. de signature d'update, intégrité) peut diverger dans le binaire livré sans que la CI ne le voie. Recommandation : tester directement ou dédupliquer. |
| **Test PWA mince** | `pwa.test.ts` ≈ 72 lignes vs la surface offline/service-worker impliquée. | Comportement offline PWA largement non couvert. |

## 5. Priorités de remédiation recommandées

1. **E2E multi-surfaces** (Playwright desktop/PWA/site) — condition à la vélocité de refactor post-acquisition.
2. **Seuils de couverture** dans les deux dépôts (au moins un plancher gelé au niveau actuel).
3. **Tester ou dédupliquer** les fichiers `electron/*.js` embarqués (chemin sécurité-critique).
4. **Rendre bloquant** l'audit de dépendances de garagesite3 (aujourd'hui `continue-on-error`).
5. Étoffer la couverture PWA/service-worker.

## 6. Caveats de vérification

- Les comptes de tests d'intégration Postgres/Redis et leur exécution en CI n'ont **pas** été reproduits indépendamment dans cette revue ; ils s'auto-ignorent en local.
- Les auditeurs n'ont **pas** lancé l'installeur Windows packagé ni exercé l'UI live (pas d'automatisation E2E/UI) ; le comportement runtime desktop et PWA est inféré du code source, non observé.

---
_Voir aussi : [docs/ACQUISITION_READINESS_AUDIT.md](./ACQUISITION_READINESS_AUDIT.md)._
