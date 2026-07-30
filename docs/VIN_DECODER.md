# Module Premium — Décodage VIN intelligent

Moteur de décodage VIN **offline-first**, extensible à plusieurs fournisseurs,
avec cache, validation, fallback et historique. Conforme à ISO 3779 / ISO 3780.
Aucun service externe n'est requis pour un décodage utile.

## Architecture

```
src/lib/vin/
├── types.ts        # VinInfo, VinDecodeResult, VinValidation
├── constants.ts    # Données ISO : translittération, poids, cycle des millésimes,
│                   #   régions/pays, table WMI→constructeur (curée, hors-ligne)
├── validate.ts     # normalizeVin, isValidVinFormat, computeCheckDigit, validateVin
├── decode.ts       # decodeVinOffline (WMI, pays, région, millésime, série…)
├── providers.ts    # VinProvider · OfflineProvider · NhtsaProvider (optionnel, réseau)
├── engine.ts       # VinEngine : chaîne de fournisseurs + cache TTL + verdict
└── index.ts        # point d'entrée + singleton `vinEngine`
```

### Ce qui est décodé (100 % hors-ligne, déterministe)
- **WMI** (positions 1–3) → constructeur (table curée) ;
- **Pays** de fabrication (ISO 3780, 2 premiers caractères) ;
- **Région** (1ᵉʳ caractère) ;
- **Millésime** (position 10) avec désambiguïsation du cycle 30 ans via la
  position 7 (lettre → cycle 2010+, chiffre → cycle 1980–2009) ;
- **Code usine** (position 11) et **numéro de série** (12–17) ;
- **Chiffre de contrôle** (position 9) : calcul + validité (obligatoire en
  Amérique du Nord, souvent non conforme en Europe → signalé en avertissement,
  jamais bloquant).

### Extensibilité multi-fournisseurs
`VinProvider` est une interface simple. La chaîne par défaut est `[OfflineProvider]`
(sans réseau). Pour enrichir (make/model/moteur…) là où le réseau sort :

```ts
import { VinEngine, OfflineProvider, NhtsaProvider } from '@/lib/vin'
const engine = new VinEngine({ providers: [new OfflineProvider(), new NhtsaProvider()] })
```

Les données d'un fournisseur sont **fusionnées par-dessus** la base hors-ligne
(champs non nuls prioritaires) ; un fournisseur en échec n'interrompt jamais la
chaîne. Le `source` et la `confidence` reflètent la provenance.

### Cache
`MemoryVinCache` (Map bornée, TTL 24 h, éviction FIFO) par défaut — adapté au
serveur mono-process Electron. Interface `VinCache` pour brancher Redis en web.

## API

- `GET /api/vin?vin=<VIN>` — décode le VIN (authentifié, rate-limité 30/min/garage)
  et enregistre la recherche. `400` avec `validation` détaillée si le VIN est mal formé.
- `GET /api/vin` — renvoie l'historique récent (25 dernières recherches du garage).

Exemple :
```json
{
  "vin": "1HGCM82633A004352",
  "manufacturer": "Honda (US)",
  "country": "États-Unis",
  "region": "Amérique du Nord",
  "modelYear": 2003,
  "modelYearCandidates": [2003],
  "checkDigitValid": true,
  "source": "offline",
  "confidence": "high",
  "warnings": []
}
```

## Persistance / migration
Ajoute le modèle Prisma **`VinSearch`** (+ relation `Garage.vinSearches`, index
`[garageId, createdAt]` et `[garageId, vin]`). Appliquer via `npm run db:push`
(ou une migration) avant utilisation en production, et régénérer le template DB.

## Tests
`src/lib/vin/__tests__/vin.test.ts` — 17 tests : validation, chiffre de contrôle
(exemples canoniques), cycle des millésimes, décodage complet (Amérique du Nord
et Europe), cache, fusion fournisseur, résilience aux pannes de fournisseur.
