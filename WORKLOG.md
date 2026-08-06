# WORKLOG — Journal horodaté de l'audit GarageFlows

> Journal d'opérations de l'audit maître (Phase 0 → 29). Heures en UTC.
> Chaque entrée correspond à des commandes réellement exécutées ; les sorties
> sensibles sont masquées. Ce fichier est mis à jour à chaque phase.

| Horodatage (UTC) | Phase | Opération | Résultat |
|---|---|---|---|
| 2026-08-06T13:39Z | 0 | Capture état Git des deux dépôts (`git rev-parse HEAD`, `git status --porcelain`) | GarageFlowsV2 `cec7588` propre ; garagesite3 `2d56142` propre |
| 2026-08-06T13:39Z | 0 | Relevé des versions (`node --version`, versions des paquets) | Node v22.22.2, npm 10.9.7, Next 14.2.35 (app) / 15.1.6 (vitrine), Prisma 5.22.0, Electron 31.7.7, TS 5.9.3, Vitest 4.1.5 |
| 2026-08-06T13:41Z | 0 | Empreintes SHA-256 (`git archive HEAD \| sha256sum`, une par dépôt, `git -C` explicite après deux mesures invalides à cause du répertoire courant — corrigées et revérifiées distinctes) | `d5b7ac…93f8` (app), `3643e5…33aa` (vitrine) — consignées dans `INITIAL_SHA256.txt` |
| 2026-08-06T13:42Z | 0 | Inventaire des fichiers suivis (`git ls-files`) | 680 fichiers (app), 213 (vitrine) — répartition dans `BASELINE.md §4` |
| 2026-08-06T13:43Z | 0-1 | Lancement de la cartographie préliminaire : 12 lecteurs parallèles EN LECTURE SEULE (routes API, auth/sessions, licences/crypto, Electron, BDD/migrations, monnaie/e-invoicing, PWA/frontend, scripts/CI, docs/affirmations, reconnaissance secrets, vitrine complète, inventaire des tests) + 2 synthèses (inventaire, registre de risques) | Partiel : 6/12 sous-systèmes rendus (routes API, auth/sessions, licences/crypto, Electron, BDD, monnaie) ; les 8 autres agents interrompus par la limite de session (réinitialisation 15:20 UTC) — résultats obtenus conservés en cache |
| 2026-08-06T13:50Z | 0 | Rédaction `BASELINE.md`, `INITIAL_SHA256.txt`, `WORKLOG.md`, `docs/audit/AUDIT_EXECUTION_PLAN.md` ; gardes `check:branding` + `check:docs` relancés sur les nouveaux documents | 2/2 gardes verts (63 fichiers .md scannés) |
| 2026-08-06T16:01Z | 0-1 | Reprise du workflow de cartographie (`resumeFromRunId`) après réinitialisation de la limite : 6 lecteurs en cache + 2 synthèses réussies ; les 6 nouveaux lecteurs relancés individuellement (agents Explore) | 12/12 sous-systèmes cartographiés |
| 2026-08-06T17:10Z | 1 | Vérification directe (lecture) des findings hauts avant inscription : facture émise (invoices/[id]:35-61), OR signé (work-orders/[id]:92-170), garde Electron (main.js:1898) | 3 findings CONFIRMÉS par l'auditeur |
| 2026-08-06T17:18Z | 7/9/13 | Correctif : `src/lib/document-status.ts` (machine à états) câblé dans invoices/quotes/work-orders ; `localOrigin` défini dans main.js. Tests document-status (19) + document-immutability e2e (6) | `tsc` 0 erreur, `next lint` 0, 32 tests verts, gardes migration-safety+branding verts — commit `a5044a0` |
| 2026-08-06T17:30Z | 0-1 | Rédaction `REPOSITORY_INVENTORY.md` (12 sous-systèmes) et `docs/audit/RISK_REGISTER.md` (48 risques AUD-001..048, 4 corrigés) à partir des 12 cartographies | Livrables Phase 0 complets |
| 2026-08-06T19:20Z | C (5) | Audit statique adversarial IDOR/garageId (workflow, 8 groupes → ~56 familles, 141 routes) + vérification adversariale de chaque faille alléguée | `totalAlleged: 0, confirmed: 0` — aucune faille d'isolation ; toutes routes scopées par garageId |
| 2026-08-06T19:28Z | C (5) | Matrice de permutation end-to-end (`tenant-isolation-matrix.test.ts`, 14 familles × tous verbes, session A → ressource B) + hardening `parts/[id]` DELETE (findFirst→404) | 38 tests verts ; suite isolation complète 63 verte |
| 2026-08-06T19:29Z | C (5) | Matrice de rôles exhaustive (`authz-full-matrix.test.ts`, 128 cellules rôle × permission + deny-by-default + hiérarchie) | 139 tests verts ; `tsc` 0, `lint` 0 |
| 2026-08-06T19:38Z | D1 (2) | garagesite3 : `npm ci` (deps absentes) ; migration de 6 routes publiques du limiteur mémoire → distribué fail-closed (`enforceDistributedLimit`) ; health = exception documentée | `tsc` 0, `lint` 0, suite 140 verte ; commit `8f880af` |
| 2026-08-06T19:42Z | D2 (2) | garagesite3 : CORS défaut-refus (`corsHeaders()`), blob-upload rate-limit+audit, jeton SSE à clé séparée ; tests cors + sse-token-key | `tsc` 0, `lint` 0, suite 147 verte ; commit `cbfa5e3` |
| 2026-08-06T19:50Z | D-fin (7) | Cluster PostgreSQL 16 local jetable (initdb/pg_ctl sous `pguser`) ; test de concurrence de numérotation via vrai handler POST (`document-numbering.postgres.int.test.ts`) | 50 POST parallèles → 50 numéros distincts contigus, compteur=50, 0 échec ; 1/1 vert |
| 2026-08-06T19:52Z | D-fin (7) | Conformité FEC : libellé TVA au taux réel + nom de fichier DGFiP ; test `fec-export.test.ts` | 7 verts ; gardes money/money-calc/money-json verts ; commit `84b0742` |
