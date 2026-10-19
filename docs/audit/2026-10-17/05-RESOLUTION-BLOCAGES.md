<!-- doc-numbers: journal -->

# Phase 6 — résolution des blocages

## 2026-10-17T19:17:38Z — démarrage, blocage 1

Ordre de traitement : 1 tests/Prisma, 2 build, 3 environnement, 4 clés, 5 administration, 6 grille A–K. Aucun changement de production autorisé ou entrepris.

**Limite de conservation découverte :** les dépendances ignorées (`node_modules`, `.venv`) et les rapports bruts `/tmp/gf-full-last.json` de la passe précédente ne sont plus présents dans cet environnement repris. Le résumé `04-PREUVES.json` est conservé, mais ne contient pas les noms/stack traces des trois assertions. Il serait trompeur de les inventer. Une nouvelle exécution est donc nécessaire ; les traces nouvelles seront conservées sous `phase6/`, sans valeurs d'environnement privées. Les résultats historiques et ceux de cette passe seront distingués.

État : blocage 1 EN COURS ; blocs 2–6 NON ENCORE TRAITÉS. Aucun verdict GO.

## 2026-10-17T19:22:23Z — blocage 1 : BLOQUÉ-EXTERNE-DOCUMENTÉ

Preuves nominatives : [trois assertions, stacks intégrales et 79 fichiers](phase6/01-TESTS-ET-TRACES.md), [messages complets par fichier](phase6/vitest-failures.json), [849 tests pending nommés](phase6/pending-tests.tsv).

Nouvelle globale (exit 1) : **4 150 tests, 3 298 pass, 3 fail, 849 pending ; 341 fichiers, 262 pass, 79 failed**. Les six tests supplémentaires depuis la précédente globale correspondent au dernier mapping Electron déjà documenté. Les trois assertions échouées, dans `src/test-utils/__tests__/prepare-test-db.test.ts`, sont :

1. `produit une base exploitable, et le modèle porte l’empreinte du schéma` (ligne 28).
2. `le second appel réutilise le modèle au lieu de reconstruire` (ligne 46).
3. `une base déjà présente est REMPLACÉE, jamais réutilisée telle quelle` (ligne 68).

**78** fichiers rencontrent d'abord le téléchargement de moteur bloqué ; **1** (`tenant-isolation.test.ts`) atteint une requête sur le client `engine=none` et réclame une URL Accelerate `prisma://`. Ce n'est pas une simple absence de client généré : les deux clients existent pour typage/mocks, pas pour le runtime natif. **0 des 79 fichiers déclarés réparés ; 79 restent empêchés par l'environnement.** Les traces ne prouvent pas une régression applicative, mais ne prouvent pas non plus son absence. Il serait injustifié de qualifier ces 79 fichiers de faux négatifs « exclusivement » environnementaux sans les rejouer avec les moteurs.

### Alternatives vérifiées (a–d)

- **a / cache/vendor** : recherche sous `/home/user`, `/opt`, `/usr/local/lib`, `/tmp` puis `node_modules` : aucun `schema-engine-*` ou `libquery_engine*.so.node`. Les WASM de requêtes Prisma 5.22 sont présents ; ils ne remplacent pas le schema engine pour `db push`. Changer de binaryTarget ne crée pas un binaire absent. Les cibles Windows/rhel ne sont pas utilisables sur ce Linux Debian/OpenSSL 3.
- **b / miroir/variables** : aucune variable `PRISMA_*` préexistante, aucun miroir interne/local identifié. Support des overrides confirmé dans `@prisma/fetch-engine` (`PRISMA_ENGINES_MIRROR`, `PRISMA_SCHEMA_ENGINE_BINARY`, `PRISMA_QUERY_ENGINE_LIBRARY`). Aucun chemin valide à leur donner. Aucun domaine fictif ou miroir non fiable utilisé. Génération sans moteur possible avec `PRISMA_QUERY_ENGINE_LIBRARY=/bin/true PRISMA_SCHEMA_ENGINE_BINARY=/bin/true npx prisma generate --no-engine` (répétée pour `--schema prisma/server/schema.prisma`), strictement pour typage/mocks, pas contournement runtime.
- **c / histoire/CI** : `git fetch --unshallow origin` réussi, historique HEAD désormais 481 commits, aucun changement de branche ni de fichiers de travail. Aucun client généré/moteur dans les chemins historiques recherchés. L'API GitHub expose 12 caches **npm** (le workflow cache les paquets, pas `~/.cache/prisma`), et 18 artefacts : installateurs Windows / rapports Playwright, aucun artefact dédié moteurs Linux. Métadonnées dans [ci-caches.json](phase6/ci-caches.json) et [ci-artifacts.json](phase6/ci-artifacts.json). Les installateurs Windows ne sont pas exécutés ; une tentative ultérieure de téléchargement/inspection est documentée plus bas. Les caches Actions ne disposent pas d'une API REST de téléchargement équivalente aux artefacts ; aucune preuve de moteur caché ne peut être tirée de leur seul nom. Le dépôt officiel `prisma/prisma-engines` ne publie aucune release GitHub listée.
- **d / échec réseau** : `npx prisma generate` échoue sur `https://binaries.prisma.sh/all_commits/605197351a3c8bdd595af2d2a9bc3025bca48ea2/debian-openssl-3.0.x/libquery_engine.so.node.gz.sha256` : `Client network socket disconnected before secure TLS connection was established`. `curl -I --connect-timeout 10 --max-time 15 https://binaries.prisma.sh/all_commits/605197351a3c8bdd595af2d2a9bc3025bca48ea2/debian-openssl-3.0.x/schema-engine.sha256` : **curl 35**, `SSL_ERROR_SYSCALL`. [Journal alternatives](phase6/engine-alternatives.log), [erreur génération](phase6/prisma-generate-initial.log).

Conclusion : **non résolvable sans accès réseau sortant vers binaries.prisma.sh (ou domaine équivalent) dans cet environnement d'exécution**, ou fourniture contrôlée de moteurs officiels compatibles avec cette version. Pas de désactivation TLS, pas de binaire tiers exécuté, pas de tests supprimés.

### Pending

**813** skipped causés par hooks échoués ; **36** skips explicites : 21 PostgreSQL (TEST_POSTGRES_URL + psql + moteurs), 5 Redis (TEST_REDIS_URL), 1 artefact Windows réel, 7 présence de clés émettrices (2 comparaison publiques et 5 positifs à clé privée réelle), 2 jeton réel GF_TEST_LICENSE. **0 todo**. Détail nominatif exhaustif dans le TSV ; sites `.skipIf`/sélection de `describe.skip` examinés : pas d'oubli évident à activer sans prérequis. Le mécanisme de signature sans clé réelle sera testé au blocage 4 sans remplacer ni falsifier les tests visant l'émetteur réel.

## 2026-10-17T19:22:23Z — blocage 2 : BLOQUÉ EXTERNE CONFIRMÉ

Commande exacte : `npm run build`, soit `prisma generate && prisma generate --schema prisma/server/schema.prisma && next build` (+ postbuild npm seulement si succès). **Exit 1 avant Next**. [Erreur complète](phase6/build.log), réseau confirmé au point 1. Le fait d'obtenir du typage avec `--no-engine` ne valide pas ce build.

### Faisabilité des modes sans moteur natif — recommandation P1, pas patch opportuniste

Prisma verrouillé en **5.22.0** ; SQLite Electron + PostgreSQL PWA, scripts `db push` et migrations natives. `--no-engine` produit un client destiné notamment à Data Proxy/Accelerate ; il ne transforme pas une URL SQLite `file:` en datasource distante. Accelerate imposerait un service réseau, sa configuration, ses secrets et une évolution du contrat/offline Electron. Les driver adapters Prisma 5 sont expérimentaux et utilisent un moteur WASM de requêtes : ce n'est pas le mode Rust-free stable des versions récentes, ni un remplacement du CLI de schéma. `@prisma/adapter-pg` seul ne résout ni le schéma SQLite ni les migrations/db push des tests. Paquet adapter-pg absent du lock. Pas de modification de provider ou de protocole pour faire artificiellement passer le build.

P1 proposée : étudier séparément une montée de version Prisma compatible avec les deux moteurs, driver adapters PostgreSQL/SQLite, génération et outillage migrations, transaction/concurrence, packaging et performances. L'absence de moteurs natifs au runtime applicatif n'implique pas l'absence de toute dépendance de build/migration. Non implémenté ici : changement architectural, pas solution locale équivalente.

### Action infra et rejeu exact

Autoriser HTTPS vers `binaries.prisma.sh` (et destinations officielles de redirection nécessaires) **ou** fournir un miroir interne approuvé qui reproduit les chemins et checksums du commit moteur ci-dessus ; préchauffer les artefacts officiels Debian/OpenSSL3 et cibles Windows/rhel requises par les deux schémas. Sur CI, conserver en cache `~/.cache/prisma` et les dépendances appropriées avec clé OS/architecture/OpenSSL/version Prisma. L'image Docker préchargée est une option CI, pas un artefact inventé dans ce dépôt.

Dans un checkout de test propre, sans URL ni secret de production :

```sh
# Retirer uniquement les overrides de test dans CE shell ; pas de modification prod.
unset PRISMA_QUERY_ENGINE_LIBRARY PRISMA_QUERY_ENGINE_BINARY PRISMA_SCHEMA_ENGINE_BINARY PRISMA_GENERATE_NO_ENGINE
npm ci
npm run db:desktop:generate
npm run db:server:generate
npm run db:desktop:validate
npm run db:server:validate
npm run lint
npm run type-check
node --test tests/*.test.cjs
# Python : environnement isolé, requirements hash-lockés.
python3 -m venv .venv
.venv/bin/pip install --require-hashes --only-binary=:all: -r tests/requirements-keygen.txt
PATH="$PWD/.venv/bin:$PATH" npx vitest run --maxWorkers=8
npm run build
npm run check:perf-budget
```

La validation des 21 tests PostgreSQL et 5 Redis demande des **services jetables isolés**, jamais TEST_POSTGRES_URL pointant vers une base de production (les suites créent/suppriment des bases). Voir variables exactes dans les tests listés. Packaging Windows et validation d'artefact à rejouer sur runner Windows. Aucune migration production incluse dans cette procédure.

## 2026-10-17T19:22:23Z — blocage 3 : EN COURS

État initial reproduit : **28 constats** dans [env-before.log](phase6/env-before.log). Plan : supprimer la génération runtime d'alias, conserver l'acceptation d'entrées fournisseur uniquement dans une frontière explicite et testée, rendre le modèle `.env.storage.example` canonique ; autorisations de garde limitées à des fragments justifiés (pas exemption de tout un script). Préserver les empreintes de détection historiques.

## 2026-10-17T19:25:41+00:00 — blocage 3 : RÉSOLU

**28 → 24 → 0 constats** : [lot 1](phase6/env-batch1.log), [lot 2](phase6/env-batch2.log). Aucun de ces 28 constats ne portait une valeur par défaut dangereuse ou un fail-open : ce sont des violations de nom/périmètre, dont la génération d’un alias direct dans les outils. Le risque de cible DB contradictoire a été traité en amont : refus neutre avant export.

Quatre tests Node ajoutés : import canonique sans mutation/source ni export d’alias ; conflit refusé sans fuite ; alias runtime toujours interdit ; réintroduction dans le fichier d’import détectée par la garde sur copie isolée. **368/368 tests Node passent**. Pas d’exception de fichier entier : seules trois lignes d’entrée/preuve ont des exemptions précises, vérifiées comme non mortes par la garde. Le runtime ne lit pas cet alias.

| # initial | Variable/fichier et nature | Traitement individuel |
|---|---|---|
| 1 | scripts/compromised-secrets.json:29 : alias INTERDIT « DATABASE_URL_UNPOOLED » — utiliser « DIRECT_URL » (un nom canonique par configuration) | Métadonnée de détection historique conservée : exception exacte et justifiée dans la garde, aucune empreinte changée. |
| 2 | scripts/config-core.cjs:113 : alias INTERDIT « DATABASE_URL_UNPOOLED » — utiliser « DIRECT_URL » (un nom canonique par configuration) | Parsing d’entrée fournisseur seulement ; exception de fragment exact, gardes de sortie et tests ajoutés. |
| 3 | scripts/config-full.cjs:134 : alias INTERDIT « DATABASE_URL_UNPOOLED » — utiliser « DIRECT_URL » (un nom canonique par configuration) | Normalisation explicite du snapshot fournisseur puis assertNoAliases ; ancien filtrage ad hoc supprimé. |
| 4 | scripts/config-manager.cjs:296 : alias INTERDIT « DATABASE_URL_UNPOOLED » — utiliser « DIRECT_URL » (un nom canonique par configuration) | Écriture génératrice d’alias retirée du manager (chemin nominal et chemin de reprise). |
| 5 | scripts/config-manager.cjs:353 : alias INTERDIT « DATABASE_URL_UNPOOLED » — utiliser « DIRECT_URL » (un nom canonique par configuration) | Écriture génératrice d’alias retirée du manager (chemin nominal et chemin de reprise). |
| 6 | scripts/config-rebuild.cjs:11 : alias INTERDIT « DATABASE_URL_UNPOOLED » — utiliser « DIRECT_URL » (un nom canonique par configuration) | Constante d’entrée dédiée, conflit refusé et alias supprimé de la sortie ; exception précise testée. |
| 7 | scripts/lib/config-credentials.cjs:41 : alias INTERDIT « DATABASE_URL_UNPOOLED » — utiliser « DIRECT_URL » (un nom canonique par configuration) | Générateur Neon ne fabrique plus le doublon de DIRECT_URL. |
| 8 | scripts/lib/config-credentials.cjs:61 : alias INTERDIT « DATABASE_URL_UNPOOLED » — utiliser « DIRECT_URL » (un nom canonique par configuration) | Ancienne validation de doublon supprimée ; refus déplacé avant normalisation/export, sans fuite des URLs. |
| 9 | .env.storage.example : alias INTERDIT « DATABASE_URL_UNPOOLED » déclaré — renommer en « DIRECT_URL » | Déclaration d’alias retirée de .env.storage.example ; DIRECT_URL reste la seule connexion directe. |
| 10 | docs/CONFIG.md:330 : documentation ACTIVE citant l'alias « DATABASE_URL_UNPOOLED » — utiliser « DIRECT_URL » | Documentation active clarifiée : entrées non canoniques uniquement en import ; sortie et exemple canoniques. |
| 11 | .env.storage.example : nom non canonique « DATABASE_URL_UNPOOLED » | Déclaration d’alias retirée de .env.storage.example ; DIRECT_URL reste la seule connexion directe. |
| 12 | .env.storage.example : nom non canonique « PGHOST » | Champ fournisseur non canonique retiré du modèle .env.storage.example ; import existant toujours testé. Ne pas créer de variable runtime pour chaque champ brut du dashboard. |
| 13 | .env.storage.example : nom non canonique « PGHOST_UNPOOLED » | Champ fournisseur non canonique retiré du modèle .env.storage.example ; import existant toujours testé. Ne pas créer de variable runtime pour chaque champ brut du dashboard. |
| 14 | .env.storage.example : nom non canonique « PGUSER » | Champ fournisseur non canonique retiré du modèle .env.storage.example ; import existant toujours testé. Ne pas créer de variable runtime pour chaque champ brut du dashboard. |
| 15 | .env.storage.example : nom non canonique « PGDATABASE » | Champ fournisseur non canonique retiré du modèle .env.storage.example ; import existant toujours testé. Ne pas créer de variable runtime pour chaque champ brut du dashboard. |
| 16 | .env.storage.example : nom non canonique « PGPASSWORD » | Champ fournisseur non canonique retiré du modèle .env.storage.example ; import existant toujours testé. Ne pas créer de variable runtime pour chaque champ brut du dashboard. |
| 17 | .env.storage.example : nom non canonique « POSTGRES_URL » | Champ fournisseur non canonique retiré du modèle .env.storage.example ; import existant toujours testé. Ne pas créer de variable runtime pour chaque champ brut du dashboard. |
| 18 | .env.storage.example : nom non canonique « POSTGRES_URL_NON_POOLING » | Champ fournisseur non canonique retiré du modèle .env.storage.example ; import existant toujours testé. Ne pas créer de variable runtime pour chaque champ brut du dashboard. |
| 19 | .env.storage.example : nom non canonique « POSTGRES_USER » | Champ fournisseur non canonique retiré du modèle .env.storage.example ; import existant toujours testé. Ne pas créer de variable runtime pour chaque champ brut du dashboard. |
| 20 | .env.storage.example : nom non canonique « POSTGRES_HOST » | Champ fournisseur non canonique retiré du modèle .env.storage.example ; import existant toujours testé. Ne pas créer de variable runtime pour chaque champ brut du dashboard. |
| 21 | .env.storage.example : nom non canonique « POSTGRES_PASSWORD » | Champ fournisseur non canonique retiré du modèle .env.storage.example ; import existant toujours testé. Ne pas créer de variable runtime pour chaque champ brut du dashboard. |
| 22 | .env.storage.example : nom non canonique « POSTGRES_DATABASE » | Champ fournisseur non canonique retiré du modèle .env.storage.example ; import existant toujours testé. Ne pas créer de variable runtime pour chaque champ brut du dashboard. |
| 23 | .env.storage.example : nom non canonique « POSTGRES_URL_NO_SSL » | Champ fournisseur non canonique retiré du modèle .env.storage.example ; import existant toujours testé. Ne pas créer de variable runtime pour chaque champ brut du dashboard. |
| 24 | .env.storage.example : nom non canonique « POSTGRES_PRISMA_URL » | Champ fournisseur non canonique retiré du modèle .env.storage.example ; import existant toujours testé. Ne pas créer de variable runtime pour chaque champ brut du dashboard. |
| 25 | .env.storage.example : nom non canonique « BLOB_READ_WRITE_TOKEN » | Variable fournisseur légitime déclarée au manifeste comme secret d’outillage, autoManage/autoGenerate=false ; documentation générée et modèle canonique mis à jour. Aucun consommateur applicatif inventé. |
| 26 | .env.storage.example : nom non canonique « KV_REST_API_URL » | Champ fournisseur non canonique retiré du modèle .env.storage.example ; import existant toujours testé. Ne pas créer de variable runtime pour chaque champ brut du dashboard. |
| 27 | .env.storage.example : nom non canonique « KV_REST_API_TOKEN » | Champ fournisseur non canonique retiré du modèle .env.storage.example ; import existant toujours testé. Ne pas créer de variable runtime pour chaque champ brut du dashboard. |
| 28 | .env.storage.example : nom non canonique « KV_REST_API_READ_ONLY_TOKEN » | Champ fournisseur non canonique retiré du modèle .env.storage.example ; import existant toujours testé. Ne pas créer de variable runtime pour chaque champ brut du dashboard. |

Synchronisés : `.env.example`, `.env.storage.example`, README, `docs/CONFIG.md`, manifeste et `ENVIRONMENT-VARIABLES.md` (126 variables). `GF_PACKAGE_DESKTOP` était déjà déclaré/documenté : note de non-persistance ajoutée, pas de nouveau réglage runtime. `GF_REVOKE_BY_KEY_ENABLED` n’a plus de consommateur et ne doit pas être redéclaré comme flag actif : note explicite de retrait, fermeture permanente maintenue. Pas de résidu accepté en silence.

## 2026-10-17T19:29:12+00:00 — blocage 4 : PARTIELLEMENT RÉSOLU

Mécanisme validé par **5 tests fixture PWA/Electron/Python**, dont signature par le vrai keygen Python, acceptation et refus cryptographiques ; aucun secret réel utilisé, aucune ancre embarquée changée. **4 tests Node** du contrôle opérateur passent (accord de toutes les ancres, divergence, mauvaise courbe, CLI sans clé/clé étrangère). Dernier ciblé élargi **275/275 pass** ; lint/type-check exit 0. Les tests visant les clés réelles restent explicitement conditionnels, non remplacés par les fixtures.

[Procédure précise et distinction mécanisme / production](../../VERIFICATION_CLE_EMETTRICE.md). Nouveau `scripts/verify-license-issuer.mjs` : lecture seule, challenge non-GF2, aucun appel DB/HTTP, aucune clé/signature en sortie, aucune synchronisation. Sources identifiées : GF_PRIVATE_KEY base64 du serveur ou keys/private.pem Python ; deux ancres _LINES/_PK. Commentaire obsolète de public-key.ts corrigé sans changer la clé.

**Restant externe : attestation opérateur des clés et de la provenance des artefacts réellement déployés. Non vérifiable sans accès production.** Le script exige les deux ancres et vérifie en plus un PEM public attesté si fourni ; il ne prétend pas inspecter un bundle Next minifié. Les clés chiffrées/HSM nécessitent la procédure du gestionnaire autorisé, aucun déchiffrement/persistance automatique ajouté.

## 2026-10-17T19:29:43+00:00 — blocage 5 : constat avant correction

Recherche des appelants actifs dans scripts/src/electron : Keygen `_remote_set_status` (révocation, suspension, réactivation), ping GUI `_test_connection`, contrôle reset déjà bloqué et **contrôle oublié `Test-ApiKeyEndpoint` dans `scripts/configurer-api-garageflow.ps1:1158-1185`**. Ce dernier envoie encore une clé partagée vers le point retiré et attend HTTP200 : défaut d’outillage confirmé (P1), à rendre explicitement bloquant sans appel distant plutôt que déplacer le ping vers une autre route sensible. Les tests et dossiers historiques citant l’ancien contrat ne sont pas des clients de production. Des intégrations support hors dépôt restent à inventorier par l’opérateur.

Le remplacement exige une identité humaine et une fraîcheur MFA : `isAdminSession()` actuel (`src/lib/api-helpers.ts:140-156`) contrôle un cookie de licence admin, pas une preuve MFA humaine récente ; PATCH admin journalise les coupures en best-effort. **Ne pas prétendre que le simple PATCH existant satisfait la spécification forte.** Une nouvelle table d’opérations/autorisation et une intégration IAM/MFA supposent conception, tests d’intégration et approbation de migration ; une spécification/runbook P1 sera livrée, pas une activation par flag.

## 2026-10-17T19:32:34+00:00 — complément blocages 1/2, artefact CI

La lecture de `scripts/post-build.js:127-133` montre que le paquet Windows peut aussi copier des moteurs de cibles croisées. Il serait donc incorrect de déduire du seul nom « Windows » que son contenu exclut un moteur Linux. Tentative réelle : `gh api repos/supremperf/GarageFlowsV2/actions/artifacts/12077397082/zip > /tmp/gf6-installer.zip` → **exit 1, fichier 0 octet** ; redirection vers `productionresultssa0.blob.core.windows.net` interrompue avec `EOF`. URL signée volontairement non conservée (paramètres d’accès temporaires). L’inspection interne de cet artefact est donc elle aussi bloquée par le réseau ; aucun binaire non attesté exécuté. Ajouter le domaine officiel de stockage d’artefacts Actions à la liste d’accès si cette alternative est choisie, et attester provenance/version/checksum avant usage. La conclusion reste externe, avec cette alternative non inspectable plutôt qu’une exclusion de contenu affirmée sans preuve.

## 2026-10-17T19:32:34+00:00 — blocage 5 : PARTIELLEMENT RÉSOLU

[Spécification et runbook](../../REVOCATION_ADMIN_RUNBOOK.md) livrés : appelants et cas pré-activation, identité humaine/MFA fraîche, droits globaux distincts, CSRF/origine, challenge lié à l’intention, anti-rejeu et idempotence, tombstone, transaction MAC + audit/outbox durable, codes HTTP, neuf familles de tests, procédure opérateur et rollback. **Non implémenté** : nouvelle autorisation humaine/MFA, tables opération/outbox et recette DB native. Ce sont des travaux de développement locaux P1, pas seulement une action externe. Ne pas déclarer le code prêt.

Correctif d’outillage livré : `Test-ApiKeyEndpoint` de configurer-api ne fait plus aucun appel ni envoi de clé, reste bloquant et renvoie au runbook. Format CRLF/BOM préservé ; test Node ajouté. Les anciens ping/statut GUI échouent clairement sur 404, aucun appel n’est redirigé vers create/diagnostics et aucun flag ne réactive la route.

## 2026-10-17T19:32:34+00:00 — blocage 6 : constats supplémentaires avant correction

Revue transversale entamée hors incident : auth/RBAC/tenant, facturation/stock/monnaie, clients/véhicules, schémas/migrations, configuration Next, documentation produit, vues/modales et E2E. Défauts confirmés :

| ID | Preuve avant correction | Gravité / impact | Action prévue |
|---|---|---|---|
| P6-SEC-01 | `src/app/api/admin/licenses/create/route.ts:40-44`, `src/app/api/admin/diagnostics/route.ts:150-156` | P1 : ces deux autres consommateurs de clé partagée contournent aussi le fail-closed du limiteur ; la panne ouvre la voie au traitement coûteux ou sensible. | Retirer les deux exceptions, tests 503 sans enregistrement/diagnostic. |
| P6-SEC-02 | `src/lib/api-helpers.ts:140-156`, `admin/licenses/[id]/route.ts:192-227`, `admin/diagnostics/route.ts:70-120` | P1 ouvert : licence admin ≠ identité humaine/MFA ; journal coupures best-effort ; diagnostic renvoie des métadonnées de secrets (longueur, premier point de code, hash public tronqué), pas des valeurs mais surface sensible. | Remplacement fort spécifié blocage 5 ; minimisation/protection du diagnostic à développer et recetter, pas réactivation de la voie retirée. |
| P6-UI-01 | `src/components/LicenseChangeModal.tsx:36-53` | P2 : une panne du chargement appareils est cachée (`catch` vide), indiscernable d’un contexte absent ; pas d’état d’erreur/retry. | Afficher chargement/erreur neutre/retry ; tester transport et format sans mentir sur le rendu réel. |
| P6-API-01 | `src/app/api/invoices/route.ts:21-23`, motif aussi dans d’autres listes | P2 : pagination parseInt non finie (page=abc) propagée à Prisma au lieu de 400 ; API mal formée peut devenir 500. | Inventorier les sites, ajouter parseur commun et tests des listes concernées avant correction généralisée. Reste ouvert, aucune garantie zéro défaut. |
| P6-DOC-01 | `src/lib/license/public-key.ts:4-12` | P2 : ancien générateur absent et instruction d’édition manuelle des ancres. | Commentaire déjà corrigé lors du blocage 4 sans modifier la clé, procédure lecture seule ajoutée. |

### 2026-10-17T19:36:55+00:00 — constats documentation/licences avant correction

- `check:consistency` échoue maintenant à `check:docs` : trois journaux datés sont pris pour des comptes courants de la baseline ancienne. Le module `scripts/lib/docs-consistency.mjs` prévoit déjà `doc-numbers: journal` (uniquement exemption des compteurs, protections statut/canonicalité maintenues). Appliquer ce marqueur aux relevés datés, sans ignorer les documents entiers ni changer la garde.
- P6-LIC-01 (P1) : `THIRD_PARTY_NOTICES.md`/SBOM datent d’août (Next14, SDK0.79), alors que le lock courant est Next15/SDK0.91 ; `scripts/gen-third-party-notices.mjs:99` tronque chaque licence à 8 000 caractères, alors que les LICENSE Apache Prisma font 11 357 octets. Le lecteur ne distingue pas non plus deux versions imbriquées d’un paquet. Corriger la génération (texte intégral + chemin/version SBOM validés), tests fixture, régénérer SBOM/notices/inventaire local. Les notices du binaire Electron/Chromium et leur packaging restent à vérifier sur artefact réel.

### 2026-10-17T19:51:05+00:00 — P6-DOC-02, baseline canonique obsolète

La prose de `docs/audit/FINAL_VERIFICATION_BASELINE.md` revendique encore build OK, 0 fuite, preuve PostgreSQL/Redis et aucun défaut connu sur des mesures août, malgré les nouvelles mesures en échec. Le bloc AUTO seul ne suffit pas : correctif documentaire prévu, conserver une copie exacte publique du HEAD initial dans snapshots, remplacer la prose courante par l’état NO-GO mesuré, régénérer le bloc par le générateur existant et garder les résultats historiques comme historiques. Ne pas transformer un rapport rouge en attestation de build propre.

### 2026-10-17T19:56:09+00:00 — réexamen des skips : un prérequis illégitime identifié

Dans `src/lib/license/__tests__/forgery-resistance.test.ts`, le cas 7 (`alg: none`) porte `it.skipIf(SANS_CLE)` alors que son corps n’utilise aucune clé privée : il construit uniquement un en-tête et une charge utile non signés. Constat avant correction : ce test peut légitimement fonctionner sur clone propre. Retirer uniquement ce prérequis ; conserver les gardes de correspondance réelle et des cas signés par la clé émettrice. La ventilation antérieure de 849 pending était fidèle à cette exécution, mais surestimait d’une unité les prérequis nécessaires. Relancer la globale et régénérer la baseline après ce changement, sans inventer son résultat.

### 2026-10-17T20:02:51+00:00 — blocage 6, correctifs et revalidation finale

**Statut blocage 6 : PARTIEL.** [Grille A–K](phase6/03-GRILLE-A-K.md) créée : aucun domaine déclaré intégralement clos. Les chemins recensés portent explicitement « semantic completeness NOT attested ». Inventaires de 164 routes / 240 exports HTTP et 109 fichiers TSX, lecture transversale des domaines non liés à l’incident, schémas 43 desktop / 47 serveur et template SQLite (45 tables, integrity OK / FK 0, ouverture lecture seule). Cela ne remplace pas la revue sémantique de toutes les branches, les DB réelles, un navigateur ou un artefact distribué.

Correctifs expliqués et retestés :

| Constat | Changement | Validation et reste |
|---|---|---|
| P6-SEC-01 | Retrait des exceptions fail-open du rate limiter dans `admin/licenses/create` et `admin/diagnostics`. | Tests de panne : 503 sans création/diagnostic ; inclus dans la validation ciblée finale. |
| P6-SEC-02 | Risque maintenu ouvert : identité humaine/MFA et audit durable non fournis par une simple licence admin ; diagnostics trop détaillés. | SPEC P1/runbook, pas d’implémentation prétendue. Protection et minimisation locales encore à développer. |
| P6-UI-01 | Helper `devices-overview`, `no-store`, statuts/format/erreurs contrôlés ; modale avec erreur neutre et retry. | Tests transport et gardes UI ; aucun rendu navigateur attesté. |
| P6-API-01 | Parseur pagination strict commun et adoption sur `clients`, `invoices`, `quotes`, `vehicles`, `jobs` ; entrée invalide/débordement → 400 avant DB. Valeurs par défaut conservées. | 32 tests pagination (dont six antérieurs), inclus dans la ciblée finale. Autres routes et JSON null/array non uniformément traités restent ouverts. |
| P6-LIC-01 | Suppression de troncature, lecture licence intégrale et validation identité/version/realpath du paquet SBOM ; notices et inventaire régénérés (98 dépendances prod). | Trois tests Node, inclus dans les 376 ; LGPL/libvips/artefact Electron et avis juridique non clos. Dernière clarification locale : vérifier l’existence du dossier avant son realpath, sans bypass de frontière. |
| P6-DOC-01/02 | Procédure émetteur, liens/runbook et avertissement admin actif ; prose canonique NO-GO, copie exacte antérieure conservée et bloc AUTO régénéré depuis la vraie globale finale. | Gardes baseline/docs ciblées réussies ; pas de certification de build ou production. |
| Prérequis `alg: none` inutile | Retrait du seul `skipIf(SANS_CLE)` sur un test qui ne signe rien. | Test maintenant réussi sans clé privée ; suite forgery : 5 pass / 5 vrais skips. Aucun test de correspondance réelle artificiellement activé. |

Deux régressions de gardes ont été identifiées dans les globales intermédiaires et corrigées, sans les masquer derrière le réseau : [garde UI](phase6/intermediate-ui-guard-failure.json) après extraction du transport, puis [garde pagination](phase6/intermediate-pagination-guard-failure.json) après extraction du parseur. La première suit import/helper et vérifie erreur/retry ; la seconde suit import **et appel effectif** de `parsePagination`, inspecte son implémentation et teste import mort, appel sans import et nom inconnu. Pas de whitelist, suppression ou skip de ces tests.

**Globale finale exécutée de 19:56:14 à 19:57:23 UTC**, commande `PATH="$PWD/.venv/bin:$PATH" npx vitest run --maxWorkers=8 --reporter=json --outputFile=/tmp/gf6-release-verdict.json`, exit **1** : **4 194 total / 3 343 pass / 3 fail / 848 pending / 0 todo**, 345 fichiers, **79** en échec/empêchés d’aboutir. Ensemble des 79 fichiers identique au diagnostic initial ; **0/79 réparé** en runtime natif. 78 erreurs de téléchargement moteur, une erreur de protocole du client sans moteur. Trois assertions nominatives complètes dans [vitest-final-failures.json](phase6/vitest-final-failures.json). Leurs corps métier et les suites empêchées ne sont pas déclarés innocents.

Pending finaux : **813 hooks + 35 conditionnels** (21 PostgreSQL, 5 Redis, 1 artefact Windows, 6 clés réelles, 2 GF_TEST_LICENSE), contre 849 avant correction du prérequis inutile. [Liste exhaustive finale](phase6/pending-tests-final.tsv). L’analyse initiale des 36 prérequis est donc explicitement rectifiée, pas effacée.

Autres mesures : **477/477** sur 32 fichiers ciblés, **376/376 Node** sans skip, lint/type-check exit **0/0**, contrat env **0** problème (126/8/48), `npm audit` **0** vulnérabilité déclarée, **32** paquets outdated. Mécanismes crypto fixture vérifiés, clés/bundles production non vérifiés. Commandes, statuts et preuves dans [validation.json](phase6/validation.json). Build toujours arrêté avant Next ; Playwright 144 tests découverts mais non exécutés, Chromium/Gitleaks non téléchargés ; pas de packaging réel. L’écart npm local 10.9.8 / épinglé 11.16.0 est déclaré, pas assimilé à une CI identique.

**Verdict : NO-GO**, détaillé dans [06-VERDICT-FINAL.md](06-VERDICT-FINAL.md), avec conditions de bascule, travaux locaux et liste distincte des actions nécessitant l’accès production. Le blocage 3 seul est résolu ; 1/2 externes documentés ; 4/5/6 partiels. Aucune cause de production affirmée, aucun seuil ≥90 % atteint, aucune mutation production effectuée. Les derniers contrôles de cohérence, de liens et d’inventaire sont consignés après génération de ces livrables.

### 2026-10-17T20:03:38+00:00 — P6-DOC-03, dernier garde de cohérence

La première relance de `check:consistency` après actualisation de la baseline a correctement refusé `RAPPORT-FINAL.md:115` (ancien compteur 3671). Ce rapport porte explicitement sur les 14–16 août 2026 ; son statut actif était trompeur après changement de baseline. Avant correction : le marquer historique avec la convention existante, conserver son corps, ajouter un avertissement visible et un lien vers 06/baseline. Ne pas changer ses anciens compteurs pour faire croire à une exécution récente, ni affaiblir la garde.

### 2026-10-17T20:07:03+00:00 — contrôles de clôture documentaire (verdict inchangé)

Après P6-DOC-03 : `check:consistency` exit **0**, avec **deux contrôles de clé explicitement NON EXÉCUTÉS** faute de PEM public émetteur. Nouvelle validation ciblée sur les 32 fichiers : **477/477**, 0 pending ; lint/type-check **0/0**, `git diff --check` **0**. Contrôle des liens de fichiers locaux sur les 11 documents modifiés : **104** vérifiés, aucun absent (ne valide ni URL HTTP ni fragments). Les warnings SQLite expérimentaux sont conservés et recensés dans `phase6/warnings-final.json`, non masqués. Le collecteur d’inventaire est relancé après l’écriture des livrables finaux ; ses sorties ne constituent toujours pas une revue sémantique exhaustive. NO-GO maintenu.

### 2026-10-17T20:09:44+00:00 — conservation des preuves dans le dépôt

Contrôle de livraison : la règle globale `*.log` ignorait les sorties d’audit, bien que présentes dans le workspace. Ajouter une exception **strictement limitée** à `docs/audit/2026-10-17/phase6/*.log` pour conserver ces preuves requises dans les changements livrables ; ne pas autoriser les logs applicatifs généraux ni le rapport Vitest brut volumineux. Aucun log d’URL signée CI n’est copié dans ce dossier. Rejouer cohérence/diff et inventaire après cette exception ; tous les fichiers inventoriés sont vérifiés par SHA-256, pas déclarés conformes sémantiquement.
