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
