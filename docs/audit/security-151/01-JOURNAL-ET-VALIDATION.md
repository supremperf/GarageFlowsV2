<!-- doc-numbers: journal -->
# Journal de correction et validation — sécurité 151

## État initial conservé

L’[inventaire préalable](00-INVENTAIRE-AVANT-CORRECTION.md) a été créé avant les patchs applicatifs de cette mission. Sources et compteurs npm/main/candidat/GitHub séparés ; aucun avis ni protection désactivé. Les fixes de versions préexistaient sur la branche candidate, pas sur main.

## Corrections effectuées

### SEC151-S01 — relation de catalogue multi-garage

`GET /api/parts?repairType=...` borne maintenant **l’association et la pièce incluse** par le garage de la session : `where: { repairType, garageId, part: { garageId } }`. Une référence historique/importée incohérente ne suffit plus à servir une pièce étrangère. Aucun paramètre `garageId` client n’est utilisé et aucune donnée existante n’est modifiée.

### SEC151-S02 — pagination avant Prisma

Le même GET utilise `parsePagination(searchParams, 5000, 5000)` : cap/défaut 5000 conservés, pagination entière normale inchangée ; fractions/NaN/Infinity/formats partiels/dépassement offset → HTTP400 `INVALID_PAGINATION` avant DB. Pas de changement d’écran, de droits ou de règles monétaires.

**Reproduction avant patch :** nouveau test du vrai handler, sessions/DB simulées pour deux garages : **3 réussis, 12 échoués**, exit1, [rapport](parts-before.json). **Après patch : 15/15**, puis **30/30** avec contrats pagination/API existants, exit0, [rapport](parts-after.json). Ce sont des tests de frontière mockés, pas une preuve DB native.

### SEC151-S03 — non-régression des critiques reliée au CI obligatoire

Quatre tests Node ajoutés : toutes les instances installées/verrouillées de Next et tar satisfont les lignes corrigées, cohérence avec le tar effectivement résolu par app-builder-lib, vraie décompression tar bornée refusée et archive normale acceptée. Fixture de 34 KiB, aucune bombe volumineuse/extraction disque. [Résultat 4/4](critical-tests.txt).

`npm run test:audit` conserve les tests existants, sa mémoire/son timeout et ajoute ce fichier : **13/13 initialement**, puis **20/20** après ajout des sept tests du contrôleur REST, [sortie](dependency-security-tests.txt). Le job `dependency-security` existant l’exécute déjà ; aucune exception de gravité ni allowlist d’alerte ajoutée. Les seuils de version de ces régressions ne remplacent pas `npm audit` et doivent être revus lors d’un changement majeur futur.

**package-lock.json inchangé** : pas de dépendance ajoutée/supprimée/mise à jour à tort pour afficher du vert ; le changement de package.json est uniquement le branchement du nouveau test de sécurité. Les versions critiques du candidat étaient déjà corrigées avant cette mission.

### SEC151-T01 — véritables échecs natifs de la CI précédente

La CI GitHub du commit publié **1aa860d**, run [39069952485](https://github.com/supremperf/GarageFlowsV2/actions/runs/39069952485), était en échec. Ses jobs dépendances, build/budget natif, Gitleaks et E2E publics avaient réussi, mais le job tests avait échoué ; Windows et E2E authentifiés étaient donc skipped. Ces succès partiels **ne sont pas ceux du nouveau candidat**.

Preuves : [jobs du commit précédent](previous-ci-jobs.json), [annotations accessibles](previous-ci-annotations.json). Dix échecs nommés visibles concernent PostgreSQL appareils et republication portail. Le téléchargement du log complet a échoué (exit1, zéro octet) ; les dix annotations ne sont pas présentées comme l’intégralité des erreurs du run.

Examen des fixtures : `createLicense` PostgreSQL et la licence de republication SQLite étaient écrites **sans recordMac**, alors que `validateDeviceToken` / `authenticateGarageLicense` exigent une intégrité exploitable. Les changements de statut/expiration de fixtures ne recalculaient pas non plus le MAC. Cela explique le refus de ces enregistrements au contrôle actuel ; ce n’est pas une preuve de panne d’infrastructure ni d’innocence de toutes les suites natives.

Corrections **uniquement de fixtures** : MAC réel calculé par `computeRecordMac`, transitions légitimes simulées avec MAC recalculé ; ni mock d’intégrité ni rescellement du code produit. Ajout de **trois cas négatifs** : MAC supprimé → refus sans réparation silencieuse, statut changé sans MAC → refus intégrité, publication portail sans MAC → 403 et zéro snapshot. Tous les tests de concurrence/révocation/publication existants sont maintenus. **Validation native attendue en CI**, non remplacée par une affirmation de succès local.

## Mesures locales finales

| Commande / périmètre | Résultat |
|---|---|
| `npm ci` avec npm 11.16.0 et hooks normaux | **Exit1** pendant installation Electron : `FetchDownloader.download` / `TypeError: fetch failed`. [Sortie conservée](install-standard-failure.txt). Pas une installation native réussie. |
| Installation de travail sans hooks, npm épinglé | Exit0, [sortie](install-pinned-no-hooks.txt). Clients Prisma générés `--no-engine` pour typage/mocks seulement, sans prétention SQL. |
| `npm audit --json`, npm 11.16.0 | **0 faible/modérée/élevée/critique**, [rapport](candidate-npm11-audit.json). Le fork local reste un périmètre manuel explicite. |
| `npm ls --all` | Exit0 ; [candidat](candidate-tree-before.json), [main isolée](main-tree-before.json). Des paquets optionnels d’autres plateformes peuvent être seulement verrouillés, pas exécutés. |
| `npm outdated` | 32 paquets ; [rapport](outdated-before.json). Dépréciations ESLint8, inflight, glob7, rimraf : dette de maintenance signalée, non assimilée à des CVE nouvelles. Aucune migration majeure aveugle. |
| Référentiel PyPI versionné de test | cryptography50.0.2/cffi2.1.1/pycparser3.11 : aucune vulnérabilité retournée par les métadonnées de ces releases, [réponses neutralisées](python-advisories.json). Pas un audit du runtime Python de production. |
| `npm run lint` / `npm run typecheck` | **Exit0 / 0**, [lint](lint.txt), [types](types.txt). Une première commande groupée a expiré au délai de l’outil ; le typecheck a été relancé seul et son exit0 confirmé, pas déduit d’une sortie tronquée. |
| `node --test tests/*.test.cjs` | **387/387**, aucun skip/todo, [sortie](node-tests.txt). |
| Globale Vitest finale | **4 222 total / 3 368 réussis / 3 échoués / 851 pending**, 347 fichiers, **79** en échec/empêchés d’aboutir. [Commandes, messages et stacks](local-global-failures.json). Les trois assertions prepare-test-db échouent avant métier sur TLS Prisma ; 851 inclut les nouveaux cas natifs non exécutés ici. Aucun cas retiré/masqué pour améliorer les chiffres. |
| `npm run build` | **Exit1 avant Next**, récupération du moteur Prisma/TLS ; [sortie complète](build-failure.txt). Le build CI précédent réussi ne certifie pas ce candidat. |
| `npm run check:consistency` | Exit0 ; deux vérifications PEM émetteur restent explicitement SKIP faute de clé publique officielle. Baseline machine régénérée depuis la globale rouge réelle, pas depuis les seuls tests ciblés. |

Les guards de sécurité et tests en erreur ne sont pas neutralisés. Les warnings SQLite expérimental et les Actions déclarant Node20 (désormais forcées sur Node24 par GitHub) restent signalés. Les versions d’outils n’équivalent pas à un audit des binaires Vercel/Electron réellement déployés.

## Reste ouvert et risque d’intégration

- Export des 151 alertes REST / mapping des IDs initiaux → résolus/nouveaux, et confirmation après intégration sur main.
- CI native du nouveau commit et recette Windows/authentifiée avec environnement non-production approuvé ; aucune suppression du gate obligatoire pour obtenir un vert.
- O01 : source de coûts serveur + projection par rôle + UI/documents/transactions. La suppression isolée des champs de catalogue ferait perdre des snapshots d’achat : correctif à concevoir/retester ensemble, pas de retour artificiel `0` à la place d’un coût caché.
- O02 : IAM humain/MFA/audit durable et protocole de diagnostic sans oracle de secret ; migration de procédure opérateur nécessaire, pas de réouverture d’endpoint retiré.
- Tous les chemins tenant/CSRF/SSRF/XSS/SQL/IA, revue du fork upstream, historique de secrets et contenu des artefacts : audit sémantique/exploitation non certifié intégralement. Pas de conclusion « zéro faille de code ».
- La branche publiée contient déjà **2181 fichiers différents de main et environ 1,17 million de lignes ajoutées**, majoritairement preuves mais aussi fonctions/migrations préexistantes. Une intégration globale n’est pas un simple bump de deux versions. Préparer une **PR brouillon**, ne pas fusionner un candidat rouge ni provoquer un déploiement production non validé. Travail maintenu sur la branche de session imposée, pas de branche alternative.

**Mission NON TERMINÉE — NO-GO**, même si npm affiche zéro. Aucun secret ni données production consultés, aucune migration/rotation/déploiement production effectués.

## Complément GitHub — preuves réelles du commit 7ff1a6e

La CI [39133705536](https://github.com/supremperf/GarageFlowsV2/actions/runs/39133705536), sur **7ff1a6ecc4b88fdb779de62af21cdb1d32930888**, est terminée. Réussites : installation/génération natives, PostgreSQL migrations sur DB neuve, types/lint, suite standard SQLite/PostgreSQL/Redis, build et budget, audit complet des dépendances, Gitleaks, E2E publics, **packaging/inspection Windows**. [Jobs](candidate-ci-7ff1a6e.json), [étapes natives](candidate-native-steps.json). Les fixtures T01 ont donc été réellement exécutées avec succès, pas simplement considérées corrigées par lecture. Les logs complets n’ont pas été téléchargés : aucun nombre de tests CI non fourni par ces métadonnées n’est inventé.

Échecs restants : précontrôle `Require explicitly approved non-production test target and fixtures` du job E2E authentifié ; `Required validation` refuse ensuite le job manquant. Les tests authentifiés ne sont pas atteints. Les annotations ne disent pas quel champ/quelle valeur a échoué : ne pas prétendre savoir si c’est URL, fixture ou approbation. [Étapes et annotations](candidate-ci-failures.json). Pas de flag forcé ni de skip ajouté. Le release gate manuel complet reste skipped par son événement, pas « réussi ».

**Autre contrôle bloquant découvert :** l’étape CodeQL d’analyse/upload réussit, mais le contrôle de résultats **CodeQL échoue avec 19 alertes PR (11 high, 8 medium)**. Il serait faux de confondre ces deux statuts. [Résumé officiel](codeql-pr-check-7ff1a6e.json), [19 annotations](codeql-pr-annotations-7ff1a6e.json). Le transport de projection SARIF existant donne **20 résultats complets** (un résultat supplémentaire n’est pas « nouveau » pour la PR), avec règles/scores et chemins source→sink, sans snippets/secrets : [métadonnées complètes](codeql-flow-inventory-7ff1a6e.json). Ce périmètre est distinct des 151 Dependabot.

L’API Code Scanning refuse elle aussi HTTP403 ; les annotations et la projection ont permis de récupérer ces éléments, **pas** de certifier l’absence de toute autre alerte sur toutes les branches. [Accès](code-scanning-access.json).

## Qualification des résultats SAST — aucune suppression

[Registre de revue par résultat](codeql-triage.json) : 9 motifs TOCTOU dans outils/tests/collecteurs, hash de détection de secrets compromis, échappement dotenv, 7 flux fichier/réseau et un no-op de test, plus le modulo du générateur de codes secours. Les niveaux sont ceux de CodeQL, pas des CVE npm inventés. Exploitabilité/contexte et correction des cas réellement vulnérables doivent être établis avant clôture ; pas de blanket « faux positifs ».

- Le SHA-256 de `config-credentials` compare des empreintes de secrets **déjà compromis** afin de les refuser. Ce n’est pas un hash de mot de passe d’authentification. Un remplacement aveugle par bcrypt/scrypt casserait cette détection ; les fingerprints de diagnostic exposés restent, eux, un sujet distinct O02.
- `encodeValue` choisit d’abord le type de guillemet, refuse certaines combinaisons et contrôle le parsing dotenv ; le `replace` seul ne suffit pas à qualifier une injection. Le protocole doit rester compatible avec les vrais parseurs et les secrets existants.
- Les flux réseau/fichier comprennent la synchronisation métier voulue, la configuration autorisée, le journal redacté et l’état licence signé ; il faut vérifier destination/auth/redirects, chemins, bornes et minimisation **sans supprimer la fonctionnalité** pour faire disparaître l’alerte.
- Le modulo du générateur secours utilise un alphabet **constant de 32 symboles** : 256 est divisible par 32, chaque symbole a 8 antécédents parmi les octets uniformes. **Pas de biais modulo démontré pour cet alphabet** ; [preuve mathématique et hash du source](codeql-backup-rng-analysis.json). Cela ne certifie pas l’entropie totale, le stockage ou toute la 2FA. Aucun RNG remplacé arbitrairement pour changer un compteur d’alertes.

## Contrôleur GitHub fail-closed ajouté

`scripts/check-github-security.cjs` utilise REST paginé, vérifie forme/IDs/sévérités, compare le HEAD par défaut avant/après et ne fait aucun fallback GraphQL. HTTP403, réponse invalide/tronquée, doublon ou changement de HEAD → `count:null`, échec ; jamais zéro. Même un REST vide validé reste un **snapshot**, `scanFreshnessVerified:false`, `missionComplete:false` : délai de scan, intégration et fonctionnalité exigent d’autres preuves. Aucune écriture/mutation/dismissal sur GitHub.

Sept tests offline ajoutés et branchés dans `test:audit` (20/20) ; suite Node complète **387/387**. Exécution réelle de l’outil : [HTTP403, count null](github-rest-check.json), exit1 attendu. Le nouveau contrôleur et ces mises à jour documentaires sont postérieurs à la CI 7ff1a6e : **ne pas attribuer les checks de cet ancien SHA au prochain commit**. Les contrôles se relancent sur chaque push.

Node local 22.22.3, distribution npm Node22 la plus récente observée 22.23.3 : identité/patchs du runtime de production non vérifiés. Warnings Actions Node20 forcées sur Node24, CodeQL v3 déprécié en décembre, migration ubuntu-latest annoncée : dette d’outillage signalée, aucune preuve de zéro CVE runtime/Actions par le seul audit npm.

**Conclusion actualisée : NO-GO maintenu.** Dépendances corrigées sur le candidat mais main non intégrée ; E2E authentifié/contrôle requis et résultats CodeQL bloquants ; lecture des 151 alertes refusée ; O01/O02 et revue sémantique complète ouvertes. Pas de fusion ni publication production.
