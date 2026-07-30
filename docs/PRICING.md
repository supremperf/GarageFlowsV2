# Module Premium — Optimisation intelligente des prix

Recommande un **prix conseillé** à partir du coût et d'une **marge cible**, en
tenant compte du positionnement concurrentiel, de la saison et de la fidélité,
avec **marge estimée**, **impact ventes** (élasticité) et **simulation de
scénarios** (dont maximisation du profit). Compose avec la Rentabilité (#5).

## Architecture

```
src/lib/pricing/
├── types.ts     # PricingInput, ScenarioResult, PricingRecommendation
├── optimize.ts  # priceForMargin, marginPctOf, estimate (élasticité), recommendPrice, simulateScenarios
└── index.ts
```

## Logique

- **Marge sur CA** : `marge% = (prix − coût) / prix`. `priceForMargin(cost, m) = cost / (1 − m)`.
- **Prix plancher** = marge mini (défaut 10 %) ; **prix cible** = marge cible (défaut 35 %).
- **Recommandation** : partir du prix cible ; rester **au niveau ou sous** un
  concurrent connu ; appliquer saison × fidélité ; **jamais sous le plancher**.
- **Impact ventes** (si volume de référence + prix actuel fournis) :
  `volume ≈ base × (1 + élasticité × Δprix%)`, d'où CA et profit estimés.
- **Scénarios** : recommandé / plancher / cible / concurrent + un **profit_max**
  balayé sur une grille (quand les estimations sont disponibles).

Chaque recommandation fournit une **justification** (`rationale`).

## API

- `POST /api/pricing` `{ partId? | unitCost, currentPrice?, targetMarginPct?, minMarginPct?, competitorPrice?, elasticity?, baselineVolume?, seasonFactor?, loyaltyDiscountPct? }`
  → authentifié, rate-limité. Avec `partId`, charge coût/prix de la pièce et
  déduit le **volume mensuel de référence** des 3 derniers mois de ventes.
  Renvoie le prix recommandé, la marge, plancher/cible et les scénarios.

## Tests

`src/lib/pricing/__tests__/pricing.test.ts` — 12 tests : prix pour marge cible,
marge d'un prix, recommandation sans concurrent, concurrent qui sous-cote /
au-dessus de la cible, respect du plancher, facteur saisonnier, remise fidélité,
scénarios + profit_max, élasticité (volume ↓ quand prix ↑), classement par profit.

## À venir
- Élasticité estimée par pièce depuis l'historique (au lieu d'une valeur par défaut).
- Arrondi psychologique optionnel (.90/.99) et garde-fous anti-discrimination tarifaire.
