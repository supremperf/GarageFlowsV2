# Release Process

> **Document canonique : [`scripts/final-release-gate.mjs`](../../../scripts/final-release-gate.mjs)** — cette fiche de data room est
> un pointeur : le contenu fait foi à l'emplacement canonique (anti-divergence).

Fast checks par PR (CI), gate complet avant release : npm run release:gate (tsc, lint, 10 gardes, tests, PG/Redis réels, audit dépendances, build, budget perf). Windows : dist:win + Authenticode (validation externe).
