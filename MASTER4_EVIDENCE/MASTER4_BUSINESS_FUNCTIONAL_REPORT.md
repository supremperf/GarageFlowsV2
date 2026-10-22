---
doc-numbers: journal
---

# MASTER 4 — Tests métier fonctionnels

**Date : 22 octobre 2026 (Europe/Paris).**  
**Verdict global : BLOCKED — la logique unitaire partielle ne valide pas les parcours métier de production.**

## 1. Exécutions réelles

Les valeurs ci-dessous proviennent de `vitest-final-results.json`, regroupées par mots-clés de fichiers dans `business-functional-matrix.json`. Les catégories se chevauchent et ne sont **pas additives**. « Fichiers rouges » signifie principalement amorçage Prisma impossible, pas démonstration d’une assertion métier fausse.

| Domaine | Fichiers verts/rouges | Assertions réussies / échouées / ignorées | Validation complète |
|---|---:|---:|---|
| Licence hors ligne/expiration/anti-forge | 26 / 2 | 251 / 0 / 30 | BLOCKED : clé émettrice, DB et parcours réels manquants |
| Clients | 3 / 5 | 33 / 0 / 70 | BLOCKED : intégration/UI non exécutée |
| Interventions/planning | 10 / 6 | 162 / 0 / 54 | BLOCKED |
| Devis | 3 / 5 | 50 / 0 / 47 | BLOCKED |
| Factures/calculs/numérotation | 11 / 9 | 91 / 0 / 104 | BLOCKED, concurrence PostgreSQL non exécutée |
| Stock/fournisseurs | 15 / 11 | 131 / 0 / 119 | BLOCKED |
| Dashboard/statistiques | 1 / 2 | 15 / 0 / 12 | BLOCKED |
| Authentification/RBAC/isolation | 13 / 8 | 280 / 0 / 103 | BLOCKED |
| Concurrence | 4 / 1 | 15 / 0 / 8 | BLOCKED : vrais PostgreSQL/Redis absents |
| Sauvegarde/restauration/migrations | 11 / 3 | 83 / 3 / 15 | FAIL : amorçage DB et restauration Prisma non validés |

Les 3 517 assertions vertes de la suite complète sont des preuves unitaires réelles dans leurs fichiers respectifs, mais ne compensent pas les 84 fichiers rouges, les 869 skips ou les 0 scénarios Playwright réussis.

## 2. Parcours et exigences non validés

- **Desktop/Electron et PWA :** aucun parcours navigateur, aucune installation Windows, aucune migration Prisma réelle ; **NOT RUN/BLOCKED**.
- **Concurrence réelle :** 23 tests PostgreSQL et 5 Redis ignorés ; **NOT RUN**.
- **Sauvegardes et restauration :** tests de sécurité Node 189/189 et protections des données verts, mais aucun roundtrip Prisma restauré ; **BLOCKED**.
- **Responsive/accessibilité :** 54 échecs de lancement Chromium et 90 skips ; **NOT RUN**.
- **Abonnements/paiements :** aucun modèle `Subscription`/`Abonnement` ou `Payment`/`Paiement` dans les 43 modèles desktop/47 serveur et aucun parcours Vosegus identifié ; **BLOCKED — périmètre indéterminé**, aucune implémentation inventée.

Pour transformer ces contrôles en réussites, il faut restaurer Prisma et Chromium, fournir les accès isolés, exécuter les parcours DB/UI/Electron avec données de test et clarifier si les abonnements/paiements Vosegus sont une évolution exigée ou une confusion de produit.
