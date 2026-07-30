# Module Premium — Gamification

Transforme les performances des mécaniciens en **scores**, **XP/niveaux**,
**badges/trophées** et **classement**. Conçu pour **motiver sans compétition
toxique** : la progression individuelle (niveau, scores, badges) est au premier
plan, et les moyennes d'équipe sont toujours affichées à côté du classement.

## Architecture

```
src/lib/gamification/
├── types.ts     # MechanicStats, ScoreBreakdown, Badge, LevelInfo, MechanicProfile, Leaderboard
├── scoring.ts   # productivité / qualité / ponctualité / satisfaction (gestion des null)
├── levels.ts    # XP + courbe de niveaux (quadratique)
├── badges.ts    # définitions + évaluation des badges
├── engine.ts    # buildProfile, buildLeaderboard (+ agrégat d'équipe)
└── index.ts
```

## Scores (0..100, `null` si pas de données)

- **Productivité** = temps estimé / temps réel (plafonné à 100 si ≥ barème) ;
- **Qualité** = part d'interventions sans reprise ;
- **Ponctualité** = part d'interventions à l'heure ;
- **Satisfaction** = note moyenne client ramenée en % ;
- **Total** = moyenne pondérée (0,3 / 0,3 / 0,2 / 0,2) **sur les scores
  disponibles** (poids renormalisés si une dimension manque).

## XP & niveaux

`XP = interventions×10 + CA/50 + score`. Courbe quadratique
(`XP niveau L = (L−1)²×100`) : niveaux rapides au début, plus exigeants ensuite.
`levelInfo` renvoie progression vers le niveau suivant.

## Badges

Éclair (productivité ≥ 100), Zéro défaut (qualité ≥ 95 sur ≥ 10), À l'heure
(ponctualité ≥ 95 sur ≥ 10), Chouchou des clients (satisfaction ≥ 90),
Centurion (100 interventions), Polyvalent (tous scores ≥ 80), Étoile montante
(niveau 5). Bronze / argent / or.

## API

- `GET /api/gamification?months=3` → authentifié. Construit les stats par
  mécanicien depuis les interventions **terminées** (temps estimé/réel,
  ponctualité) et renvoie `{ ranking, profiles, team }`. Aucun modèle ajouté.

## Tests

`src/lib/gamification/__tests__/gamification.test.ts` — 7 tests : scores
(productivité plafonnée), badges attribués, satisfaction manquante (poids
renormalisés), Centurion à 100 interventions, courbe de niveaux, classement
(total puis niveau) + agrégats d'équipe, moyennes d'équipe avec score manquant.

## À venir
- Sources qualité/satisfaction réelles (reprises détectées, notes clients),
  saisons/objectifs et récompenses configurables par garage.
