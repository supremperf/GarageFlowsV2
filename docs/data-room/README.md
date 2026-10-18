<!-- doc-status: actif -->

# GarageFlows — Technical Data Room

Point d'entrée du dossier technique d'acquisition. Chaque fiche est soit un
document substantiel, soit un **pointeur** vers le document canonique (une
source par sujet — cohérence gardée par `check:docs` en CI). Les chiffres
d'état (tests, versions, commit) vivent **uniquement** dans la baseline
canonique `docs/audit/FINAL_VERIFICATION_BASELINE.md` /
`artifacts/verification/baseline.json`.

## Start here (parcours conseillé pour une équipe d'acquisition)

1. **Technical Due Diligence Summary** — `10-acquisition/TECHNICAL_DUE_DILIGENCE_SUMMARY.md` (notes GREEN/AMBER/RED, verdict)
2. **Final Verification Baseline** — `../audit/FINAL_VERIFICATION_BASELINE.md` (source canonique : commit, tests, classification)
3. **Acquisition Risk Summary** — `09-risks/ACQUISITION_RISK_SUMMARY.md` (< 5 min : critical/high/medium/low)
4. **Architecture** — `01-product/ARCHITECTURE.md`
5. **Security** — `03-security/SECURITY_OVERVIEW.md` (+ threat model, secrets)
6. **Testing** — `02-engineering/TEST_STRATEGY.md`
7. **Compliance** — `05-compliance/` (RGPD, e-invoicing, EN 16931, rétention)
8. **Intellectual Property** — `06-intellectual-property/` (licences OSS, SBOM, checklist)
9. **Operations** — `07-operations/` (observabilité, incident, DR, déploiement)
10. **Open Items** — `09-risks/OPEN_ITEMS.md` (risques résiduels classifiés) + `EXTERNAL_VALIDATIONS.md`

## Les 10 volets

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
| 09-risks | registre de risques, items ouverts classifiés, validations externes |
| 10-acquisition | résumé de due diligence, intégration, transition, preuves demandables |

Un acquéreur doit comprendre l'ensemble du dossier via ce README + les 3
premiers documents, sans parcourir 100 fichiers. Index historique de l'audit
(lots A-L) : `docs/audit/DATA_ROOM.md`.
