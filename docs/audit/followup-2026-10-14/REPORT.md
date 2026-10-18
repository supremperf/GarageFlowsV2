<!-- doc-numbers: journal -->

# GarageFlows — suivi correctif du 14 octobre 2026

## A — Synthèse exécutive et décision

**Décision : NON PRÊT pour la production.** Des corrections réelles sont appliquées et testées, mais les critères cumulés d’installation native, suite complète, navigateur, distribution, autorité de licence, sécurité distante et revue exhaustive ne sont pas acquis.

Ce suivi conserve **sans modification** le rapport historique [`../REPORT-2026-10-14.md`](../REPORT-2026-10-14.md). Il n’est ni une nouvelle baseline canonique, ni une livraison. Branche : `arena/c9eaae15-garageflowsv2`, HEAD `c4a2cca2cf446f96be580e99cca8afbca45396c5`. Travail préexistant conservé ; aucun commit/push, fusion, déploiement, publication, rotation de clé ou accès/modification de DB de production effectué. Les opérations SQLite mutantes des régressions utilisent des fixtures temporaires possédées par les tests. Le modèle commité est ouvert en lecture seule et son empreinte reste identique.

### Les cinq blocages initiaux

| Exigence | Statut | Preuve et portée exacte |
|---|---|---|
| B1 — Installation normale/native/Prisma | **BLOQUÉ** | `npm ci` normal sur snapshot propre : exit1 au téléchargement Electron. Prisma normal : récupération de checksum officielle échouée. Installation JS seule ≠ installation complète. |
| B2 — Suite Vitest complète | **ÉCHOUÉ** | 2 895 passed, 3 failed, 844 skipped, 4 erreurs non gérées ; 78 fichiers échoués. Inventaire nominatif de chaque non-exécution disponible. |
| B3 — Chromium et E2E | **BLOQUÉ** | Vraie commande Playwright avec vrai serveur Next de test : 0 passé, 54 échecs avant lancement du navigateur, 90 ignorés ; exit1. |
| B4 — Budget JS sans relèvement | **RÉSOLU** sur mesure comparative | 3 632 537 → **3 609 457 octets**, plafond inchangé **3 625 984**. Gain **23 080**, marge **16 527**. Le build standard reste distinctement bloqué en B1. |
| B5 — Revue sémantique exhaustive | **PARTIELLEMENT VALIDÉ** | Registre de 1 243 fichiers : 32 entièrement relus comme sources, 11 partiellement, 1 200 en attente. Aucune certification exhaustive. |

**Lecture des preuves :** un statut runner, une lecture de source, une configuration YAML, une mesure de bundle et une exécution fonctionnelle réelle ne sont pas interchangeables. Les statuts de la matrice portent sur l’exigence bornée décrite. Un fichier entièrement relu n’est pas un produit fonctionnel entièrement validé.

Livrables : [matrice des 21 IDs](ISSUE-MATRIX.md), [données de matrice](issue-matrix.json), [registre par fichier](review-ledger.jsonl), [prochain lot déterministe](review-progress.json), [synthèse des tests](tests-summary.json), [chaque test ignoré](tests-skipped.jsonl), [chaque échec](tests-failed.jsonl), [erreurs de préparation](tests-setup-errors.jsonl), [4 rejets non gérés](tests-unhandled-errors.jsonl), [144 cas E2E](tests-e2e.jsonl). Les JSONL ne prétendent pas être une revue manuelle de chaque scénario ; la criticité y est conservatrice/provisoire et explicitement qualifiée.

## B — Commandes, versions, codes et preuves

Environnement observé : Linux x64, Node **22.22.3**, npm système **10.9.8**, npm épinglé **11.16.0** invoqué explicitement pour les installations et mesures finales ; Python système/venv **3.11.2**. La CI configure Python **3.12**, sans preuve de run distant de cette configuration. Versions de paquets installés (pas preuve de binaires exécutables) : Next **15.5.27**, Prisma **5.22.0**, Electron **41.10.6**, builder **26.15.3**, Vitest **4.1.11**.

Le registre machine [`commands.json`](commands.json) donne les commandes finales, versions, codes et sorties durables. Les commandes contenant des secrets ne sont pas publiées ; aucune valeur de secret n’est nécessaire aux index de preuves.

| Commande / contrôle | Code | Preuve | Ce que cela ne prouve pas |
|---|---:|---|---|
| `npm ci --foreground-scripts --no-fund`, npm11.16, copie propre | 1 | [normal-ci.log](evidence/normal-ci.log), [snapshot et hashes](evidence/clean-install-source.json) | Installation native réussie ; snapshot antérieur aux derniers ajustements tests/CI, aucune seconde installation complète finale validée |
| Installation JS `ci --ignore-scripts` diagnostique | 0 | [ci-js.log](evidence/ci-js.log) | Exécution des hooks ou présence des natifs |
| `npm run lint` / `npm run type-check` | 0 / 0 | [lint.log](evidence/lint.log), [type-check.log](evidence/type-check.log) | DB/native/browser/Windows fonctionnels |
| `npm run test:config` | 0 | [config.log](evidence/config.log), **49/49** | Authentification/configuration réelle de fournisseurs externes ; ces tests incluent des doubles de test |
| `npm run test:audit` | 0 | [security.log](evidence/security.log), **9/9** | Absence universelle de vulnérabilités |
| `npm run test:release-safety` | 0 | [release-safety.log](evidence/release-safety.log), **27/27**, 0skip | Packaging natif ou runtime Electron réellement démarré |
| Trois fichiers Vitest de confirmation ciblée | 0 | [confirmation-targeted.log](evidence/confirmation-targeted.log), **8/8** | Suite globale réussie |
| Suite Vitest complète, deux workers, reporters texte/JSON | 1 | [résultat final](evidence/vitest-latest.json), [log final](evidence/vitest-latest.log) | Tests empêchés par les hooks réellement exécutés |
| `npm audit --json`, `npm ls --all`, `npm run audit:strict` | 0 chacun | [audit](evidence/npm-audit.json), [arbre](evidence/npm-ls.log), [porte stricte](evidence/audit-strict.log) | Compatibilité comportementale des dépendances ou sécurité des services |
| `npm run check:consistency` | 0 | [consistency.log](evidence/consistency.log) | Les deux comparaisons externes de clé : elles annoncent **NON EXÉCUTÉ** |
| `npm run build`, `npm run dist` existant | 1 chacun | [build](evidence/normal-build.log), [dist](evidence/normal-dist.log) | Paquet ou installateur produits : arrêt dans `prisma generate` |
| Budget avant / après | 1 / 0 | [avant](evidence/budget-before.log), [après](evidence/budget-after.log), [mesures](evidence/bundle.json) | Réussite du lifecycle normal : les deux Next directs contiennent une erreur Prisma malgré exit0 |
| Install PyPI isolée `--require-hashes --only-binary=:all:` | 0 | [python-install.log](evidence/python-install.log), [provenance](evidence/python-dependencies.json) | Attestation de l’autorité réelle de licence, ni audit Python universel |
| Keygen Python réel + intégrité ciblée locale | 0 | [keygen-integrity.log](evidence/keygen-integrity.log), **18passed/1skip** | Le seul skip est le paquet réel absent |
| Contrôle d’artefact obligatoire sans paquet | 1 attendu | [artifact-required-negative.log](evidence/artifact-required-negative.log), **11passed/1failed** | Preuve positive sur artefact : seulement refus effectif d’une absence |
| Keygen sans cryptography | 1 attendu | [keygen-missing-negative.log](evidence/keygen-missing-negative.log) | Les anciens retours sans assertion ne sont plus verts |
| Playwright réel, six projets, un worker | 1 | [e2e.json](evidence/e2e.json), [e2e.log](evidence/e2e.log) | Un navigateur a rendu l’application : les 54 lancements échouent avant rendu |
| Téléchargement checksum Gitleaks officiel | 35 | [gitleaks-download.log](evidence/gitleaks-download.log) | Scanner exécuté ; aucun binaire non vérifié n’a été lancé |

Les premières reproductions sont conservées (`vitest.json`, `vitest-final.json`, `vitest-confirmation.json`). Le résultat `vitest-latest.json` porte sur les sources stabilisées après corrections et met à jour les inventaires. Les codes1 des régressions négatives sont attendus pour prouver le refus ; ils ne deviennent pas des preuves positives de livraison.

## C — Sécurité, dépendances, clés et CI

### Dépendances

L’audit npm réel donne **0 info, 0 low, 0 moderate, 0 high, 0 critical, total0**, sur l’arbre complet ; aucune indisponibilité de registre n’est présentée comme un zéro. Les tests de politique rejettent gravités et réponses invalides ; aucun seuil relevé ni `--omit=dev` introduit. Le fork MIT `braces-bounded` préexistant et ses régressions sont conservés : ses correctifs bornés ne dispensent pas d’un suivi explicite de l’advisory upstream, car le scanner ne lui associe pas automatiquement toutes les alertes du paquet original. Le zéro npm ne valide pas le binaire Electron, les fuses, l’interopérabilité NextAuth/Nodemailer10, ni les flux SMTP/IA/licence réels.

Les avertissements de dépréciation (notamment ESLint8, glob7, inflight et anciennes branches rimraf) restent visibles dans le log d’installation : zéro alerte npm connue ne supprime pas cette dette de support.

Python : `cryptography==50.0.2`, `cffi==2.1.1`, `pycparser==3.11`, dépendances de tests installées dans un venv isolé, **161 hashes** de distributions collectés depuis les métadonnées officielles PyPI. Les wheels réellement installées sont vérifiées `--require-hashes`. Les métadonnées PyPI consultées ne signalent pas d’alerte pour ces versions ; ce constat n’est pas un scan complet de toute la chaîne Python/OS.

### Secrets et autorité

- Gitleaks n’a **pas** été exécuté localement : le téléchargement officiel échoue sur sa redirection CDN. La CI vérifie maintenant le SHA-256 officiel avant extraction. Aucun contournement TLS, miroir inconnu ou exécutable non vérifié utilisé.
- Les exemptions intégrales `auth-secret.ts`, `health/route.ts` et `.*public-key.ts` ont été retirées. Le test de politique passe ; le scan réel et le traitement des faux positifs éventuels restent nécessaires.
- `keys/public.pem` demeure absent dans le dépôt de travail. Les deux commandes conditionnelles de comparaison terminent0 mais annoncent clairement **NON EXÉCUTÉ**. L’outil ajouté peut restaurer **seulement l’ancre publique existante**, exclusivement et sans écraser un fichier divergent. Il n’a été exercé que dans ses fixtures, pas dans les vrais `keys/`.
- Accord des ancres embarquées ≠ attestation indépendante de l’émetteur. La preuve Python utilise une paire éphémère de test, avec injection de sa clé publique dans le vérificateur Node : elle ne signe pas avec la clé de production et ne remplace pas les neuf cas externes non exécutés. Aucune rotation effectuée.

### CI : source durcie, efficacité distante non attestée

Actions officielles épinglées par SHA40, droits par défaut `contents: read`, CodeQL `security-events: write` limité à son job. `Required validation` dépend de **six** jobs obligatoires ; sa commande Bash réellement testée refuse chaque état failure/cancelled/skipped (**18 cas**) et accepte le succès intégral. Pas de `continue-on-error` sur ces portes.

Le nouveau job Windows exige build/dist, budget, inspections existantes et cas d’intégrité réel sous `GF_REQUIRE_ARTIFACT_TEST=1`. Il ne publie rien et n’exige pas de clé privée de signature. Cela ne démontre pas un démarrage Windows ou une signature Authenticode.

Le nouveau job authentifié requiert un environnement `e2e-staging`, une cible HTTPS distincte des quatre hôtes productifs connus, des fixtures et l’approbation non-production explicite. Les entrées manquantes font échouer la porte au lieu de laisser les seuls tests publics donner une fausse validation globale. Le validateur est testé sans réseau avec entrées synthétiques. **Aucun environnement distant n’a été créé/configuré, aucune fixture ni licence distante émise/activée.** La variable d’approbation et le contrôle d’URL ne prouvent pas l’isolation réelle du backend : celle-ci doit être attestée avant toute exécution autorisée. Les traces/sessions authentifiées ne sont pas uploadées.

Les nouvelles métadonnées E2E sont déclarées `test-only`, non gérées automatiquement en production, et la documentation canonique a été régénérée sans valeur de secret. Une erreur YAML de scalar contenant `:all:` puis l’absence de déclaration des deux variables ont été **détectées par les vrais contrôles**, corrigées sans affaiblir les gardes, puis rejouées : preuves négatives conservées dans `ci-parser-negative.log` et `env-contract-negative.log`.

Lectures GitHub seules : protection `main` **403**, alertes CodeQL **403**, rulesets **200 `[]`**. Une réponse403 ne signifie ni absence de protection ni zéro alerte. Aucune configuration distante modifiée ; aucun nouveau workflow exécuté. Publication SARIF réussie ne prouve pas blocage des alertes. [FUP008/015](ISSUE-MATRIX.md).

## D — Tests, Prisma, E2E et compatibilité

### Décompte final et inventaire individuel

Suite Vitest : **3 742 tests**, **2 895 passed**, **3 failed**, **844 skipped**, **4 erreurs non gérées**. Fichiers : **323**, dont **240 passés**, **78 échoués**, **5 explicitement ignorés**. Parmi les fichiers échoués, **77** n’exécutent aucun corps après leur erreur de préparation ; ils ne doivent pas être additionnés aux cinq suites volontairement ignorées comme si l’exclusion était intentionnelle.

| Motif des 844 statuts skipped | Nombre | Statut d’audit |
|---|---:|---|
| Corps empêchés par échec des hooks Prisma | 808 | **NON EXÉCUTÉ**, pas des exclusions déclarées |
| PostgreSQL isolé absent | 21 | **BLOQUÉ** |
| Redis isolé absent | 5 | **BLOQUÉ** |
| Comparaisons externes public.pem | 2 | **BLOQUÉ** |
| Cas nécessitant clé émettrice sur poste autorisé | 5 | **BLOQUÉ** |
| Cas nécessitant un jeton réellement émis | 2 | **BLOQUÉ** |
| Paquet Windows réel absent | 1 | **BLOQUÉ**, obligatoire en job Windows |

Chaque nom, fichier, motif, priorité conservatrice, prérequis et référence JSON est dans `tests-skipped.jsonl`. L’inventaire est exhaustif pour les statuts de **ce run**, pas une revue métier humaine achevée des 844 scénarios. Aucun skip critique n’est compté comme succès ni déclaré acceptable pour livrer.

Les **trois assertions individuellement échouées**, toutes dans `src/test-utils/__tests__/prepare-test-db.test.ts`, sont :

1. « produit une base exploitable, et le modèle porte l’empreinte du schéma » ;
2. « le second appel réutilise le modèle au lieu de reconstruire » ;
3. « une base déjà présente est REMPLACÉE, jamais réutilisée telle quelle ».

Pour chacune, le stderr désormais conservé montre la récupération échouée de `libquery_engine.so.node.gz.sha256` officielle. Les trois corps ne démontrent donc pas une violation de leur propriété métier : leur setup échoue avant preuve. Les 76 autres messages `db push` et le fichier `tenant-isolation` (moteur runtime absent) sont indexés individuellement. Les quatre rejets non gérés sont attribués par Vitest à `publication-mise-a-jour`, `license-devices-unit`, `mechanic-admin` et `audit-v21-fixes`. Ces mentions indiquent l’origine rapportée par le runner, pas une preuve que chaque rejet vient précisément d’une ligne d’assertion de ce fichier.

**Confiance élevée** sur la cause immédiate réseau/moteur absent ; **aucune affirmation** que toutes les assertions actuellement empêchées passeront une fois le natif disponible. De nouveaux défauts métier peuvent alors apparaître. Les vrais clients générés officiellement pour diagnostic ne contiennent pas de moteur fabriqué ; leurs types utilisables ne constituent pas une preuve de requêtes Prisma fonctionnelles.

### Faux verts supprimés

La reproduction précédente comptait **2 896 passed** mais incluait **sept tests Python sans assertion** et **un test artefact sans vérification**. Le premier groupe exécute maintenant réellement `keygen_core.py` après installation vérifiée, et passe ses sept cas. Le second n’est plus faussement vert : l’absence est explicite localement et fait échouer le contrôle obligatoire de packaging. Le passage de843 à844 skips ne masque pas un échec : il révèle un ancien contrôle non exécuté, tout en ajoutant une porte obligatoire qui refuse réellement cette absence.

### Navigateur et environnements

Playwright : **144** cas inventoriés individuellement, **0** passé, **54** échecs avant `browserType.launch` (headless shell absent), **90** exclus par manque de fixtures authentifiées. Le serveur Next a servi la route de préparation, mais cela ne prouve pas le rendu. Certaines specs existantes simulent des réponses API ; même exécutées sous vrai Chromium, elles ne remplaceraient pas les transactions DB réelles. Les projets iPhone/iPad sont des viewport/user-agent Chromium, **pas Safari/WebKit matériel réel**.

Pas de PostgreSQL, Redis ou Docker disponibles localement selon découverte d’exécutables ; aucune connexion de substitution à la production. Windows, démarrage Electron, restaurations/migrations réelles, mises à jour signées, proxies, SMTP/IA/services de configuration externes restent non validés. Les tests unitaires/mocks ne sont pas présentés comme ces preuves.

## E — Installation, build, budget, package et artefacts

### Téléchargements et alternatives effectivement essayées

Téléchargements officiels Electron/Prisma/Chromium exécutés ; tentative avec CA système pour distinguer la chaîne de certificats du reste du problème. L’accès API GitHub fonctionne avec CA système, mais les actifs/checksums natifs restent inaccessibles. Vérification des releases officielles Prisma via API : pas d’actif de moteur récupérable par cette voie. Gitleaks : redirection officielle vers `release-assets.githubusercontent.com`, erreur SSL35. Aucun moteur alternatif inconnu, TLS désactivé ou faux runtime utilisé.

Ces éléments établissent un **blocage de cet environnement**, pas une impossibilité universelle ou une preuve que toute alternative officielle imaginable a été épuisée. La reprise requiert un runner autorisé à récupérer les binaires officiels et leurs données d’intégrité, ou un approvisionnement officiel approuvé vérifié. Répéter les mêmes URLs sans changement de prérequis n’ajouterait pas de preuve utile.

### Budget : correction effective et bornée

Transformation de représentation seulement : **562 clés**, **14 langues**, deux rangées uniformes. L’empreinte JSON complète reste `297db557405e6b7a465994970bcaa18a818d6dd25ea60cb65afa8cc55ad4def3`. Aucun contenu ni fonctionnalité retiré. Source allégée de22 781 octets ; JS émis allégé de23 080. La [comparaison des objets transpilés](evidence/ui-compaction.json) confirme aussi que le snapshot avant correspond exactement au source conservé dans Git HEAD ; aucun journal de delta par chunk individuel n’a été capturé. **237 fichiers JS**, plus gros chunk **322,3 KiB**, seuil individuel **524 288 octets** et total **3 625 984** inchangés.

Les deux compilations Next directes ont réellement émis les bundles, mais chacune contient `PrismaClientInitializationError` malgré exit0. Ce sont des mesures comparatives de sortie JS, **pas deux builds standards validés**. Le serveur dev E2E a ensuite réutilisé `.next` ; les logs/mesures avant-après restent les preuves datées, et il faut reconstruire proprement avant une mesure de livraison.

### Corrections de sûreté indépendantes des téléchargements

- **FUP006** : ressources Prisma limitées au schéma et au modèle vide ; pas de fallback vers `dev.db`/DB client, pas de reset ; refus des données applicatives et des DB périmées de sortie. Le vrai modèle commité donne **43 tables applicatives sans ligne**, copie lisible, source SHA-256 identique avant/après : `2434c43f0333a3be258a88157cd60109fcc10cc7857fb177c95e5bd8aff2c757`.
- **FUP010** : l’ancien bootstrap supprimait le répertoire historique même lorsque la copie exclusive échouait parce qu’une DB canonique existait. Reproduction originale : exit0 et disparition de la DB historique/fichier tiers. La version corrigée conserve les deux ; quatre tests réels dont bootstrap isolé passent.
- **FUP019** : les seules vérifications des fichiers sources ne refusaient pas leurs parents/jonctions ou ceux des sorties. Deux régressions réelles démontrent le défaut avant ; la chaîne de composants est maintenant contrôlée. Pas de garantie atomique contre un écrivain filesystem hostile simultané : le workspace doit rester contrôlé.
- **FUP011** : neuf désabonnements Electron supprimaient les listeners des autres consommateurs. Neuf régressions échouent avant et passent après. Preuve EventEmitter/VM, pas runtime Electron.
- Erreurs de manifeste du post-build propagées. Les copies/purges génériques restantes ne sont pas assimilées au helper Prisma sécurisé ; la purge privée initiale best-effort/4KiB ne remplace jamais l’inspection finale du paquet réel.

**Aucun installateur Windows, paquet final, contrôle réel de fuses ou lancement de l’application empaquetée n’est validé ici.** `npm run dist` a bien été tenté, et échoue avant ces étapes. La configuration du job candidat n’est pas une preuve de résultat.

## F — Revue manuelle, risques résiduels et reprise exacte

### Couverture réelle

`review-ledger.jsonl` contient chaque fichier du périmètre Git suivi/non ignoré, SHA-256, ordre/priorité déterministes, statut manuel, plages lues et observations. **32** fichiers entièrement relus comme sources comprennent les helpers d’auth/contexte, les corrections FS/packaging, le preload, les workflows et leurs régressions. **11** sont partiellement relus ; **1 200** restent en attente. Les sorties de ce suivi et inventaires auto-référents sont exclues de ce périmètre produit ; dépendances/caches/clients générés/fichiers locaux sensibles restent hors registre Git mais l’arbre de dépendances est inclus dans npm audit.

La lecture intégrale du source ne certifie pas les dépendances transitives, permissions de toutes les routes ou runtime. `withAuth`/`withMechanic` ne remplacent pas l’appel de leurs gardes par chaque handler ; la matrice de toutes les routes reste à terminer. Les schémas **43/47 modèles** sont inventoriés, pas intégralement audités modèle/relation par modèle. `electron/main.js` n’est revu qu’aux plages indiquées, et la politique `senderFrame` reste une hypothèse de durcissement à examiner, **pas une exploitation démontrée**. Le composant WorkOrder n’a été lu qu’en partie ; le cas `getContext('2d')` nul doit être éprouvé sous navigateur.

Le classement de criticité des tests non exécutés est volontairement conservateur, pas une adjudication métier humaine complète. Aucun engagement d’absence absolue de défaut, de vulnérabilité ou de régression.

### Reprise nécessaire, sans production ni récupération manuelle de secrets

1. **Réseau/binaries officiels** : sur runner autorisé, Node22 compatible et npm11.16, exécuter `npm ci` normal, puis `npm run db:desktop:generate` et `npm run db:server:generate`. Vérifier TLS/intégrité et les vrais fichiers moteur, sans `--ignore-scripts` comme substitution finale.
2. **Tests isolés** : installer les dépendances de tests Python via `python -m pip install --require-hashes --only-binary=:all: -r tests/requirements-keygen.txt`. Faire provisionner PostgreSQL/Redis jetables par la CI/configuration autorisée, jamais une DB existante de production ; exécuter les migrations vides, les trois cas de préparation, puis `npm test -- --maxWorkers=2` avec rapports texte/JSON et les tests Node. Reclasser individuellement tout échec révélé.
3. **Navigateur** : `npx playwright install --with-deps chromium`, puis `npm run test:e2e`. Le harness conservé permet la tentative publique sans création de secret local, avec une copie de modèle SQLite appartenant au test. Pour l’authentifié, authentifier les accès autorisés et laisser la configuration provisionner/récupérer les paramètres de recette ; attester l’isolation réelle de `e2e-staging` avant autorisation. Ne saisir/transmettre aucun secret dans le chat, ne consommer aucune licence productive.
4. **Build/distribution** : `npm run build`, `npm run check:perf-budget`, puis sur Windows `npm run dist`, contrôles secrets/fuses/manifeste et `GF_REQUIRE_ARTIFACT_TEST=1` pour le fichier Vitest d’intégrité. Examiner ensuite démarrage, DB vierge/migration/restauration, chemins/proxy et mise à jour signée sur poste de recette. Aucun publish/deploy implicite.
5. **Autorité et sécurité distante** : via les accès autorisés, attester l’ancre publique émettrice et les tests nécessitant signature sur poste de signature, sans déplacer la clé privée ; obtenir lecture des protections/alertes, exécuter Gitleaks/CodeQL, traiter les résultats et vérifier les checks effectivement requis. Les autorisations et une éventuelle publication de branche doivent être explicites ; aucune protection n’a été changée ici.
6. **Revue** : reprendre le prochain lot de `review-progress.json`, comparer les hashes avant chaque revue, traiter tous P0 puis P1/P2, consigner observations et tests. Ne régénérer une baseline canonique de livraison qu’à partir d’une validation complète réellement acquise.

Les IDs stables, causes, corrections, confiance, preuves favorables/limites et prérequis restants figurent dans [`issue-matrix.json`](issue-matrix.json). **Aucun de ces blocages n’est levé par une simple rédaction de ce rapport.**
