# Observation CI — candidat applicatif c1f6a5c

Observation officielle : 2026-10-15T14:50:58.104613+00:00. Snapshot immuable ; ce n’est pas l’état futur de la publication documentaire.

| Check ID | Contrôle | État observé | Conclusion |
|---|---|---|---|
| [116490381676](https://github.com/supremperf/GarageFlowsV2/actions/runs/38754395646/job/116490381676) | Windows candidate packaging and inspection (not publication) | completed | skipped |
| [116490380425](https://github.com/supremperf/GarageFlowsV2/actions/runs/38754395646/job/116490380425) | Authenticated browser validation (approved staging only) | completed | skipped |
| [116490379319](https://github.com/supremperf/GarageFlowsV2/actions/runs/38754395646/job/116490379319) | Required validation | completed | failure |
| [116489638190](https://github.com/supremperf/GarageFlowsV2/runs/116489638190) | CodeQL | completed | failure |
| [116488854362](https://github.com/supremperf/GarageFlowsV2/actions/runs/38754395646/job/116488854362) | Final release gate (full) | completed | skipped |
| [116488852838](https://github.com/supremperf/GarageFlowsV2/actions/runs/38754395646/job/116488852838) | Native base (TypeScript, standard build, fixed JS budget) | completed | success |
| [116488852594](https://github.com/supremperf/GarageFlowsV2/actions/runs/38754395646/job/116488852594) | Full dependency tree — zero vulnerabilities | completed | success |
| [116488852580](https://github.com/supremperf/GarageFlowsV2/actions/runs/38754395646/job/116488852580) | Secret scan (Gitleaks) | completed | success |
| [116488852438](https://github.com/supremperf/GarageFlowsV2/actions/runs/38754395646/job/116488852438) | E2E (Playwright — responsive, auto-démarrage) | completed | success |
| [116488851902](https://github.com/supremperf/GarageFlowsV2/actions/runs/38754395646/job/116488851902) | Type-check, Lint & Test (desktop SQLite + serveur PostgreSQL) | completed | failure |
| [116488851076](https://github.com/supremperf/GarageFlowsV2/actions/runs/38754395394/job/116488851076) | Analyze (javascript-typescript) | completed | success |
| [116488818731](https://github.com/supremperf/GarageFlowsV2/actions/runs/38754385097/job/116488818731) | Final release gate (full) | completed | skipped |
| [116488817011](https://github.com/supremperf/GarageFlowsV2/actions/runs/38754385097/job/116488817011) | E2E (Playwright — responsive, auto-démarrage) | completed | success |
| [116488816848](https://github.com/supremperf/GarageFlowsV2/actions/runs/38754385097/job/116488816848) | Type-check, Lint & Test (desktop SQLite + serveur PostgreSQL) | in_progress | EN COURS / NON CONCLU |
| [116488816689](https://github.com/supremperf/GarageFlowsV2/actions/runs/38754385097/job/116488816689) | Native base (TypeScript, standard build, fixed JS budget) | completed | success |
| [116488816653](https://github.com/supremperf/GarageFlowsV2/actions/runs/38754385097/job/116488816653) | Full dependency tree — zero vulnerabilities | completed | success |
| [116488816144](https://github.com/supremperf/GarageFlowsV2/actions/runs/38754385097/job/116488816144) | Secret scan (Gitleaks) | completed | success |

Preuves des étapes déjà émises (indépendamment de la conclusion globale du job) :

- Check 116488852838 : 3612476/3625984 octets JS, 237 fichiers ; build standard seulement.
- Check 116488852580 : Gitleaks total=0, coverageComplete=True, arbre effectivement scanné 036404c154c4fc2750c8adce18dd55d8a137cbe0.
- Check 116488851902 : enfant natif exit 0, 54 exécutés, 54 attendus, passed=True. Pas une recette d’auth réelle.
- Check 116488816689 : 3612476/3625984 octets JS, 237 fichiers ; build standard seulement.
- Check 116488816144 : Gitleaks total=0, coverageComplete=True, arbre effectivement scanné c1f6a5cc53a6ea4a7346f747567b8a585bc4a7de.

Les captures historiques associées sont des diagnostics négatifs, jamais ajoutées aux 54 PASS. Le check CodeQL de publication d’analyse peut réussir alors que le check de résultats sécurité demeure en échec. Les portes de recette authentifiée et de release ne sont pas rendues optionnelles.

Commandes de collecte : `gh api repos/supremperf/GarageFlowsV2/commits/c1f6a5c/check-runs?per_page=100`, puis `gh api repos/supremperf/GarageFlowsV2/check-runs/<ID observable ci-dessus>/annotations?per_page=100` pour les contrôles natifs, secrets, base et Analyze. Les valeurs encodées sont uniquement les projections autorisées de notices, pas le SARIF brut.
