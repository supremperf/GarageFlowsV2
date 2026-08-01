# Facturation électronique — règles de communication commerciale

_Ce guide encadre CE QUI PEUT ÊTRE DIT sur la facturation électronique de
GarageFlow. Il est adossé à un garde-fou technique
(`src/lib/einvoicing/compliance.ts` + `scripts/check-compliance-language.js`)._

## Statut réel actuel : `INTERNAL_SANDBOX_ONLY`
GarageFlow **produit et valide** des factures conformes au **cœur EN 16931**
(UBL 2.1 / CII / Factur-X) et les transmet à un **fournisseur SIMULÉ** (sandbox
interne). **Aucune plateforme agréée (PDP) n'est intégrée** et **aucune
transmission légale réelle** n'a lieu. Ce statut ne permet PAS l'usage en
production réglementaire.

## Niveaux de conformité (progression)
| Niveau | Signification | Peut-on l'annoncer ? |
|---|---|---|
| `INTERNAL_SANDBOX_ONLY` | Fournisseur simulé interne (**actuel**) | « prêt à l'intégration », « moteur EN 16931 » — jamais « conforme » |
| `EXTERNAL_SANDBOX_TESTED` | Sandbox d'une PDP réelle testée | « interopérabilité testée en sandbox » |
| `PILOT_WITH_PDP` | Pilote production limitée avec PDP agréée | « pilote avec la PDP X » (nommer, dater) |
| `PRODUCTION_VALIDATED` | Production validée, preuves | « transmission en production avec la PDP X » |

Le niveau courant est exposé par le code (`CURRENT_COMPLIANCE_LEVEL`) et ne doit
être relevé **que sur preuve** d'une intégration réelle et opérationnelle.

## Formulations INTERDITES (tant que non prouvées)
- « **Certifié conforme** » / « certifiée conforme »
- « **PDP intégré(e)** » / « plateforme agréée intégrée »
- « **certified compliant** »
- « **homologué pour la facturation électronique** »

Ces formulations sont **bloquées en CI** par `npm run compliance:check`
(échec si détectées hors des fichiers de définition/interdiction).

## Formulations ACCEPTABLES (honnêtes)
- « Moteur de facturation électronique **conforme au cœur EN 16931** (UBL/CII/Factur-X). »
- « **Prêt à l'intégration** avec une plateforme de dématérialisation partenaire (PDP). »
- « Transmission via un fournisseur **simulé (sandbox)** pour tests et démonstration. »
- « **Sous réserve** d'une intégration PDP agréée pour un usage légal en production. »

## Règle d'or
Ne jamais laisser entendre que GarageFlow est prêt pour la facturation
électronique **réglementaire** tant qu'une intégration officielle avec une PDP
agréée n'est pas **réellement opérationnelle et prouvée**. En cas de doute,
rétrograder la formulation.
