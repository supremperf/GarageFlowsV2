<!-- doc-numbers: journal -->
# Reprise après livraison du candidat Windows

## Relevé avant modifications

Départ : HEAD69684ac, branche arena/55edbdc1-garageflowsv2, arbre propre. PR11 brouillon/UNSTABLE. Les nouveaux checks types/lint/tests natifs/build/audit/Gitleaks/public-E2E ont réussi. Les deux recettes Windows du dernier SHA sont encore en cours au relevé ; leur résultat ne doit pas être remplacé par celui du précédent5a10e96.

Le check de résultats CodeQL117729570654 contient19alertes (10high/9medium), malgré le succès du job d’analyse. Les motifs TOCTOU restants concernent standalone-layout, un test de stockage et six scripts de collecte/commandes historiques. Les autres résultats (hash de détection de secrets compromis, échappement dotenv, flux réseau/fichier voulus ou à qualifier) ne sont pas présumés corrigés.

E2E authentifié : échec du précontrôle de cible/fixtures non-production approuvées. L’API de métadonnées des secrets du staging retourne encore HTTP403. Aucun secret ni cible de production ne sera inventé pour passer ce gate. Authenticode, recette métier avec licence réelle et PC d’usine restent non attestés. Aucun merge/déploiement prévu.

## Plan limité et raisons techniques

1. Lectures : ouvrir une fois, vérifier le fichier par fstat du descripteur et lire ce même objet ; borne réelle sur les lectures de marqueurs compilés. Les collecteurs ne doivent plus faire stat(path) puis read(path). Les liens d’inventaire seront lus comme liens, pas suivis vers d’éventuelles données hors dépôt ; cette convention future sera distinguée des snapshots historiques.
2. Preuves : réserver le nom de sortie par open(wx) avant la commande, écrire au même descripteur et fermer systématiquement. Ne jamais remplacer une preuve créée entre exists() et write(). Les résultats historiques ne seront ni effacés ni régénérés pour faire disparaître les alertes.
3. Test de stockage : la fixture doit elle-même créer le fichier de façon exclusive, sans check-then-write.
4. Rejouer les tests concernés, puis les contrôles existants et les vrais checks CodeQL. Aucune règle/exclusion CodeQL ajoutée, aucun dismissal, pas de garantie « toutes vulnérabilités éliminées ».

Limite de menace : l’identité d’un descripteur n’immobilise pas les octets contre un acteur pouvant écrire dans le même inode. O_NOFOLLOW n’est pas disponible sur toutes les plateformes, et ne protège pas les composants parents. Les workspaces/répertoires de preuve doivent rester contrôlés en permissions ; ne pas prétendre à une sandbox filesystem complète et atomique sur Windows.

## Diagnostic du précontrôle staging, sans changement de politique

L’échec n’était visible en annotations que sous forme « exit1 », et les logs complets ne sont pas récupérables ici. Ajout d’annotations à codes fixes (MISSING_INPUT avec nom autorisé, INVALID_TARGET_URL, UNSAFE_TARGET, NON_PRODUCTION_APPROVAL_REQUIRED). Aucun contenu d’URL, email, mot de passe ou licence n’est publié. Les quatre inputs, HTTPS/non-production/sans credentials et l’approbation explicite restent obligatoires et inchangés ; les tests exécutent le vrai script extrait du workflow, positivement et négativement. Le diagnostic doit permettre de nommer le champ réellement bloquant, pas d’inventer une cible ou de masquer un test non exécuté.

## Complément dotenv — compatibilité vérifiée, pas de changement d’algorithme aveugle

Le remplacement naïf de tous les backslashes changerait les mots de passe/chemins littéraux : l’écrivain choisit d’abord double/single/backtick en fonction des caractères et les trois lecteurs réels ne traitent pas ces quotes pareil. Ajout d’une matrice déterministe de512combinaisons quotes/backslash/dollar/commentaire/espace, comparaison avec le vrai @next/env et parseEnv. Les combinaisons non représentables restent refusées, jamais altérées pour passer.

Défense supplémentaire : les noms importés eux-mêmes sont validés avec **la grammaire existante du parseur dotenv** (`[\w.-]+`), pas une nouvelle règle qui casserait les noms personnalisés pointés/tiretés. Les noms contenant newline/CR/NUL/espaces/`=`/`#`/`$` sont refusés avant émission. Une première tentative trop restrictive et une attente de test sur les quotes ont été détectées par les tests existants/matrice puis corrigées avant commit. Les55tests concernés passent.

Le SHA256 de config-credentials ne peut pas être remplacé globalement par bcrypt : il sert à reconnaître les empreintes de secrets déjà compromis **et** aux comparaisons/reçus de configuration. Ces reçus persistants constituent une revue distincte (oracle hors ligne possible sur des valeurs faibles, permissions/migration à préserver), pas une preuve que tout usage du hash est sûr. Aucun dismiss ni contournement de la détection de secrets compromis.

## Permissions des fichiers privés — défaut distinct reproduit puis corrigé

`writePrivate` changeait les permissions par `chmod(path)` après écriture/renommage. Un chemin remplacé entre ces opérations pouvait faire porter le chmod sur un autre objet ; un échec de permissions arrivait aussi après remplacement de l’ancien fichier. Nouveau chemin : création exclusive0600, écriture **et fchmod du même descripteur**, fermeture puis renommage atomique ; nettoyage uniquement d’un temporaire effectivement réservé par cette invocation. Les liens déjà présents restent refusés, les parents doivent être contrôlés.

Trois nouveaux tests du vrai corps de fonction ont échoué avant patch (3/3), puis passent après : identité du descripteur dans les deux modes et maintien du fichier antérieur sur échec de permissions. Avec les tests configuration/gestionnaire/reconstruction existants :153/153. Les valeurs/chiffrements/clés ne sont pas modifiés, aucun script de configuration réel ni opération fournisseur n’a été exécuté.

## Nettoyage du résultat CodeQL de fixture XML

Le SIRET de fixture faisait `replace(espace, espace)`, sans effet et signalé par js/identity-replacement. Suppression de cette opération redondante seulement ; la chaîne avec espaces reste strictement identique pour continuer à tester la normalisation par le builder. Ce n’est pas présenté comme une correction d’une vulnérabilité exploitable dans le produit.

## Résultats GitHub effectivement obtenus

- Avant :19résultats CodeQL,10high/9medium sur69684ac. Au SHA432df60 :11,2high/9medium. **Les huit motifs TOCTOU ciblés ont disparu du vrai scan** ; aucune exclusion ni règle désactivée/dismissal.
- Au SHA6087458 :10,2high/8medium. Le changement de writer privé regroupe deux sinks réseau→fichier dans une fonction, ce qui réduit aussi le nombre de localisations : **ce n’est pas une preuve d’une vulnérabilité supplémentaire éliminée**.
- Au SHA5e33f90 :**9résultats,2high/7medium**. Le no-op XML supprimé est un nettoyage de test, pas une faille produit corrigée. Les résultats restants ne sont pas déclarés tous faux positifs : hash/reçus, quoting et flux/sinks réseau nécessitent encore qualification/traitement.
- CI6087458 : tests natifs SQLite/PostgreSQL/Redis, types/lint, build/budget, audit complet, Gitleaks, E2E publics et **recette complète d’installation Windows : SUCCESS**. Le staging authentifié et Required validation restent rouges ; release gate manuel skipped, jamais compté PASS.

Preuves : [avant](reprise/codeql-before.json), [après IO](reprise/codeql-after-io.json), [résultat final](reprise/codeql-final.json), [9annotations restantes](reprise/codeql-final-annotations.json), [CI6087458](reprise/ci-windows-6087458.json), [validation structurée](reprise/validation.json).

## Blocage staging maintenant identifié sans conjecture

L’annotation du vrai job117733342402 donne **MISSING_INPUT:BASE_URL**. Dans ce workflow, BASE_URL provient du secret **E2E_STAGING_URL** de l’environnement GitHub `e2e-staging`. La validation navigateur n’est donc pas atteinte. Le constat porte sur la variable vide/non fournie **dans ce job** ; faute de droit de lecture, on ne tranche pas entre secret absent et secret indisponible dans ce contexte. Cela ne prouve ni présence ni absence des autres fixtures/approbations : le précontrôle s’arrête sur le premier manque.

L’inventaire readonly des deployments est accessible, mais les entrées e2e-staging inspectées sont des traces du job en échec, sans environment_url ; **elles ne prouvent pas un serveur de staging existant**. Les métadonnées de secrets et l’API Dependabot refusent encore HTTP403, [preuve](reprise/staging-blocker.json). Pas de cible supposée, pas de valeur de secret lue/écrite, pas de contournement du flag non-production.

Pour lever ce point : un opérateur autorisé doit vérifier les scopes/rendre disponible dans GitHub l’URL réelle HTTPS non-production sous E2E_STAGING_URL, les fixtures dédiées et l’approbation E2E_NON_PRODUCTION=true, puis relancer le workflow sur le SHA exact. **Ne pas transmettre de mot de passe, licence brute, PAT ou clé privée dans le chat ; ne pas utiliser la production comme staging.**

## Nouveau Setup réellement revalidé

[Setup du SHA6087458](https://github.com/supremperf/GarageFlowsV2/actions/runs/39147392047/artifacts/12144411271) — transport ZIP contenant uniquement l’EXE,231058258octets pour **GarageFlows-Setup.exe**,220.4Mio ; SHA256 **88a488bc120149e3d54fc53edb8dd1c0706e13095ceca72049b70a89b5d2a254**. Ce hash remplace uniquement l’identité de ce candidat, pas celle du précédent5a10e96 qui reste documentée dans01.

[Reçu du vrai fichier](reprise/delivery-6087458.json), [installation/relance/réinstallation/désinstallation avec préservation](reprise/windows-smoke-6087458.json), [serveur installé](reprise/installed-server-6087458.json). NotSigned, pas de session métier avec autorité/licence de production, pas de PC physique d’usine sans outils : mêmes limites que le rapport initial. Aucun binaire committé ni release production publiée.

## Validation locale et verdict

**419/419 Node**, **102/102 release-safety**,53ciblés initiaux puis39après compléments,153ciblés de writer/configuration,55dotenv dont matrice512combinaisons et29XML. Types/lint/cohérence/env0, npm audit complet0. Première commande groupée expirée au délai de l’outil : Node achevé419/419, typecheck franchi sous set-e ; lint ensuite rejoué séparément exit0, pas de PASS global inféré de la commande expirée. La globale locale conserve3assertions de préparation Prisma/TLS et79fichiers empêchés, sans test ajouté en skip/retry/timeout élargi.

**NO-GO production maintenu.** Progrès concret source et Windows, mais9résultats CodeQL non clos, URL de staging non fournie au job, accès Dependabot refusé et main annonçant encore151alertes. Aucun merge, déploiement, migration/rotation production ni réécriture des preuves historiques générées.

## Test portail dépendant de l’horloge — qualification et correction sans changer la règle métier

Une revalidation locale au SHA5e33f90 a fait ressortir un quatrième échec, distinct des trois TLS : l’égalité exacte des URLs JWT après republication. Il n’est pas attribué à Prisma. Le handler conserve le jti mais signe une expiration relative rafraîchie ; deux appels dans la même seconde donnaient le même JWT, d’où un ancien vert intermittent. Reproduction déterministe avec Date contrôlée et avance de2secondes :8pass/1fail.

Ne pas geler la durée du lien pour faire passer l’assertion : cela changerait la règle métier de renouvellement. Le test conserve les deux lectures200, vérifie maintenant les **vraies signatures jose**, l’identité jti non vide, garage/intervention/type, la durée7jours et le renouvellement exact2secondes, l’association des URLs aux tokens et l’unicité du snapshot. Il exige explicitement que les URLs diffèrent dans ce cas contrôlé, tout en gardant l’ancien lien utilisable. Résultat9/9, types/lint0. Le handler n’a reçu qu’une correction de commentaire, aucune logique modifiée.

**Limite clarifiée :** le produit préserve l’identité/validité des liens déjà distribués jusqu’à leur propre échéance, pas une URL JWT canonique immuable à chaque republication. Si cette dernière propriété est souhaitée, elle demande une décision de modèle/expiration, pas une modification silencieuse dans cette reprise. Aucun timeout/retry/skip n’a été ajouté au test.

Revalidation finale après le test portail : **4222tests /3370pass/3échecs TLS/849pending**, mêmes79fichiers empêchés, aucun quatrième échec persistant. [Intermédiaire rouge conservé](reprise/intermediate-global-with-portal-failure.json), [finale réelle](reprise/local-global.json), [horloge avant](reprise/portal-before-summary.json)/[après](reprise/portal-after-summary.json). Baseline machine/canonique régénérée uniquement depuis cette globale finale ;24guards docs/baseline passent. Pas de token/URL JWT de fixture exporté dans ces résumés.

## Échec CI d’audit npm distinct, non attribué sans preuve

Au job117738355401 du run39148916382 (SHA1494941), l’étape **npm run audit:strict** échoue. Les autres étapes de ce job avaient été franchies. Localement, les deux audits complets, npm du sandbox et npm11.16.0 épinglé, retournent0vulnérabilité/exit0. Le log CI complet reste inaccessible (exit1/zéro octet), et les annotations n’indiquent que l’exit1 : **ni nouvelle vulnérabilité ni panne réseau précise ne sont déduites** de ce seul élément.

Ajout de diagnostics CI à valeurs contrôlées dans audit-ci : code de sortie, counts entiers s’ils existent, code d’erreur strict, verdict fail-closed. Aucun résumé/détail brut npm, URL ou token n’est exposé. Pas de retry automatique, d’exception de gravité ou de neutralisation du code de sortie. Un test protège ces limites. La prochaine exécution doit être lue ; ce check précédent demeure un échec documenté, pas un vert rétroactif.
