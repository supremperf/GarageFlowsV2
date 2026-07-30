# Module Premium — IA détection des pièces oubliées

Moteur de recommandation **explicable** : à partir des opérations d'une
intervention, il propose les pièces/consommables complémentaires couramment
nécessaires mais faciles à oublier — chacune avec un **niveau de confiance**,
une **justification** et un **impact financier** estimé.

Choix d'architecture : un moteur de **règles métier déterministe** (auditable,
justifiable) plutôt qu'une boîte noire — exactement ce que le cahier des charges
demande (« chaque recommandation doit être expliquée et justifiée »). Il reste
enrichissable par un LLM via le pattern `ai-engine` existant.

## Architecture

```
src/lib/forgotten-parts/
├── types.ts    # Recommendation, RuleDef, AnalyzeInput, Confidence/Category
├── rules.ts    # règles curées (freins, distribution, embrayage, vidange, pneus, …)
├── engine.ts   # ForgottenPartsEngine : match → score → justifie → chiffre → trie
└── index.ts    # + singleton forgottenPartsEngine
```

### Règles (extrait, conformes aux exemples du cahier des charges)
- Freins → **liquide de frein**, capteur d'usure ;
- Distribution → **pompe à eau**, galet tendeur, liquide de refroidissement ;
- Embrayage → **butée d'embrayage** ;
- Vidange → **filtre à huile**, **joint** de bouchon ;
- Pneus → **valves** (×4), équilibrage ;
- Amortisseurs → coupelles ; courroie accessoire → galet.

### Scoring & confiance
`score = baseConfidence` + bonus (catégorie sécurité/constructeur, déclenché par
plusieurs opérations, **habitude du garage**), borné à 1. Niveaux : `high` ≥ 0,8,
`medium` ≥ 0,55, sinon `low`. Le matching est **insensible aux accents et à la casse**.

### Impact financier
Depuis le **catalogue** du garage (référence/nom → prix), `total = prix × quantité`
(ex. pneus → 4 valves). Prix inconnu → `null` (pas d'invention).

### Anti-doublon & habitudes
Les pièces **déjà sur l'intervention** ne sont pas re-proposées. Les pièces que le
garage **ajoute souvent** (≥ 3 interventions) remontent en confiance et la
justification le mentionne.

## API

- `POST /api/forgotten-parts` `{ operations?, jobId?, partsOnJob? }`
  → authentifié, rate-limité (60/min/garage). Avec `jobId`, charge le type de
  réparation + les pièces déjà posées, construit le catalogue et les habitudes du
  garage (Prisma), et renvoie `{ recommendations, summary: { count, potentialImpact } }`.

## Tests

`src/lib/forgotten-parts/__tests__/forgotten-parts.test.ts` — 10 tests : reco
vidange/distribution, insensibilité aux accents, anti-doublon, impact financier
(prix × quantité), bonus habitude, tri par confiance, jeu de règles personnalisé,
absence de reco hors périmètre.

## À venir
- Enrichissement LLM (ai-engine) pour des recommandations contextuelles (VIN,
  kilométrage, campagnes constructeur) au-dessus du socle déterministe.
- Réglage des règles/pondérations par garage.
