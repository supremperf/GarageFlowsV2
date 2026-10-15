<!-- doc-numbers: journal -->
# Phase 4 — suivi GitHub et triage Gitleaks après publication

**15 octobre 2026 — Europe/Paris — PARTIELLEMENT VALIDÉ, NON PRÊT POUR LA PRODUCTION.**

## Publication et CI observées

La publication `ce5d2815ce185030aebccfc56c1d3eefd955aaa7` a réussi sur `arena/c9eaae15-garageflowsv2`, en avance rapide depuis `bd05cd5`. PR #9 toujours ouverte en draft, aucun merge/déploiement. La commande `gh pr edit 9` a échoué sur une dépréciation GraphQL Projects classic ; la mise à jour du corps de la PR a ensuite réussi via **gh api PATCH /pulls/9**, en conservant son contenu précédent après vérification de non-concurrence.

Le push signale **151 alertes sur la branche par défaut** (2 critiques, 63 hautes, 71 modérées, 15 faibles), distinctes du npm audit candidat à zéro. Elles ne sont ni inspectées intégralement ni remédiées par ce travail sur une branche de session. Ne pas annoncer zéro alerte globale.

Les checks de dépendances sur ce commit sont réussis. Les deux checks Gitleaks, IDs `116425335796` et `116425310428`, ont échoué avec dix détections uniques répétées dans les receipts. Le reste de la CI n’est pas présumé vert.

## Triage des dix détections, sans valeurs de scanner

Seuls chemin/ligne/règle/niveau/titre ont été lus dans les annotations GitHub. **Aucun Secret/Match ou corps de log scanner n’a été récupéré/affiché/publié.**

Les dix lignes correspondent à des champs de `sourceHashes` : chemin d’un ancien artefact public contenant access/authz/api → empreinte SHA-256 de ce fichier. Chaque valeur a été vérifiée indépendamment par recalcul SHA-256 des octets du fichier local correspondant : **10/10 concordent**. Ce sont des empreintes de code/artefacts, pas des clés d’accès. Voir `docs/audit/copilot-phase4/gitleaks-code-digest-triage.json` (métadonnées et digests publics, pas champs Secret/Match).

Les anciens receipts, logs et rapports restent inchangés. Les futurs receipts utilisent des entrées typées `{path, sha256}` plutôt qu’une clé JSON de chemin ambiguë ; ce changement de représentation n’altère aucune mesure, aucun gold ou code d’exécution Copilot.

## Correction de politique étroite, pas contournement

Extension documentée de la règle officielle **generic-api-key de Gitleaks v8.24.3** (README/config officiels lus via GitHub, tag fixé) : les attributs de détection hérités restent intacts. Un `rules.allowlists` applique **AND** entre :

1. le chemin ancré d’un receipt existant **F01..F32 uniquement** ;
2. une ligne JSON exacte contenant l’un des **dix couples chemin-source / digest littéral vérifié**, indentation/comma seulement tolérées.

Aucune exemption entière de fichier, aucune regex « tous les SHA-256 », aucun retrait de règle, pas de nouvelle empreinte dans `.gitleaksignore`, pas d’exemption auth/health/public-key. Un autre digest, une autre valeur, un autre chemin ou F33+ reste détectable. Les anciens trois en-têtes OAuth publics et le fingerprint de prose restent verrouillés par leurs tests existants.

Test nouveau : vérification des dix digests source, structure AND/line/scope, rejet d’un autre hexadécimal de même longueur, d’une valeur de credential synthétique et d’un autre fichier. F33 : politique **3/3**, release-safety **53/53**, index historique phase4 toujours cohérent. Ce sont des tests de politique, **pas le passage du scanner officiel**. Le binaire local reste absent ; une nouvelle exécution GitHub doit confirmer le résultat effectif. Ne pas assimiler l’ancien échec à un succès rétroactif.

## Limites et suite

Aucune credential réelle identifiée dans ces dix cas ; aucune rotation/révocation/réécriture d’historique. Cette classification ne certifie pas toute la branche/l’historique. Le rapport principal conserve ses résultats à l’instant de sa fermeture ; ce suivi et ses receipts sont un ajout, pas une réécriture des preuves.

L’IR applicatif et les critères du corpus restent inchangés depuis F13 : **202 tests Copilot** préservés, **17/48 local**, 31 échecs publiés ; **aucun Anthropic réel/payant**. Génération native/typecheck/build/budget/startup, SQL/HTTP/licence réelle, qualité humaine indépendante et sécurité/CI complète restent non validés. La PR demeure draft.
