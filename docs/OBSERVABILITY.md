# Observabilité & résilience — runbook opérationnel (GarageFlows)

Ce document décrit **ce qui est réellement instrumenté dans le code** (signaux,
seuils, points d'exposition) et les **procédures de réponse** aux incidents. Il
ne décrit pas une pile d'observabilité idéale : il documente l'existant vérifiable
et signale honnêtement les lacunes (section 7).

## 1. Signaux collectés

### 1.1 Journaux (logs) — `src/lib/logger.ts`

- Logger centralisé `logger.{debug,info,warn,error}`.
- **Redaction systématique** : chaque argument passe par `redactValue` /
  `redactString` (`src/lib/redact.ts`) avant écriture — aucun secret, jeton,
  mot de passe ou en-tête sensible n'atteint la sortie. Les `Error` sont
  sérialisées message + stack **après** redaction.
- **Format production** : `[ISO-8601] [LEVEL] message`. `warn`/`error` →
  `stderr` ; `debug`/`info` → `stdout` (séparation adaptée à un collecteur qui
  route par flux).
- **Développement** : délégué à `console` pour la lisibilité, redaction quand
  même appliquée.

### 1.2 Métriques — `src/lib/monitoring/metrics.ts`

Mesures **réelles** (jamais simulées ; une métrique indisponible vaut `null`) :

| Composant | Source | Grading |
|---|---|---|
| CPU (charge 1 min / cœurs) | `os.loadavg()`, `os.cpus()` | `statusForValue` |
| Mémoire (% utilisée) | `os.totalmem/freemem` | `statusForValue` |
| Disque (% utilisé) | `fs.statfsSync` (null si non exposé) | `statusForValue` |
| Latence BDD | `SELECT 1` chronométré (Prisma) | `statusForValue` |
| Process Node | `process.memoryUsage/uptime` | informatif |

La **logique de notation est pure** (`statusForValue`, `overallStatus`,
`gradeMetrics`) et couverte par `src/lib/monitoring/__tests__/metrics.test.ts`
(**9 tests verts**, exécutés le 2026-08-07). « Pire état gagne » pour l'état
global.

### 1.3 Points d'exposition

- **`GET /api/health`** (`src/app/api/health/route.ts`) :
  - *Public (serveur/PWA)* : réponse **minimale** `{"status":"ok"}` (200) ou
    `{"status":"degraded"}` (503) — **aucun détail interne** (pas de message
    Prisma, pas d'état des variables, pas de stack). Les diagnostics vont dans
    les logs redactés. `Cache-Control: no-store`.
  - *Electron (`ELECTRON=1`, 127.0.0.1 uniquement)* : diagnostic de configuration
    (variables présentes/absentes + instructions) pour l'écran de premier
    démarrage. Jamais exposé publiquement (le serveur Electron n'écoute que la
    boucle locale).
- **`GET /api/admin/monitoring`** (`src/app/api/admin/monitoring/route.ts`) :
  métriques graduées complètes. **Réservé propriétaire / responsable**
  (`APP_CONFIG.managerRoles`, 403 sinon). C'est la sonde de supervision détaillée.

## 2. Seuils d'alerte (source unique : `DEFAULT_THRESHOLDS`)

| Métrique | `warning` | `critical` |
|---|---|---|
| CPU (% des cœurs) | ≥ 75 | ≥ 90 |
| Mémoire (% utilisée) | ≥ 80 | ≥ 92 |
| Disque (% utilisé) | ≥ 80 | ≥ 92 |
| Latence BDD (ms) | ≥ 200 | ≥ 1000 |
| BDD injoignable | — | `critical` immédiat |

Ces seuils sont **dans le code** (`metrics.ts`), pas seulement dans ce document :
un changement de politique se fait à un seul endroit, testé.

## 3. SLI / SLO proposés (à valider par l'exploitant)

| SLI | Mesure | SLO cible |
|---|---|---|
| Disponibilité (health 200) | ratio 200 vs total sur `/api/health` | ≥ 99,5 % / mois |
| Latence BDD | p95 de `database.latencyMs` (`/api/admin/monitoring`) | < 200 ms |
| Taux d'erreur 5xx applicatif | logs `error` / requêtes | < 0,5 % |
| RTO (reprise après sinistre) | temps restauration sauvegarde | < 1 h (voir §5.2) |
| RPO (perte de données max.) | intervalle entre sauvegardes | ≤ dernier backup vérifié |

Ces cibles sont des **propositions** : elles n'ont pas encore d'historique de
production. Elles servent de base contractuelle à instancier au déploiement.

## 4. Où regarder en premier (triage)

1. `GET /api/health` → 200 = vivant ; 503 = dégradé (BDD probablement injoignable).
2. `GET /api/admin/monitoring` (compte responsable) → `overall` + `statuses`
   par composant pour localiser (CPU / mémoire / disque / base).
3. Logs `stderr` (niveaux `warn`/`error`, déjà redactés) pour la cause.

## 5. Scénarios de panne & procédures

### 5.1 Base de données injoignable
- **Symptôme** : `/api/health` → 503 `degraded` ; `/api/admin/monitoring`
  `database` = `critical` ; log `[health] base de données injoignable`.
- **Action** : vérifier la connectivité (`DATABASE_URL`/`DIRECT_URL`), l'état du
  serveur PostgreSQL, le pool de connexions. En desktop (SQLite), vérifier
  l'intégrité du fichier et l'espace disque.

### 5.2 Restauration de sauvegarde (reprise)
- **Preuve existante** : le cycle **backup chiffré → corruption → restauration
  exacte** est prouvé de bout en bout par
  `src/lib/backup/__tests__/restore-roundtrip.test.ts` (round-trip réel, scopé
  garage, avec vérification d'intégrité — finding **AUD-017**).
- **Endpoints** : `POST /api/admin/backups/[id]/restore`, `.../verify`,
  `.../download` (réservés admin).
- **Runbook** : (1) `verify` la sauvegarde cible avant tout ; (2) restaurer sur
  une base **de reprise** d'abord si possible ; (3) contrôler l'intégrité ; (4)
  bascule. Ne jamais restaurer par-dessus la base vivante sans sauvegarde
  préalable de l'état courant.

### 5.3 Échec de migration
- **Garde** : le runner de migration est **fail-closed** (`src/lib/migrations.ts`,
  registre `_gf_migrations` + checksums). En Electron, une **sauvegarde vérifiée
  pré-migration** est prise avant toute migration (portail de migration bloquant).
- **Action** : consulter le log de migration ; si la migration a échoué, la base
  reste dans l'état antérieur validé ; restaurer la sauvegarde pré-migration si
  nécessaire (§5.2).

### 5.4 Backend de rate-limit indisponible (Upstash/Redis)
- **Comportement** : `enforceDistributedLimit` est **fail-closed** — si le
  backend distribué est injoignable, la requête est refusée plutôt que laissée
  passer (pas de fail-open). `/api/health` conserve, lui, un limiteur mémoire
  local pour rester observable (exception documentée).
- **Action** : rétablir le backend ; surveiller la hausse de 429/503 côté
  routes publiques pendant l'indisponibilité.

### 5.5 Suspicion de compromission de secret
- **Outil** : `npm run verify:rotation` (`scripts/verify-rotation.mjs`) compare
  les empreintes SHA-256 des secrets courants au manifeste des secrets
  compromis **sans jamais imprimer de valeur** ; 3 codes de sortie
  (OK / rotation à confirmer / secret compromis encore actif).
- **Action** : faire tourner le secret côté exploitant, puis rejouer
  `verify:rotation` pour obtenir la **preuve** de rotation effective.

## 6. Continuité entre les couches

Les décisions réellement critiques (validité de licence, autorisation) ne
dépendent **pas** de l'intégrité du poste client : elles sont vérifiées côté
serveur (licences §5 de `SECURITY-HARDENING.md`) et les documents financiers
sont scellés (`SIGNATURE.md`). L'observabilité ci-dessus couvre l'infrastructure
d'exécution ; l'intégrité métier est traitée par ces mécanismes dédiés.

## 7. Lacunes assumées (non encore en place)

Pour rester honnête sur l'état réel :

- **Pas d'APM / traçage distribué** ni de collecteur d'erreurs externe (type
  Sentry) câblé — les erreurs vont dans les logs redactés, pas dans un service
  d'agrégation.
- **Pas de pipeline d'alerte automatique** : les seuils sont définis et
  mesurés, mais leur **livraison** (page/mail/Slack) relève de l'infrastructure
  d'exploitation, à brancher au déploiement.
- **Pas d'expédition centralisée des logs** (shipper) : les flux
  `stdout`/`stderr` sont prêts à être collectés par la plateforme d'hébergement,
  mais aucune destination n'est imposée par le dépôt.
- **SLO sans historique** : les cibles de la §3 sont des propositions, pas des
  mesures de production.

Ces éléments sont des tâches d'**exploitation** (opérateur/hébergeur), pas des
défauts de code ; ils sont listés ici pour éviter toute lecture trop favorable.
