# Import de données CSV — guide (état réel)

_Décrit le mécanisme **réellement implémenté et testé** (`src/lib/import/*`,
`POST /api/import`). Voir aussi `DATA_MIGRATION_GUIDE.md` (vue diligence)._

## Ce qui existe (code + tests)
- **Analyseur CSV natif** (RFC 4180, sans dépendance) : guillemets, `""` échappés,
  virgules et sauts de ligne dans les champs, CRLF/LF, BOM UTF-8.
- **Mapping colonnes → champs** : auto-déduction par en-têtes (alias FR/EN) ou
  mapping explicite fourni par l'appelant.
- **Entités supportées** : **clients** (nom, téléphone, e-mail, adresse) et
  **pièces** (référence, désignation, quantité, seuil, coût, prix, emplacement).
- **Validation** par les schémas Zod du projet (mêmes règles que la saisie
  manuelle).
- **Détection de doublons** : dans le fichier ET vs l'existant (client par e-mail
  sinon nom+téléphone ; pièce par référence sinon nom), scopée `garageId`.
- **Exécution à blanc (dry-run)** : renvoie un plan (à créer, doublons fichier,
  doublons existants, cellules neutralisées, erreurs par ligne) **sans écrire**.
- **Exécution transactionnelle** : rechargement des clés existantes DANS la
  transaction (anti-course), création `createMany` strictement scopée `garageId`.
- **Protection anti-injection de formules** : chaque cellule commençant par
  `= @` ou un caractère de contrôle est neutralisée (préfixe `'`) ; `+ -` en tête
  ne sont neutralisés que si la valeur contient une lettre (charge utile), pour
  **préserver** les numéros de téléphone et les nombres.
- **Bornes anti-DoS** : 5000 lignes / 5 Mo par import.
- **Tests** : `src/lib/import/__tests__/*` (parseur, sanitisation, planification)
  + `src/integration/import.test.ts` (exécution réelle, dry-run sans écriture,
  dédoublonnage, injection stockée neutralisée, **isolation multi-tenant**).

## Utilisation (API)
`POST /api/import` (propriétaire). Body :
```json
{ "entity": "clients", "csv": "nom,email\nJean,jean@x.fr", "dryRun": true }
```
- `dryRun: true` (défaut) → `{ mapping, plan }` à présenter avant validation.
- `dryRun: false` → exécute et renvoie `{ created, plan }`.
- `mapping` optionnel : `{ "name": 0, "email": 2, ... }` (index de colonne).

## Réserves (honnêteté)
- **XLSX** : l'import natif prend du **CSV**. Un fichier Excel/LibreOffice doit
  être « Enregistré sous → CSV UTF-8 » (opération standard en un clic). Le
  support **XLSX direct** nécessiterait une bibliothèque tierce et n'est **pas**
  implémenté (pas de fausse promesse dans le code).
- **Entités** : clients et pièces sont couvertes (les imports en volume les plus
  courants). Véhicules/factures ne sont pas encore câblés dans l'assistant.
- **Assistant graphique** : l'API (aperçu dry-run + exécution) est complète ; un
  **écran d'import guidé** (téléversement, aperçu du mapping, confirmation) reste
  à construire côté UI.
