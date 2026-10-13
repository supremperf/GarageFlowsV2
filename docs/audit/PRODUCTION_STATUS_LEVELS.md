<!-- doc-status: actif -->

# Niveaux de statut de production — définitions formelles

Échelle **fermée** utilisée par toute la documentation GarageFlows. Un document
ne doit employer QUE l'un de ces cinq identifiants pour qualifier l'état global.
Le niveau courant faisant foi est dans la baseline canonique
(`FINAL_VERIFICATION_BASELINE.md`).

| Niveau | Signification | Conditions minimales |
|---|---|---|
| `NOT_READY` | Défauts ouverts empêchant une revue sérieuse | risques critiques code ouverts, ou build/tests en échec |
| `DUE_DILIGENCE_READY_WITH_CONDITIONS` | Examinable par une équipe d'acquisition, sous conditions externes explicites | tsc/lint/tests/build verts dans l'environnement disponible ; aucun risque critique code ouvert ; conditions externes listées et séparées |
| `DUE_DILIGENCE_READY` | Examinable sans condition externe bloquante connue | idem + toutes les actions externes bloquantes levées OU documentées comme non bloquantes |
| `PRODUCTION_CANDIDATE` | Déployable en production après validations d'exploitation finales | idem + build de production validé, environnement d'exécution défini et fail-closed prouvé, migrations validées sur staging |
| `PRODUCTION_VERIFIED` | Réellement vérifié en production | build production **déployé** ; base production/staging validée ; secrets réellement configurés ; Windows réel vérifié ; Authenticode effectif si requis ; restauration de sauvegarde testée ; monitoring actif ; migrations réelles validées |

**Règle stricte** : une simple réussite de tests locaux ne donne JAMAIS
`PRODUCTION_VERIFIED` ni `PRODUCTION_CANDIDATE`. Ces deux niveaux exigent une
exécution sur l'infrastructure réelle, qui n'est pas disponible dans
l'environnement d'audit.

## Niveau courant

**`DUE_DILIGENCE_READY_WITH_CONDITIONS`** — cf. `FINAL_VERIFICATION_BASELINE.md`.
Les conditions de passage au niveau supérieur sont les validations externes de
`docs/data-room/09-risks/EXTERNAL_VALIDATIONS.md`.
