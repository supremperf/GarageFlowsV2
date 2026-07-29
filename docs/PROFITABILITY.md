# Module Premium — Analyse de rentabilité complète

Moteur analytique **déterministe** : marge par facture / client / véhicule /
constructeur / mécanicien / pièce, détection automatique d'anomalies (stocks
dormants, opérations peu rentables, clients déficitaires, pièces vendues à perte)
et **recommandations concrètes** d'amélioration.

## Architecture

```
src/lib/profitability/
├── types.ts    # AnalyzedInvoice/JobPart/PartStock, Margin, DimensionMargin, Anomaly, ProfitabilityReport
├── analyze.ts  # fonctions pures : lineMargin, invoiceMargin, byDimension, marginByPart, detect*, analyze
└── index.ts
```

Le moteur opère sur des **enregistrements normalisés** (mappés depuis Prisma par
l'API), donc 100 % testable, sans dépendance à la base. Argent arrondi au centime
(arrondi demi-centime sûr, cohérent avec `billing.roundCents`).

## Calculs

- **Marge** = CA HT − coût HT ; `marginPct` en % (une décimale), `null` si CA = 0.
- **Par dimension** (générique) : client, véhicule, constructeur (`make`), mécanicien.
- **Par pièce** : agrégation des ventes `JobPart` (CA, coût, marge, quantité vendue).
- **Totaux** de période + lignes par facture.

## Détection d'anomalies

| Type | Déclencheur | Montant en jeu |
|---|---|---|
| `dormant_stock` | pièce en stock (qté > 0) sans vente sur la période | valeur immobilisée (qté × coût) |
| `negative_margin_invoice` | facture à marge < 0 | perte |
| `low_margin_invoice` | marge < seuil (défaut 10 %) | marge |
| `deficit_client` | marge cumulée client < 0 | perte |
| `negative_margin_part` | pièce vendue sous son coût | perte |

Chaque anomalie porte une **sévérité**, un libellé, un détail chiffré et la
référence concernée ; elles sont triées par montant décroissant. Le moteur en
dérive des **recommandations** (déstockage, révision tarifaire, correction des
prix catalogue…).

## API

- `GET /api/profitability?months=6` → authentifié. Charge les factures **payées**
  de la période (par `issueDate`, la date comptable — cohérent avec l'export FEC),
  les ventes de pièces (`JobPart`) et le stock, puis renvoie le rapport complet
  (`totals`, `byClient/Vehicle/Make/Mechanic/Part`, `invoices`, `anomalies`,
  `recommendations`).

## Tests

`src/lib/profitability/__tests__/profitability.test.ts` — 10 tests : marge
ligne/facture (+%), agrégation par dimension, marge par pièce (dont perte),
stock dormant valorisé, rapport complet (totaux exacts, les 5 classes
d'anomalies, recommandations, tri par montant), entrée vide.

## À venir
- Marge de main-d'œuvre par mécanicien (taux horaire × temps facturé − temps réel).
- Export PDF/Excel du rapport (mutualisable avec le module Rapports personnalisables).
