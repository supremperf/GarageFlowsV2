# Module Premium — Catalogue de pièces (type TecDoc)

Un **catalogue de pièces** structuré : hiérarchie de familles produits,
**compatibilité véhicule** (fitments), **références croisées** (OE ↔ adaptable)
et **recherche classée** explicable. Le cœur est déterministe ; un vrai
catalogue (API type TecDoc, flux fournisseur) se branche derrière l'interface
`CatalogProvider`.

## Architecture

```
src/lib/catalog/
├── types.ts       # Category, CatalogArticle, Fitment, SearchQuery, ScoredArticle, CatalogProvider
├── normalize.ts   # normalizeText (accents/casse) · normalizeRef (clé de référence canonique)
├── crossref.ts    # CrossRefIndex : classes d'équivalence (union-find) sur les références
├── fitment.ts     # fitsVehicle / fitmentSpecificity (marque · modèle · année)
├── categories.ts  # categoryScope (+ descendants) · categoryPath · categoriesForRepairType
├── search.ts      # rankArticles : filtres (catégorie/véhicule/terme) + score explicable
├── providers.ts   # CatalogProvider (interface) + StaticCatalogProvider (hors-ligne)
├── seed.ts        # jeu de données réaliste (familles + articles + fitments + OE)
├── engine.ts      # CatalogEngine : fan-out providers → fusion → cross-ref → classement
└── index.ts
```

## Références croisées (OE ↔ adaptable)

Chaque article porte une référence primaire et une liste d'équivalents. Deux
références sont **équivalentes** si elles apparaissent ensemble sur un article ;
l'équivalence est **transitive** → `CrossRefIndex` construit des ensembles
disjoints (union-find, racine déterministe = plus petite référence normalisée) et
expose la **classe complète** pour n'importe quelle référence, même inconnue.

```ts
const idx = buildCrossRefIndex(SEED_ARTICLES)
idx.areEquivalent('FDB1330', '425371')  // true (Ferodo ↔ OE ↔ Bosch)
idx.equivalents('0986494600')           // ['0986494600','425371','FDB1330','GDB1330', …]
```

## Compatibilité véhicule

`fitsVehicle(fitments, { make, model, year })` :

- liste de fitments **vide** ⇒ article **universel** (consommable) → compatible ;
- sinon **au moins un** fitment correspond : marque égale (insensible
  accents/casse), modèle compatible (`contains` dans les deux sens), et — quand
  l'année **et** la plage sont connues — année dans l'intervalle. Une **année
  inconnue ne disqualifie jamais** (on ne peut pas prouver l'incompatibilité).

`fitmentSpecificity` (0..3) classe un accord marque+modèle+année au-dessus d'un
article universel.

## Recherche & classement (`rankArticles`)

Filtres (un filtre non satisfait exclut l'article) : **catégorie** (catégorie +
descendants), **véhicule** (doit correspondre), **terme** (si `text`/`reference`
fourni, l'article doit correspondre). Score explicable via `matched` :

| Signal | Points |
|---|---|
| Référence exacte | +10 |
| Référence croisée | +8 |
| Nom exact / préfixe / contient | +6 / +5 / +3 |
| Marque | +2 |
| Catégorie | +1 |
| Spécificité du fit véhicule | +0..3 |

Tri déterministe : score décroissant, puis nom, puis référence.

## Moteur

`CatalogEngine` interroge **tous** les providers en parallèle
(`Promise.allSettled`), **fusionne et dédoublonne** par `id` (premier provider
gagnant), reconstruit l'index de références croisées sur l'ensemble fusionné puis
classe. Un provider en panne est **isolé** (erreur remontée, calcul poursuivi).
Méthodes : `search`, `compatible(vehicle, {categoryId})`, `equivalents(ref)`,
`categoryPath`, `getCategories`.

## API — `GET /api/catalog` (lecture seule)

Authentifié, cloisonné par `garageId`. Aucune écriture → aucune confirmation.

- `?text=&reference=&categoryId=&make=&model=&year=&plate=&vin=&limit=` —
  recherche classée. Le **véhicule** est résolu par paramètres explicites, sinon
  par **plaque** (lecture du `Vehicle` du garage), sinon par **VIN** (décodage →
  constructeur + millésime). Chaque résultat est annoté `inStock` /
  `stockQuantity` (jointure sur les références du stock du garage, référence
  primaire **ou** croisée) et `categoryPath`.
- `?action=categories` — l'arbre des familles.
- `?action=equivalents&reference=XXX` — la classe d'équivalence + les articles,
  avec `inStock`.

## Tests

`src/lib/catalog/__tests__/catalog.test.ts` — 20 tests : normalisation de
référence, union-find transitif (+ référence inconnue, chaîne vide), fitment
(plage d'année, universel, année manquante, spécificité), scope/chemin de
catégories, recherche (référence exacte vs croisée, filtres véhicule+catégorie,
exclusion hors véhicule, texte accent-insensible + limite, terme sans résultat),
équivalents & compatibles, résilience (provider en panne isolé, dédoublonnage).

## Intégrations & suite

Les familles pointent vers les `REPAIR_TYPES` (une intervention suggère ses
familles). Les références alimentent la **Commande fournisseurs** et les
**Pièces oubliées** ; la compatibilité exploite le `Vehicle` du garage et la
sortie du **décodeur VIN**. À venir : connecteur `CatalogProvider` vers une API
réelle (TecDoc), attributs techniques étendus et images.
