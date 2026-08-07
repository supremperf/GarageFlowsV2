# Data room technique GarageFlows — index

Organisation en 10 volets. Chaque fiche est soit un document substantiel, soit
un POINTEUR vers le document canonique du dépôt (une seule source par sujet —
la cohérence est gardée par `check:docs` en CI). Les chiffres (tests, versions)
vivent UNIQUEMENT dans `docs/audit/FINAL_VERIFICATION_BASELINE.md`.

| Volet | Contenu |
|---|---|
| 01-product | vue produit, matrice fonctionnelle, architecture |
| 02-engineering | carte du dépôt, stack, build/run, stratégie de tests, release |
| 03-security | vue d'ensemble, threat model, tests sécurité, secrets, dépendances |
| 04-data | architecture BDD, migrations, sauvegardes, inventaire des données |
| 05-compliance | RGPD (mesures techniques), e-invoicing, mapping EN 16931, rétention |
| 06-intellectual-property | audit licences OSS, SBOM, notices, checklist IP |
| 07-operations | observabilité, incident response, disaster recovery, déploiement |
| 08-quality | résultats de tests, qualité de code, performance, accessibilité |
| 09-risks | registre de risques, items ouverts, validations externes |
| 10-acquisition | résumé de due diligence (GREEN/AMBER/RED), intégration, transition |

Entrée recommandée pour un CTO : `10-acquisition/TECHNICAL_DUE_DILIGENCE_SUMMARY.md`.
Index historique de l'audit (lots A-L) : `docs/audit/DATA_ROOM.md`.
