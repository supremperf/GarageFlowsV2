# Module Premium — Rapports personnalisables

Générateur de rapports **générique** : l'utilisateur choisit les **colonnes**,
**filtres**, **tri**, **regroupements** et **agrégations**, avec **export CSV**.

## Architecture

```
src/lib/reports/
├── types.ts    # ReportSpec, Filter, Aggregation, SortSpec, ReportResult
├── builder.ts  # runReport : filtre → (group + agrège | sélection) → tri → limite
├── csv.ts      # rowsToCsv / reportToCsv (RFC 4180, délimiteur configurable)
├── sources.ts  # registre des sources (factures / pièces / clients / interventions) + champs
└── index.ts
```

## Moteur (pur, déterministe)

- **Filtres** : `eq, ne, gt, gte, lt, lte, contains, in, between` (comparaison
  numérique quand possible, sinon lexicographique) ;
- **Regroupement + agrégations** : `sum, avg, min, max, count` (alias `as`) ;
- **Tri** multi-clés, **limite** (le `total` reflète le nombre avant limite) ;
- sinon **sélection** des colonnes demandées.

## Export CSV

`rowsToCsv` échappe le délimiteur, les guillemets et les sauts de ligne
(guillemets doublés), délimiteur `,` ou `;` (Excel FR), fin de ligne `\r\n`.
L'API préfixe un BOM UTF-8 pour Excel.

## API

- `GET /api/reports` → sources disponibles + leurs champs (pour l'éditeur).
- `POST /api/reports?source=invoices|parts|clients|jobs&format=json|csv&delimiter=;`
  → authentifié, rate-limité. Charge les lignes de la source (scopées garage),
  exécute la spécification, renvoie du JSON ou un **téléchargement CSV**. Aucun
  modèle ajouté.

## Tests

`src/lib/reports/__tests__/reports.test.ts` — 8 tests : filtres
(eq/gt/contains/in/between), sélection de colonnes, tri + limite (total pré-limite),
agrégations (sum/count/avg avec alias), échappement CSV (RFC 4180), délimiteur `;`,
null/undefined → vide.

## À venir
- Planification (quotidienne / hebdomadaire / mensuelle) + envoi e-mail (compose
  avec le module Notifications) ; export Excel natif ; graphiques.
