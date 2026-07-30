# Module Premium — Génération de devis assistée

Assemble un **devis structuré** à partir d'opérations de réparation :
**main-d'œuvre** (durée estimée × taux horaire), **pièces par défaut** (BOM),
**suggestions** de pièces oubliées, et totaux **HT / TVA / TTC** + **marge**. Le
moteur est **déterministe** et ne persiste jamais — la proposition est
**confirmée** par l'utilisateur avant qu'un vrai devis soit créé.

## Architecture

```
src/lib/quote-gen/
├── types.ts     # QuoteOperation, QuotePartInput, QuoteSuggestionInput, QuoteLine, QuoteProposal
├── generate.ts  # generateQuote (pur) + billedHours + roundMoney
└── index.ts
```

## Assemblage

- **Main-d'œuvre** : par opération, `laborMinutes → heures facturées`
  (`billedHours` : arrondi **au pas supérieur**, 0,25 h par défaut) × taux
  horaire. Une ligne `isLabor`.
- **Pièces** : une ligne par pièce par défaut de l'opération (nom, référence,
  prix de vente, coût, quantité).
- **Suggestions** (pièces oubliées) : rattachées **séparément** comme lignes
  **optionnelles**, **exclues des totaux** — l'utilisateur les ajoute
  explicitement.
- **Totaux** : `subtotalHT = laborHT + partsHT`, `TVA = subtotalHT × taux`,
  `TTC = subtotalHT + TVA`. **Marge** = `subtotalHT − coût pièces` (le coût de
  main-d'œuvre n'est pas modélisé, donc la MO est marge pleine). Argent arrondi
  aux centimes (règle float-safe).
- **Avertissements** : requête vide, taux horaire absent, prix de pièce manquant.

## API — `POST /api/quotes/generate`

Authentifié, cloisonné par `garageId`, limité (30 req/min). **Confirmation
obligatoire** : sans `confirm: true`, renvoie un **aperçu** (`confirmationRequired`)
sans rien écrire ; avec `confirm: true`, persiste un **devis brouillon**.

```jsonc
// requête
{ "repairTypes": ["oil_change", "brake_pads"],
  "vehicleId": "…",            // optionnel : pré-remplit véhicule/client
  "laborRatePerHour": 65,      // optionnel : sinon taux horaire du garage
  "vatRate": 20,               // optionnel : sinon TVA du garage
  "includeSuggestions": true,  // optionnel (défaut true)
  "confirm": false }
// réponse (aperçu)
{ "confirmationRequired": true,
  "proposal": { "lines": [...], "suggestions": [...],
                "totals": { "subtotalHT": 78, "vat": 15.6, "totalTTC": 93.6, "marginPct": 59 } },
  "vehicle": {...}, "client": {...} }
```

Le moteur puise les **durées par défaut** dans `REPAIR_TYPES`, la **BOM** dans
`RepairTypePart`, les **prix** dans le catalogue du garage, et les **suggestions**
dans le moteur **Pièces oubliées**. À la confirmation, le devis reçoit un numéro
via le **compteur transactionnel** (pas de trou) et les lignes (MO + pièces ;
les suggestions ne sont pas persistées par défaut). Écriture **auditée**.

## Tests

`src/lib/quote-gen/__tests__/quote-gen.test.ts` — 8 tests : arrondi des heures
(pas supérieur), lignes MO+pièces et totaux HT/TVA/TTC, marge depuis le coût
pièces, agrégation multi-opérations, suggestions hors totaux, arrondi float-safe,
avertissements (vide / taux / prix), taux de TVA personnalisé.

## Intégrations & suite

Compose `REPAIR_TYPES`, `RepairTypePart`, le **catalogue** et **Pièces oubliées**
— chacun déjà testé. À venir : ajustement des durées par l'**historique**
(`estimateJobDuration`), optimisation des prix via le module **Prix**, et une
couche LLM (derrière une interface) pour la rédaction du descriptif — le calcul
restant déterministe.
