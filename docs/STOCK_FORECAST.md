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

## À venir
- Meilleur fournisseur (délai/prix) et commande groupée — jonction avec le module
  Commande automatique fournisseurs ; saisonnalité annuelle dès 24 mois.
