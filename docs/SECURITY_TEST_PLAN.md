# Plan de tests de sécurité — GarageFlow

> Document de data room (due diligence M&A). Décrit les tests de sécurité **existants**
> (avec citations de fichiers) et les **lacunes** honnêtes. Chiffres de tests issus des
> exécutions vérifiées du 31/07/2026 (`verified-facts.md`) — jamais estimés.

## 1. Résultats de test vérifiés (autoritatifs)

| Dépôt | Résultat (sous-ensemble non-intégration) | Type-check |
|---|---|---|
| GarageFlowsV2 (desktop) | **678 tests OK / 0 échec** (64 suites) | `tsc --noEmit` exit 0 |
| garagesite3 (cloud) | **140 tests OK / 0 échec** (18 suites) | `tsc --noEmit` exit 0 |

Les suites complètes incluent en plus des tests d'intégration PostgreSQL/Redis
(`*.postgres.int.test.ts`, `*.integration.test.ts`) exécutés en CI mais **non reproduits
localement** ici. Les tests s'auto-ignorent proprement en local via `describe.skipIf`
quand `TEST_POSTGRES_URL` / `TEST_DATABASE_URL` / `TEST_REDIS_URL` sont absents
(`license-devices.postgres.int.test.ts:61`, `device-seats.integration.test.ts:32`).

## 2. Couverture de sécurité existante

### 2.1 Isolation multi-locataire (cross-tenant / IDOR)
- `src/lib/__tests__/tenant-isolation.test.ts` — ensemence **deux garages** sur une
  SQLite temporaire (copie du template `prisma/garageflow-template.db`) et vérifie
  qu'aucun garage n'accède aux données de l'autre.
- `src/lib/__tests__/tenant-guard.test.ts` — garde de relation (IDOR 2nd ordre).
- `src/integration/catalog.test.ts` — exécute le vrai handler `GET /api/catalog` sur
  SQLite temporaire avec vérification de scoping cross-garage.
- Garde applicative testée : `src/lib/tenant.ts:15-54` (`relationInGarage`/`assertRelations`).

### 2.2 Enforcement de session licenciée (401/403)
- `src/lib/__tests__/require-session-enforcement.test.ts:68-103` — assertions :
  **401** sans session, **403** pour la licence d'un autre garage, **403** pour un
  appareil révoqué même avec un cookie encore signé. Le claim « accès API direct sans
  licence valide bloqué » est adossé à des tests, pas seulement au code.

### 2.3 Licence / sièges (seats) / HWID
- `license-activate` (345 lignes), `hwid-verify`, `licensed-session` + intégration
  PostgreSQL côté desktop.
- Côté cloud : `device-auth`, `device-seats.integration`, `heartbeat`.
- Enforcement de sièges TOCTOU-safe testé : transaction `SELECT ... FOR UPDATE` avec
  recomptage de contrôle (`garagesite3/src/lib/licenses/service.ts:411-472`), adossé à un
  test d'intégration Postgres réel (skippé par défaut sans BDD).

### 2.4 Vérification des mises à jour (signature + hash)
- `src/lib/__tests__/update-verify.test.ts` (desktop) — vérification de manifeste.
- Cloud : tests de manifeste/rollout/semver des releases.

### 2.5 Rate limiting
- Comportement fail-closed des catégories critiques exercé via les tests de routes
  licence (`activate`/`check`) qui renvoient 503 en cas d'indisponibilité Redis en prod.
- `check` de licence testé **fail-closed** : ne renvoie jamais `allowed:true` sur échec BDD.

### 2.6 Secrets & environnement
- Rejet des secrets faibles/hérités et refus de boot en prod couverts par les tests des
  helpers (`auth-secret`, `session-secret`, `env`) — `src/lib/env.ts:19-104`.
- `cron-auth.test.ts` (5 tests, cloud) — authentification fail-closed du cron
  d'auto-rollback via `CRON_SECRET`, **ajouté cette session**.

### 2.7 Portail client (auth + 2FA)
- TOTP vérifié contre les **vecteurs de test RFC-6238**, comparaison en temps constant
  avec fenêtre de dérive (`src/lib/portal/totp.ts:88-100`).
- Codes de secours à usage unique testés ; verrouillage brute-force par compte sur le
  login.

### 2.8 Qualité arithmétique sensible (TVA / argent)
- `src/lib/__tests__/tva.test.ts` — arithmétique en centimes entiers, TTC = HT + TVA
  exact, gestion symétrique des montants négatifs (`src/lib/billing.ts`, `src/lib/money.ts`).

## 3. Chaîne CI (portes de sécurité)

Les deux dépôts (`/.github/workflows/ci.yml`) exécutent :
- `tsc --noEmit` (aucun `ignoreBuildErrors` posé), ESLint, `next build` ;
- migrations sur une PostgreSQL vide (une migration cassée fait échouer la CI) ;
- suite complète contre **postgres:16 + redis:7** réels (services avec health checks) ;
- **Gitleaks** (scan de secrets) ;
- audit de dépendances (**bloquant** côté desktop via `scripts/audit-ci.js` ;
  **non bloquant** côté garagesite3 — voir §4 et VULNERABILITY_MANAGEMENT).

## 4. Lacunes (déclarées honnêtement)

| Lacune | Détail | Impact |
|---|---|---|
| **Aucun test E2E** | Ni Playwright, ni Cypress, ni Puppeteer dans aucun des deux dépôts ; 3 surfaces de livraison (Electron, PWA, vitrine) sans automatisation UI | Régressions UI / routing / service-worker / packaging Electron non captées par la CI |
| **Aucun test composant/UI** | 0 fichier `*.test.tsx`, pas de testing-library/jsdom ; tous les tests en environnement `node` | Couche présentation validée manuellement uniquement |
| **Aucun DAST / pentest automatisé** | Pas d'analyse dynamique (ZAP/Burp) ni de fuzzing dans la CI | Vulnérabilités runtime web non recherchées automatiquement |
| **Aucun seuil de couverture** | v8 mesuré côté desktop mais sans seuil ; côté cloud pas de config de couverture | Régressions de couverture invisibles |
| **Fichiers Electron non testés directement** | `electron/*.js` sont des copies distinctes des `src/lib` testés — risque de divergence de logique sur des chemins sensibles (vérif signature, intégrité) | Une régression pourrait passer la CI tout en affectant le binaire livré |
| **Audit dépendances incohérent** | Bloquant côté desktop, `continue-on-error` côté garagesite3 | Le dépôt à plus forte valeur de confiance a la porte la plus faible |

## 5. Recommandations pré-closing

1. Ajouter une suite E2E minimale sur les 3 surfaces (au moins parcours licence/login/
   facturation) avant tout refactor significatif.
2. Rendre la porte `npm audit` de garagesite3 **bloquante** après remédiation (voir
   VULNERABILITY_MANAGEMENT).
3. Ajouter des seuils de couverture (lignes/branches) comme plancher objectif.
4. Introduire du DAST léger (ZAP baseline) sur les routes web du plan de contrôle.
5. Tester directement les fichiers `electron/*.js` livrés (ou fusionner avec les copies
   `src/lib` sous test).

---

*Référence croisée : voir [docs/ACQUISITION_READINESS_AUDIT.md](./ACQUISITION_READINESS_AUDIT.md).*
