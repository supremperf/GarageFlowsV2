# Observabilité — GarageFlow

Ce document décrit les capacités d'observabilité **réellement présentes dans le
code** des deux dépôts (`GarageFlowsV2` = application Electron/desktop,
`garagesite3` = plan de contrôle cloud), en distinguant clairement ce qui est
opérationnel, partiel ou non construit. Les numéros de lignes et chemins cités
sont vérifiables dans les sources.

> Chaque capacité est étiquetée : **Opérationnel** (câblé et fonctionnel),
> **Partiel**, **Code seul / pas d'UI**, ou **Non construit (feuille de route)**.

---

## 1. Journalisation structurée avec rédaction (logger)

**Statut : Opérationnel**

Le desktop dispose d'un logger centralisé `src/lib/logger.ts` :

- Niveaux `debug | info | warn | error`.
- En production, chaque ligne est préfixée d'un horodatage ISO 8601 et du niveau
  (`[2026-07-31T...Z] [ERROR] …`) ; `warn`/`error` vont sur `stderr`, le reste
  sur `stdout`. En développement, délégation à `console` pour la lisibilité
  (`logger.ts:24-48`).
- **Rédaction centralisée systématique** : tout argument passe par
  `redactValue` / `redactString` (`src/lib/redact.ts`) avant écriture
  (`logger.ts:19-22`). Sont masqués : mots de passe, secrets, tokens, cookies,
  clés API, en-têtes `Authorization`, chaînes de connexion base de données
  (identifiants), tokens de licence `GF2.*`, JWT, HWID, et le nom d'utilisateur
  dans les chemins locaux Windows/*nix.
- Les objets `Error` sont sérialisés (message + stack) puis rédigés
  (`logger.ts:28`).

Le module `redact.ts` est le **miroir serveur** de la fonction
`redactSensitive` du contexte Electron (`electron/control-plane.js:104-131`),
qui applique la même politique aux rapports de crash avant transmission.

**Limite connue (honnête) :** la journalisation n'est pas corrélée. Aucun
identifiant de requête / trace (`correlationId` / `requestId` / `traceId`) n'est
propagé à travers une requête, et il n'existe pas d'export de métriques
(Prometheus / OpenTelemetry). Le triage d'incident inter-requêtes en production
est donc limité — voir la feuille de route ci-dessous.

---

## 2. Supervision d'infrastructure (monitoring)

**Statut : Opérationnel (collecte + UI), avec réserve de navigation**

Le desktop mesure des métriques hôte/process/base de données **réelles, jamais
simulées** — `src/lib/monitoring/metrics.ts` :

| Métrique | Source | Seuils par défaut (warn / crit) |
|----------|--------|---------------------------------|
| Charge CPU (% des cœurs) | `os.loadavg()` / `os.cpus()` | 75 % / 90 % |
| Mémoire utilisée | `os.totalmem()` / `os.freemem()` | 80 % / 92 % |
| Disque utilisé | `fs.statfsSync` (null si indisponible) | 80 % / 92 % |
| Latence base de données | `SELECT 1` chronométré via Prisma | 200 ms / 1000 ms |

- La logique de notation (`statusForValue`, `overallStatus`, `gradeMetrics`) est
  **pure et testée unitairement** ; le pire statut composant l'emporte
  (`metrics.ts:35-47, 132-145`).
- Une métrique indisponible (ex. disque sur certaines plateformes) est reportée
  à `null`, pas inventée (`metrics.ts:89-101`).
- Exposée via `GET /api/admin/monitoring`
  (`src/app/api/admin/monitoring/route.ts`) : authentifiée (`withAuth` +
  `requireSession`) et **réservée aux rôles propriétaire/responsable** (403
  sinon). Renvoie `overall`, `statuses`, `system`, `process`, `database`,
  horodatage.
- Tableau de bord temps réel à `/monitoring` (page desktop) qui interroge cet
  endpoint.

**Réserve (audit) :** la page `/monitoring` ne semble pas avoir d'entrée de
navigation dans les composants — accessible par URL directe. Petite tâche
d'UX à combler.

---

## 3. Sondes de santé (health checks)

**Statut : Opérationnel**

Trois sondes distinctes, conçues pour ne jamais divulguer d'informations
d'infrastructure au public :

- **Cloud `GET /api/health`** (`garagesite3`) : liveness minimale — `SELECT 1`
  via Prisma → `200 {"status":"ok"}` ou `503 {"status":"degraded"}`. Aucun
  détail d'erreur, aucune variable d'env, aucune stack ; `Cache-Control:
  no-store` ; rate-limit léger en mémoire (60/min). Conçue pour un load
  balancer / moniteur d'uptime (`health/route.ts:1-38`).
- **Desktop/PWA `GET /api/health`** (`GarageFlowsV2`) : même réponse publique
  minimale (`ok` / `degraded`) hors Electron. **En mode Electron uniquement**
  (`ELECTRON=1`, serveur lié à `127.0.0.1`), la sonde renvoie un diagnostic de
  configuration (variables présentes/absentes + instructions) qui alimente
  l'écran de premier démarrage. Ce mode enrichi n'est **jamais exposé
  publiquement** car le serveur Electron n'écoute que sur la boucle locale
  (`health/route.ts:34-84`).
- `GET /api/analytics/health` (desktop) : sonde dédiée au sous-système
  analytique.

---

## 4. Journal d'audit (audit log)

**Statut : Opérationnel (cloud)**

Le plan de contrôle `garagesite3` tient un journal d'audit persistant
(`src/lib/server/audit.ts`, modèle Prisma `AuditLog`) :

- `logAudit()` est **best-effort et ne lève jamais** — l'audit ne doit jamais
  casser l'opération métier tracée (`audit.ts:35-54`).
- Catégories : `license | update | module | notification | crash | auth | admin
  | security` ; résultat `ok | denied | error` ; champs `actor`, `licenseId`,
  `targetId`, `ip`, `country`, `detail`, `meta` (JSON).
- Recherche filtrée admin (catégorie/action/résultat/dates/recherche libre) via
  `queryAudit` (`audit.ts:92-101`) et **export CSV** protégé contre l'injection
  de formule Excel/Sheets (`csvCell`, `audit.ts:117-124`). Consultable à
  `/admin/audit`.
- Chaque opération de release est aussi tracée dans `ReleaseEvent`
  (published / updated / rolled_back / deleted / downloaded — `releases/service.ts:36-47`).

**Limite connue :** le back-office admin s'authentifie par **une seule clé
maître partagée** (`LICENSE_ADMIN_API_KEY`) ; les entrées d'audit ne peuvent
donc pas être attribuées à un opérateur individuel (pas d'identité par
utilisateur / RBAC). Voir l'audit d'acquisition, domaine sécurité.

---

## 5. Rapport de crash (crash reporting)

**Statut : Opérationnel (ingestion + regroupement + triage)**

- **Côté desktop** (`electron/control-plane.js`) : opt-in par défaut **désactivé**
  (conformité RGPD), rédaction/minimisation avant envoi (secrets, tokens, JWT,
  tokens de licence, chaînes DB, noms d'utilisateur), HWID jamais transmis en
  clair (hash court de 16 caractères), file d'attente hors-ligne, tailles
  bornées (`sanitizeCrashReport`, `control-plane.js:104-157`).
- **Côté cloud** (`garagesite3/src/lib/crashes/service.ts`) : ingestion via
  `POST /api/crash` (public, non authentifié, Zod-borné), regroupement par
  **empreinte stable** (message normalisé + top frame + version majeure.mineure
  — `computeFingerprint`), statistiques (total, 24 h, 7 j, par version, top
  empreintes), recherche/filtre et triage `handled` à `/admin/crashes`.

Ce sous-système alimente directement le rollback automatique (voir §6 et
`docs/ROLLOUT_AND_ROLLBACK.md`) : `crashCountForVersion` ne compte **que les
HWID correspondant à un appareil enregistré** (`Device.hwidHash`), ce qui
neutralise le déni de service du déploiement par rapports anonymes
(`crashes/service.ts:188-221`).

---

## 6. Vercel Cron — rollback automatique planifié + `CRON_SECRET`

**Statut : Opérationnel (ajout de cette session)**

Historiquement, la fonction `autoRollbackIfUnhealthy` existait
(`releases/service.ts:206-228`) mais **aucun planificateur ne l'appelait** — le
« rollback automatique » n'était donc pas réellement automatique (constat de
l'audit). Cette lacune est désormais fermée :

- **Planification** : `garagesite3/vercel.json` déclare une tâche Vercel Cron
  horaire :

  ```json
  { "crons": [ { "path": "/api/cron/rollback-check", "schedule": "0 * * * *" } ] }
  ```

- **Endpoint** `GET /api/cron/rollback-check`
  (`src/app/api/cron/rollback-check/route.ts`) : invoque
  `autoRollbackIfUnhealthy` (idempotent), journalise un audit `update /
  auto_rollback` si des versions ont basculé, et renvoie la liste des versions
  rollback.
- **Seuils configurables** par variables d'environnement :
  `ROLLBACK_CRASH_THRESHOLD` (défaut 10 machines distinctes en crash) et
  `ROLLBACK_WINDOW_MINUTES` (défaut 60).
- **Authentification `CRON_SECRET` — politique fail-closed**
  (`src/lib/server/cron-auth.ts`) :
  - Vercel Cron appelle l'endpoint avec l'en-tête `Authorization: Bearer
    <CRON_SECRET>` ;
  - vérification en **comparaison à temps constant** (`crypto.timingSafeEqual`) ;
  - **si `CRON_SECRET` n'est pas configuré, la route refuse (503)** — une tâche
    planifiée sensible ne doit jamais être invocable sans secret ; un bearer
    invalide/absent renvoie 401 ;
  - le secret n'est jamais journalisé.
- **Tests** : `src/lib/server/__tests__/cron-auth.test.ts` (5 cas) couvre
  l'absence de secret (503), le bearer valide, le bearer invalide, l'absence
  d'en-tête. Fait partie des **140 tests cloud verts** de cette session.

> Le même moteur de rollback reste également invocable manuellement par un
> administrateur via `POST /api/admin/update/rollback-check` (auth `x-gf-key`),
> utile pour un déclenchement à la demande. Voir `docs/ROLLOUT_AND_ROLLBACK.md`.

---

## Synthèse des statuts

| Capacité | Dépôt | Statut |
|----------|-------|--------|
| Logger structuré + rédaction PII | desktop | Opérationnel |
| Rédaction des crashs avant envoi | desktop | Opérationnel |
| Monitoring hôte/DB (métriques réelles + notation) | desktop | Opérationnel |
| Entrée de navigation vers `/monitoring` | desktop | Manquante (petit écart UX) |
| Sondes `/api/health` (publique minimale + Electron diag) | les deux | Opérationnel |
| Journal d'audit persistant + export CSV | cloud | Opérationnel |
| Crash reporting (ingestion, regroupement, triage) | les deux | Opérationnel |
| Vercel Cron rollback auto + `CRON_SECRET` fail-closed | cloud | Opérationnel (cette session) |
| Corrélation de requêtes (`traceId`) | — | Non construit (feuille de route) |
| Export de métriques (Prometheus / OpenTelemetry) | — | Non construit (feuille de route) |

---

*Référence croisée : voir `docs/ACQUISITION_READINESS_AUDIT.md` pour l'analyse de maturité et les risques classés.*
