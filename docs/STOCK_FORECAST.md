# Module Premium — Stock prédictif

Planification de réapprovisionnement **explicable** : prévoit la consommation,
calcule le stock de sécurité, le point de commande, la quantité optimale, la
date de commande au plus tard et l'urgence — avec justification. Compose les
moteurs **Prévisions IA** (#6) et **Rentabilité** (#5, prix).

## Architecture

```
src/lib/stock-forecast/
├── types.ts   # StockItemInput, ReorderPlan, StockForecastReport
├── plan.ts    # computeReorderPlan (par pièce) + planReorders (lot, trié par urgence)
└── index.ts
```

## Logique (théorie des stocks + prévision)

- **Demande** = max(prévision prochaine période, moyenne récente) — évite le
  sous-approvisionnement sur données bruitées ;
- **Taux journalier** = demande / durée de période (30 j par défaut) ;
- **Rupture estimée** = stock actuel / taux journalier (jours) ;
- **Stock de sécurité** = z × écart-type de la demande, ramené à la fenêtre du
  délai fournisseur (z = 1,28 ≈ 90 % de service par défaut) ;
- **Point de commande** = taux × délai + stock de sécurité ;
- **Faut-il commander ?** stock ≤ point de commande **ou** ≤ seuil configuré ;
- **Quantité recommandée** = niveau cible (délai + une période, jamais sous le
  seuil mini) − stock actuel, **arrondie au conditionnement** ;
- **Date au plus tard** = rupture − délai (jours) ;
- **Urgence** : `critical` (rupture ≤ délai) / `high` / `medium` / `low` / `none`.

Chaque plan porte une **justification** (`rationale`). `planReorders` trie par
urgence puis rupture la plus proche et renvoie un **résumé** (nb à commander,
coût total de commande).

## API

- `GET /api/stock-forecast?months=6&leadTimeDays=7` → authentifié. Construit la
  consommation mensuelle par pièce depuis les `JobPart`, calcule les plans et le
  résumé. Aucun nouveau modèle (utilise Part/JobPart/Job).

## Tests

`src/lib/stock-forecast/__tests__/stock-forecast.test.ts` — 7 tests : commande
sous le point (urgence critique + quantité/coût exacts), stock ample (pas de
commande), consommation nulle (aucun risque), plancher de seuil mini, arrondi au
conditionnement, stock de sécurité qui augmente avec la variabilité, tri par
urgence + résumé.

## Limites et suite

La recommandation de quantité/coût est une **estimation fondée sur l’historique et
les coûts saisis localement** : elle ne vérifie pas un prix ou un stock fournisseur
et ne crée pas un bon de commande. Les devis et commandes fournisseurs automatiques
restent désactivés tant qu’aucune intégration réelle n’est validée (voir
[`SUPPLIERS.md`](./SUPPLIERS.md)). Une future intégration nécessitera un sandbox,
une validation du contrat et des preuves multi-garages avant activation.
