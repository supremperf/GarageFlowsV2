# Module Premium — Prévisions IA

Prévisions déterministes de séries temporelles (CA, fréquentation, charge
atelier, consommation stock) avec **tendance**, **intervalle de confiance**,
**hypothèses** explicites et **scénarios** (attendu / optimiste / pessimiste).

## Architecture

```
src/lib/forecast/
├── types.ts     # ForecastResult, ForecastPoint, ForecastOptions, Trend/Confidence
├── stats.ts     # mean, stddev, mae, linearRegression (moindres carrés), movingAverage
├── forecast.ts  # modèles + sélection auto + intervalles + scénarios
└── index.ts
```

## Modèles

- **linear** — régression linéaire par moindres carrés (tendance) ;
- **moving_average** — moyenne mobile de la fenêtre récente ;
- **seasonal_naive** — répétition du motif saisonnier (période configurable) ;
- **naive** — dernière valeur (repli).
- **auto** — sélectionne le modèle à **plus faible erreur en échantillon** (MAE
  un-pas-en-avant), avec ordre de priorité déterministe pour départager.

Chaque prévision fournit : `points[{ step, value, lower, upper }]`,
`trend` (up/down/flat), `slope`, `confidence` (dérivée du résidu relatif),
`r2` (pour le modèle linéaire), `assumptions[]`, et
`scenarios { expected, optimistic, pessimistic }`. Les valeurs sont **bornées à 0**
par défaut (montants/effectifs). Intervalle à ~95 % (z = 1,96 par défaut).

## API

- `GET /api/forecast?metric=revenue|appointments|workshop_load&months=12&horizon=3`
  → construit la série mensuelle depuis Prisma (CA HT des factures payées par
  `issueDate` ; nombre d'interventions ; heures estimées d'atelier) puis prévoit.
- `POST /api/forecast` `{ series, horizon?, method?, seasonPeriod? }` → prévoit une
  série arbitraire (sans base) — utile pour simuler/tester.

## Tests

`src/lib/forecast/__tests__/forecast.test.ts` — 10 tests : régression (ligne
parfaite, série plate), extrapolation linéaire (intervalle nul si résidu nul),
série constante, **borne à 0**, moyenne mobile, saisonnier, sélection **auto**
(choisit le linéaire sur une tendance propre), historique à un seul point,
présence des hypothèses.

## À venir
- Bandes d'incertitude élargies avec l'horizon (√k), lissage exponentiel (Holt),
  et prise en compte de la saisonnalité annuelle dès 24 mois d'historique.
