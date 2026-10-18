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
