---
doc-numbers: journal
---

# Commandes exécutées — MASTER 2

Toutes les commandes ont été exécutées depuis `/home/user/GarageFlowsV2`, sauf inspections de tarballs en `/tmp`. Les journaux sont dans `artifacts/verification/production-readiness-2026-10-22/`. Les erreurs d’invocation de l’opérateur sont conservées et distinguées des défauts du produit.

| Journal | Commande/action principale | Résultat |
|---|---|---|
| 00–02 | état Git, versions, SHA des 26 preuves historiques, `git ls-remote` | base et branche distante confirmées ; 26 empreintes valides |
| 03 | `node scripts/diagnose-prisma-runtime.cjs` | exit 1 ; npm TLS 200, Prisma `ECONNRESET` pré-TLS |
| 04 | versions/générateurs/présence env/npm strict-ssl/caches/moteurs | strict-ssl true ; aucun moteur/cache natif |
| 05 | typecheck, lint, 3 suites ciblées, release-safety | 20/20 ciblés ; 172/172 avant nouveaux tests |
| 06 | `node --test tests/*.test.cjs`, `test:config`, `test:config:auto` | 495/495, 245/245, 119/119 |
| 07 | `npm pack @prisma/engines@5.22.0 --ignore-scripts`, recherche npm | 10 fichiers JS, aucun moteur |
| 08 | `gh api` releases Prisma et commit moteur | release 5.22.0 : 0 asset ; prisma-engines : 0 release |
| 09 | inspection `@prisma/fetch-engine`, cache et toolchain | checksums requis ; Cargo/Rust absents |
| 10 | versions Playwright, exécutables, paquets navigateur, Electron local | navigateurs absents ; Electron non installé ; tentative de fetch en échec |
| 11 | cohérence/desktop puis `check:supply-chain` | gardes vertes ; **erreur opérateur : script inexistant**, audit interrompu |
| 12 | `npm run test:keygen` sans `PATH` du venv | **erreur opérateur : cryptography absent**, 20 erreurs initiales |
| 13 | `npx playwright install chromium` | exit 1 ; CDN officiel `ECONNRESET` |
| 14 | `PATH=/tmp/gf-python-venv/bin:$PATH npm run test:keygen` | exit 0 ; 178 réussis, 1 OCR ignoré |
| 15 | `npm test` | exit 1 ; 277/83/5 fichiers, 3 541/4/879 tests ; PATH Python incomplet en plus de Prisma |
| 16 | `npm run test:audit && npm run audit:strict` | 23/23 ; 0 vulnérabilité |
| 17 | trois chemins Vitest Python supposés | **erreur opérateur : fichiers inexistants**, aucun test exécuté |
| 18 | build officiel, Next direct, postbuild, verify standalone | 1 / 0 / 0 / 1 ; moteur absent |
| 19 | trois fichiers keygen réellement identifiés, avec venv | 26/26 |
| 20 | `playwright test --list`, sonde `chromium.launch()` | 144 listés ; lancement exit 1, 0 scénario |
| 21 | présence des accès staging/Windows/artefact | aucune valeur lue ; accès absents |
| 22 | test de verdict avant correction, commandes stubbées | 2 échecs/1 réussite : faux vert reproduit |
| 23 | même test après correction | 3/3 |
| 24 | tests des deux portes fail-closed | 12/12 |
| 25 | perf, scan standalone, preflight, verify installer | 0 / 0 / 0 / 1 ; aucun `dist/` |
| 26 | diff HWID/licence, hashes locaux, clés suivies | diff 0 ; `.env` 600 ; aucune clé privée suivie |
| 27 | license-checker par chemin supposé + `npm sbom` sans format | **erreurs opérateur** conservées ; aucun inventaire exploité |
| 28 | `npx license-checker`, npm 11.16.0 SBOM CycloneDX | 132 entrées ; 96 composants ; exits 0 |
| 29 | standalone sans configuration | démarrage refusé par instrumentation ; processus arrêté |
| 30 | standalone avec `--env-file=.env`, `ELECTRON=1` | prêt HTTP ; valeurs non affichées ; processus arrêté après smoke |
| 31 | neuf requêtes curl + en-têtes | assertions 0 ; health attendu et mesuré 503 |
| 32 | delta SBOM/notices, présence outils | 33 noms non appariés ; Go/Docker/Gitleaks/Tesseract absents |
| 33 | release-safety puis tous les tests Node | 184/184 ; 507/507 |
| 34 | typecheck, lint, cohérence, desktop, test:audit, audit strict | tous exits 0 |
| 35 | nouveaux tests après ajout de l’exigence OCR | 12/12, exit 0 |
| 36 | contrôles statiques avec les rapports MASTER 2 | typecheck/lint/cohérence/audits verts, exit 0 |
| 37 | `npm run config:audit` | 2 907 fichiers inventoriés à cette étape, exit 0 |
| 38 | snapshot Git non ignoré + `check-artifact-secrets.mjs` | première passe limitée puis passe tous textes ; compteurs réels dans le journal, aucune détection ciblée |
| 39 | `npm run readiness:final` | exit 1 ; 11 pass, 22 non verts sur 33 ; NON PRÊT |
| 40 | scan ciblé des preuves MASTER 2 | périmètre et résultat réels dans le journal ; pas Gitleaks ni historique |

## Commandes volontairement non exécutées

- `npm ci` : répéterait l’effacement/réinstallation puis le même téléchargement Prisma sans nouveau canal ; aucune nouvelle cause à tester.
- `npm run dist` : moteur Prisma, Electron et cible Windows absents ; ne pas produire de faux Setup.
- migrations PostgreSQL, appels Redis/SMTP/facturation : accès de test absents.
- `npm audit fix --force`, reset DB, rotation de clés, déploiement, commit/push et publication : interdits ou non autorisés.

Les commandes de lecture de fichiers, `git diff/status`, recherches de sources et inspections de rapports ne sont pas toutes détaillées ; elles n’ont ni modifié les données ni contacté de service métier.
