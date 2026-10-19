# Blocages 1–2 — faisabilité Prisma, build et reprise contrôlée

## Résultat observé, pas une attestation de compilation

`npm run build` termine en **exit 1 avant `next build`**. Commande réellement développée :

```text
prisma generate && prisma generate --schema prisma/server/schema.prisma && next build
Error: request to https://binaries.prisma.sh/all_commits/605197351a3c8bdd595af2d2a9bc3025bca48ea2/debian-openssl-3.0.x/libquery_engine.so.node.gz.sha256 failed, reason: Client network socket disconnected before secure TLS connection was established
```

Sortie complète : [build.log](build.log). Une requête directe vers le schema engine échoue aussi : `curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to binaries.prisma.sh:443`, dans [engine-alternatives.log](engine-alternatives.log). Ce sont des preuves d'échec de connexion/TLS, **pas** une preuve de panne DNS ni de certificat invalide. Aucun contournement TLS ou téléchargement non vérifié effectué.

La dépendance externe immédiate est la disponibilité des moteurs **natifs compatibles avec Prisma 5.22.0, commit moteur `605197351a3c8bdd595af2d2a9bc3025bca48ea2`, plateforme `debian-openssl-3.0.x`**. Leur absence explique l'arrêt observé ; elle ne prouve pas que la compilation Next ou les tests métier passeraient ensuite.

## Alternatives réellement examinées

| Piste | Recherche / tentative | Conclusion limitée |
|---|---|---|
| Vendor, `node_modules`, caches locaux | Inventaire des moteurs natifs, des clients générés, caches npm et chemins connus. | Aucun schema/query engine natif réutilisable trouvé. Le package npm `@prisma/engines` contient son téléchargement, pas un moteur installé utilisable ici. |
| Git / historique | Checkout désuperficialisé, historique complet de 481 commits ; recherche d'objets aux noms moteurs/clients générés. | Aucun objet correspondant trouvé. Ce résultat de recherche n'est pas une preuve d'absence de secret dans tout l'historique. |
| Miroir | Support `PRISMA_ENGINES_MIRROR` inspecté dans le CLI installé, source officielle et accès direct testés. | Aucune URL de miroir fiable/accesssible pour ce commit n'est fournie ou découverte ; changer une variable sans contenu correspondant ne fabrique pas le moteur. Aucun miroir tiers non vérifié utilisé. |
| Cibles CLI | `PRISMA_CLI_BINARY_TARGETS` examiné comme sélection de plateforme. | Une autre cible doit encore être téléchargée et être compatible avec le runtime ; ce n'est ni une source ni un remplacement de binaire. |
| Binaire préinstallé | `PRISMA_SCHEMA_ENGINE_BINARY`, `PRISMA_QUERY_ENGINE_LIBRARY` pris en charge ; recherche de fichiers correspondants. | Aucun chemin natif valable à leur fournir. `/bin/true` n'a été utilisé que pour permettre la génération `--no-engine` de types/clients mockés, jamais présenté comme moteur Prisma. |
| GitHub / CI | [12 caches npm](ci-caches.json), [18 artefacts d'installateurs Windows](ci-artifacts.json), releases du dépôt de moteurs examinées. | Aucun cache moteur directement exploitable trouvé. Un installateur Windows peut contenir du standalone Linux : il n'a pas été exclu sur son seul nom. |
| Inspection d'artefact CI | Tentative `gh api repos/supremperf/GarageFlowsV2/actions/artifacts/12077397082/zip`. | Le téléchargement redirigé vers `productionresultssa0.blob.core.windows.net` échoue `EOF`, fichier reçu de zéro octet. Aucune extraction/inspection interne possible. L'URL signée éphémère n'est pas publiée. |
| `generate --no-engine` | Deux clients générés pour le typage et les tests mockés. | Types disponibles, mais aucune exécution SQL native. Le fichier `tenant-isolation` montre explicitement l'erreur de protocole `prisma://` de ce mode. |
| Data Proxy / Accelerate | Chemins du runtime officiel 5.22.0 lus. | URL/service/API key et contrat d'exploitation distincts ; pas de remplacement transparent de SQLite local/offline, ni du CLI schema engine. Pas d'implémentation imposée. |
| Driver adapters / WASM | Branche adapter et modes wasm du runtime 5.22.0 lus ; absence de dépendances/adaptation existante évaluée. | Le runtime rejette explicitement adapter + `--no-engine`. Une adaptation du générateur, du driver SQLite/PG et des transactions serait une migration à recetter ; elle ne remplace pas `db push`/schema engine. Pas de preuve de viabilité de bout en bout dans ce dépôt, pas de faux contournement. |

Source officielle consultée : [Prisma 5.22.0, `getEngineInstance.ts`](https://github.com/prisma/prisma/blob/5.22.0/packages/client/src/runtime/core/init/getEngineInstance.ts). [Copie non modifiée](prisma-5.22-getEngineInstance.ts.txt), attribution Prisma, licence Apache-2.0 ; texte de licence également dans les [notices du projet](../../../../THIRD_PARTY_NOTICES.md). La conclusion concerne **cette version**, pas toutes les versions futures de Prisma.

## Procédure de reprise CI — aucun accès production nécessaire

À exécuter dans un clone/runner jetable autorisé, **sans URL de base, clé API ou clé de signature de production dans l'environnement**. Les tests d'intégration créent/modifient leurs bases de test : ne jamais les pointer vers la production. Les commandes ci-dessous sont une procédure de reprise, pas des succès déjà observés.

1. Utiliser Node 22 dans la plage `>=22.12.0 <23` et npm **11.16.0** déclaré dans `packageManager`. L'audit local a utilisé Node 22.22.3 / npm 10.9.8 ; l'identité de toolchain avec la CI n'est donc pas attestée.
2. Autoriser le téléchargement HTTPS de `binaries.prisma.sh` (et des dépendances nécessaires), **ou** alimenter un miroir interne validé avec moteurs et checksums du commit exact ci-dessus. Pour l'artefact CI, autoriser aussi sa destination de téléchargement authentifiée. Ne pas désactiver TLS, ignorer les checksums ou copier un engine de version arbitraire.
3. Si un cache est fourni, l'indexer par version/commit moteur, OS, architecture et OpenSSL ; vérifier son empreinte contre une référence de confiance. Copier les binaires au chemin attendu ou renseigner les overrides avec les vrais fichiers compatibles. Une archive d'installateur n'est pas une attestation de leur intégrité.
4. En mode téléchargement normal, retirer les overrides factices et le mode sans moteur, installer le lock puis régénérer les deux clients :

```sh
unset PRISMA_QUERY_ENGINE_LIBRARY PRISMA_QUERY_ENGINE_BINARY
unset PRISMA_SCHEMA_ENGINE_BINARY PRISMA_GENERATE_NO_ENGINE PRISMA_CLIENT_ENGINE_TYPE
# Avec le npm épinglé ; exécute les hooks d'installation dans ce runner jetable.
npx --yes npm@11.16.0 ci
npx prisma generate
npx prisma generate --schema prisma/server/schema.prisma
npm run lint
npm run type-check
PATH="$PWD/.venv/bin:$PATH" npx vitest run --maxWorkers=8 \
  --reporter=json --outputFile=artifacts/verification/test-results.json
```

Créer auparavant le virtualenv Python de test avec les dépendances/hashes du dépôt si les tests d'interopérabilité doivent être exécutés :

```sh
python3 -m venv .venv
.venv/bin/python -m pip install --require-hashes -r tests/requirements-keygen.txt
```
Ne pas réutiliser une clé émettrice de production sur ce runner généraliste.

5. Après lecture réelle des résultats (y compris en cas d'exit 1), générer la baseline depuis **ce** JSON : `node scripts/generate-verification-baseline.mjs`. Ne pas publier une ancienne baseline comme résultat d'une commande échouée. Puis `npm run check:consistency`, `node --test tests/*.test.cjs`, `npm run build`. Le build appelle `postbuild` : conserver et contrôler ses artefacts, pas uniquement le code de sortie Next.
6. Provisionner séparément PostgreSQL/psql et Redis de **test**, définir `TEST_POSTGRES_URL` / `TEST_REDIS_URL` sans les afficher, rejouer les suites conditionnelles et les tests de concurrence/migrations. Aucun `db push`, `migrate deploy`, reset ou seed sur production.
7. Sur runner adapté : installer Chromium pour Playwright, exécuter les tests navigateur ; construire/recetter l'artefact Windows/Electron réel et son manifeste d'intégrité. Les 144 tests E2E découverts ici n'ont pas été exécutés.
8. Obtenir Gitleaks via une source vérifiée et analyser arbre, historique et artefacts. Le téléchargement de Gitleaks ici a échoué avant le scan ; l'installation Chromium a aussi échoué avant TLS. Voir [preuves Gitleaks](gitleaks-download.log) et [Chromium](browser-install.log).

Après ces actions, analyser chaque échec nouvellement accessible : les 79 fichiers bloqués n'ont pas démontré l'absence de régression. Un build vert seul ne ferme ni le workflow administratif manquant, ni les catégories A–K partielles, ni la vérification production des clés.
