# Publication du suivi de validation — 14 octobre 2026

**VALIDATION PARTIELLE — NON PRÊT POUR LA PRODUCTION.**

Nouvelle publication explicitement autorisée sur la branche existante, sans merge ni déploiement.

## Limite de conservation constatée avant publication

Le manifeste et le rapport gelés du dossier `../validation-f88f283-2026-10-14/` décrivent l’état précédent de 201 preuves. Après restauration de cet environnement, **143 artefacts sont présents et correspondent exactement aux SHA attendus ; 58 journaux `.log` ne sont plus disponibles**. Le manifeste est préservé, pas réécrit pour masquer ces absences. Les JSON de résultats, registres, commandes, rapports et scripts disponibles sont publiés. Aucun journal manquant n’est inventé ou présenté comme disponible.

Le [reçu détaillé](preflight.json) liste chaque fichier disponible/manquant et les opérations de rapprochement des métadonnées Git. Le HEAD local initial était revenu à commitc4a2cca, alors que le distant restait commitf88f283 ; les fichiers du distant étaient tous présents et identiques sauf les trois chemins attendus. Aucune modification de fichier utilisateur n’a été écrasée.

## Contrôle neuf de publication

Les tests de politique Gitleaks/collecteur sont rejoués : **16/16**, exit0. [Journal neuf](policy-tests.log). Ce contrôle n’est pas un vrai scan Gitleaks, une suite complète ou une validation du build. Les blocages et la CI précédente en échec restent ouverts. La CI du nouveau commit publié devra être examinée séparément ; le vérificateur gelé reste rattaché à son ancien état prépublication.
