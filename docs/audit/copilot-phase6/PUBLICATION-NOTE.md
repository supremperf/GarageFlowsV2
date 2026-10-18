# Complément de publication — P29 et intégrité des preuves

**Statut inchangé : PARTIELLEMENT VALIDÉ — NON PRÊT POUR LA PRODUCTION.**

Le rapport, l’index P01–P28 et le premier manifeste étaient déjà figés quand le contrôle documentaire complet a été exécuté après staging.

- Commande exacte : `git diff --cached --check`.
- Preuve : **P29.json / P29.txt**, **exit 2 — FAIL**, pas PASS/skip.
- Motif : une ligne blanche finale dans chacun des journaux P06, P10, P11, P12, P16, P18, P21 et P24 ; emplacements exacts conservés dans P29.
- Aucun journal ni reçu d’exécution n’a été retaillé/réécrit pour faire passer ce contrôle. Les hashes du manifeste initial restent valides. Aucun réglage Git whitespace, exclusion ou gate de sécurité n’a été modifié.
- Le `git diff --check` de P27 était antérieur au staging des nouveaux documents : son exit 0 ne prouve pas la conformité whitespace de ces journaux ensuite ajoutés.

Ce complément enregistre le contrôle documentaire négatif et complète l’index sans réécrire les preuves déjà hashées. Il ne transforme pas cet échec en succès et ne modifie aucun résultat applicatif. Le snapshot complémentaire référence les nouveaux fichiers seulement ; la CI de publication devra être rapportée séparément avec son commit propre.

Les limites du rapport restent intégralement applicables : quatre courses locales historiques non acceptées, autres limites de stockage/transferts, API d’alertes 403, coût positif non démontré (paiement bloqué), deuxième corpus indépendant absent, démarrage/recette authentifiée de préproduction non validés. Aucun merge, déploiement ou appel payant.
