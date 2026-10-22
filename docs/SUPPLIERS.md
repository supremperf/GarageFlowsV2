# Commandes fournisseurs — état vérifié

## État de production

**L’intégration fournisseur en temps réel n’est pas implémentée.** En conséquence,
GarageFlows ne compare pas d’offres réelles et ne connaît ni le prix actuel, ni
la disponibilité, ni le délai de livraison auprès d’un fournisseur. L’application
n’invente pas ces données et ne crée pas de bon de commande automatique à partir
du coût historique d’une pièce.

- `GET /api/suppliers` renvoie `501 SUPPLIER_INTEGRATION_REQUIRED`.
- `POST /api/suppliers` avec `action: 'create-orders'` renvoie le même `501`,
  avec ou sans `confirm`, et n’écrit rien en base.
- Le panneau Fournisseurs l’indique explicitement et ne présente plus de devis
  estimé comme une offre fournisseur.
- `Part.supplierName` et `Part.supplierRef` restent des métadonnées saisies par
  le garage. Elles ne prouvent pas un tarif ou un stock actuel.
- Les bons de commande déjà enregistrés restent consultables. Le cycle d’état,
  la réception et les mouvements de stock restent disponibles pour ces bons,
  sous contrôle `stock:manage` et `garageId`.
- `POST /api/purchase-orders` permet toujours d’enregistrer un bon avec des lignes
  non vides et des quantités entières positives fournies par l’appelant. Ces données
  ne sont pas vérifiées par GarageFlows auprès du fournisseur ; le logiciel ne
  prétend donc pas que le bon a été transmis.

## Cœur hors ligne (tests/démonstrations uniquement)

`src/lib/suppliers/` conserve un moteur déterministe permettant de tester le
classement et le cycle de vie :

- `StaticConnector` utilise un catalogue mémoire de fixtures.
- `FallbackConnector` peut fabriquer une offre de test.
- `SupplierEngine` compare, classe et regroupe des offres fournies par un
  connecteur.

Ces classes sont **hors ligne uniquement** et ne sont pas branchées dans la route
de production. Leur résultat ne constitue ni une preuve commerciale ni un
connecteur fournisseur. Aucun fournisseur externe (API, EDI ou catalogue) n’est
actuellement configuré.

## Cycle des bons enregistrés

```text
draft → sent → confirmed → received → returned
  └──────────────────────────────→ cancelled
```

`POST /api/suppliers` avec `action: 'transition'` applique le cycle après
confirmation. La réception et le retour ajustent le stock dans une transaction,
avec contrôle du garage, revendication atomique de l’état et journalisation des
mouvements. Les lignes JSON malformées, vides, sans article, à quantité nulle,
fractionnaire, ou liées à une pièce absente/d’un autre garage sont refusées avant
que le statut terminal ne soit enregistré. Toute course de suppression ou
modification de pièce annule la transaction ; la réponse indique le nombre de
lignes de stock effectivement mises à jour. Cette opération met à jour l’état du
bon et le stock ; elle ne prouve pas qu’un fournisseur a reçu ou confirmé la
commande. La transmission reste manuelle et doit être confirmée auprès du fournisseur.

## Conditions préalables à la réactivation de l’automatisation

Avant de renvoyer autre chose que `501`, il faut :

1. sélectionner un fournisseur et obtenir une intégration/API réellement prise en
   charge, son contrat et son environnement sandbox ;
2. définir comment sont authentifiés les garages, protégés les identifiants et
   séparés les comptes/commandes multi-garages ;
3. vérifier les prix, taxes, devise, références, quantité disponible, délais,
   erreurs, expirations et idempotence à partir de réponses réelles ;
4. implémenter une transmission de bon qui ne prétend pas réussir avant l’accusé
   réel du fournisseur ;
5. ajouter des tests contractuels et d’isolation, puis exécuter un parcours de
   bout en bout dans le sandbox fournisseur ;
6. ne réactiver l’interface qu’après revue et preuve datée. Les fixtures hors ligne
   seules ne satisfont pas ces exigences.

## Tests

- `src/lib/suppliers/__tests__/suppliers.test.ts` : tests unitaires du moteur hors
  ligne à l’aide de fixtures ; ils ne vérifient aucun fournisseur réel.
- `src/integration/suppliers.test.ts` : réponses `501` sans écriture, cycle des
  commandes enregistrées, isolation du garage et contrôle des permissions.
- `src/app/api/purchase-orders/__tests__/receive-guards.test.ts` et
  `src/app/api/suppliers/__tests__/transition-guards.test.ts` : tests de route
  sans DB pour lignes invalides, pièces absentes/hors garage, course de
  suppression, stock réellement modifié et mouvements journalisés.
- `src/integration/supplier-linkage.test.ts` : enregistrement de métadonnées
  fournisseur et refus de les traiter comme des offres réelles.
