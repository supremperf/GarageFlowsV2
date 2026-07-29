# Module Premium — Diagnostic intelligent

À partir de **symptômes** libres et/ou de **codes défaut OBD-II** (+ kilométrage
et historique), propose des **causes probables classées**, avec contrôles
recommandés dans l'ordre, pièces suspectes, temps estimé, difficulté et niveau
de confiance. Explicable : chaque cause cite ce qui la désigne.

## Architecture

```
src/lib/diagnostic/
├── types.ts       # DiagnosticInput, DecodedObdCode, ProbableCause, DiagnosticResult
├── obd.ts         # decodeObdCode (structure SAE J2012) + descriptions courantes
├── knowledge.ts   # base de connaissances : causes, règles symptômes, causes par code/ sous-système
├── engine.ts      # diagnose : fusionne symptômes + codes → causes classées
└── index.ts
```

## Décodage OBD-II

`decodeObdCode` reconnaît la structure `[PCBU][0-3][0-9A-F]{3}` : système
(powertrain/chassis/body/network), portée (générique / spécifique constructeur),
sous-système (pour les codes P), et description (dictionnaire des codes courants,
sinon description structurée). Les codes invalides sont signalés, pas exécutés.

## Moteur

- Les **symptômes** (mots-clés, insensibles aux accents/casse) et les **codes**
  apportent chacun des causes candidates ;
- une cause **corroborée par plusieurs sources** voit sa probabilité augmenter ;
- **kilométrage élevé** (≥ 150 000 km) renforce les causes d'usure ; un
  **antécédent** sur le véhicule renforce la cause correspondante ;
- classement par probabilité (départage : contrôles les moins coûteux d'abord) ;
- **ordre de contrôle** fusionné et dédupliqué sur les meilleures causes.

Chaque cause : `probability` (%), `confidence` (high/medium/low), `justification[]`,
`recommendedChecks[]`, `suspectedParts[]`, `consumables[]`, `estimatedTimeMin`,
`difficulty`.

## API

- `POST /api/diagnostic` `{ symptoms?, obdCodes?, mileage?, history?, vehicleId? }`
  → authentifié, rate-limité. Avec `vehicleId`, récupère le kilométrage et
  l'historique des types de réparation (par plaque) pour affiner. Aucun modèle
  ajouté.

## Tests

`src/lib/diagnostic/__tests__/diagnostic.test.ts` — 10 tests : décodage OBD
(générique/constructeur/invalide), corroboration symptôme+code (probabilité +
confiance), classement + ordre de contrôle, bonus kilométrage, bonus antécédent,
code catalyseur → convertisseur, fumée blanche → joint de culasse, notes
(codes invalides / entrée vide).

## À venir
- Enrichissement par campagnes constructeur / statistiques anonymisées ;
- Couplage à l'IA générative (ai-engine) pour les symptômes hors base, au-dessus
  du socle déterministe.
