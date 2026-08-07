# GarageFlows — Technical Due Diligence Summary

Destinataire : CTO acquéreur. Chaque note est justifiée par des preuves
exécutées (fichiers/tests cités) ; les chiffres exacts sont dans
`docs/audit/FINAL_VERIFICATION_BASELINE.md`. Barème : GREEN = prouvé dans
l'environnement disponible ; AMBER = solide mais preuve incomplète ou
dépendance externe ; RED = manquant.

## Executive Summary

Produit réel et cohérent : gestion de garage (planning, clients/véhicules,
devis/factures, OR, stock, portail client, signatures) livrée en desktop
Windows hors-ligne (Electron+SQLite), serveur multi-tenant (PostgreSQL) et PWA
— combinaison absente du panel concurrentiel français étudié. L'ingénierie est
outillée pour la preuve : >1300 tests verts (dont concurrence sur PostgreSQL
réel), 10 gardes CI bloquantes, release gate unique, documentation
anti-contradiction gardée. Les risques résiduels sont majoritairement des
**validations externes** (Authenticode, plateforme e-invoicing, juridique,
infrastructure de production), pas des défauts de code connus.

## Notes par domaine

| Domaine | Note | Justification (preuves) |
|---|---|---|
| Product Architecture | **GREEN** | double déploiement + PWA fonctionnels ; build 16 pages ; threat model ; inventaire 12 sous-systèmes |
| Security (appli) | **GREEN** | authz 128 cellules testées, en-têtes durcis testés (CSP prod sans unsafe-eval, vérifiée au runtime), rate-limit fail-closed prouvé multi-instance, Electron baseline observée, MàJ fail-closed testée |
| Tenant Isolation | **GREEN** | matrice de permutation 63 tests + audit statique 141 routes (0 faille) + E2E métier avec tentatives inter-garages refusées |
| Financial Integrity | **GREEN** | zéro Float monétaire (3 gardes), formule TVA unique 100 % entière, immuabilité 409 testée, numérotation contiguë prouvée sous 50 requêtes parallèles sur PostgreSQL réel |
| E-Invoicing | **AMBER** | modèle EN 16931 + validateur fail-closed + CII validé au XSD officiel MINIMUM ; MAIS pas de PDF/A-3, pas de Schematron, aucune plateforme raccordée (échéance réglementaire 2026 = l'écart concurrentiel le plus daté) |
| Desktop/PWA | **AMBER** | Electron durci (baseline complète) et PWA gardée ; MAIS aucun build/installation Windows réel ni Authenticode (validation externe) |
| Testing | **GREEN** | >1300 tests verts 0 échec (unit/intégration/E2E métier/Playwright contre build prod ×3), PG+Redis réels, release gate 10/10 avec preuve négative |
| Deployment | **AMBER** | validation d'env fail-closed PROUVÉE (démarrage refusé sans infra conforme) ; MAIS aucun déploiement production/staging réel effectué |
| Open Source / IP | **GREEN** (code) / **AMBER** (juridique) | 0 licence bloquante en production, SBOM + notices générées, provenance documentée ; cession de droits et attestations = conseil |
| Data Protection | **AMBER** | mesures art. 32 réelles et testées, inventaire des données, runbooks ; MAIS anonymisation automatisée à livrer, rétentions à paramétrer, validation DPO absente |
| Operational Readiness | **AMBER** | observabilité codée+testée, runbooks DR/incident, restauration desktop prouvée ; MAIS pas d'alerting câblé ni d'exercice DR réel ni de test de charge |

## Known Limitations (sélection)

Pas d'app mobile native (PWA responsive) ; pas d'intégrations catalogues
(SIV/ETAI/DARVA) ; i18n incomplète (27 composants) ; CSP sans nonce
('unsafe-inline' scripts verrouillé) ; mono-taux de TVA par facture ; avoirs
non modélisés. Détail : `docs/audit/RISK_REGISTER.md` et `OPEN_ITEMS.md`.

## External Validations Required

Voir `../09-risks/EXTERNAL_VALIDATIONS.md` (juridique, comptable, plateforme
agréée, Windows/Authenticode, infrastructure/charge).

## Overall Technical Risk : **AMBER — maîtrisé**

Le risque technique CODE est faible et outillé (aucun risque critique code
connu ouvert au registre) ; le risque résiduel est concentré sur les
validations externes listées, normales à ce stade pré-acquisition. Verdict
détaillé et conditions : `docs/audit/RAPPORT_FINAL_AUDIT.md`.
