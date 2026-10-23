---
doc-numbers: journal
---

# VITEST — état final MASTER 5

**Verdict : RÉSOLU.** 365 fichiers, **0 fichier en échec**, 4 424 tests dont **4 390 réussis, 0 échoué, 34 ignorés** — les 34 ignorés sont inventoriés un par un et justifiés ci-dessous.

## 1. Comparaison avec MASTER 4

| | MASTER 4 | MASTER 5 |
|---|---:|---:|
| fichiers de test | 365 | 365 |
| fichiers **rouges** | **84** | **0** |
| tests réussis | 3 517 | **4 390** |
| tests échoués | 3 | **0** |
| tests ignorés | **869** | **34** |

Preuves : `MASTER5_EVIDENCE/logs/16-vitest-run2.txt`, `artifacts/verification/test-results.json`, `artifacts/verification/baseline.json`.

## 2. Les 84 fichiers rouges : une cause unique, aucune suppression

La classification MASTER 4 (`vitest-failure-classification.json`) répartissait les 84 fichiers en **79 « Prisma natif »** et **5 « client serveur »**, 0 « autre ». Les deux catégories ont la même cause : le client Prisma n'était pas généré faute de moteurs.

Dès les moteurs rétablis (voir `PRISMA_FINAL.md`), ces 84 fichiers s'exécutent. **Aucun test n'a été supprimé, ignoré, désactivé ni réécrit** pour obtenir ce résultat. La chute de 869 à 34 ignorés vient du même fait : les suites d'intégration qui construisaient une base SQLite via `prisma db push` se contentaient de se déclarer `skipped`.

## 3. Les 3 tests échoués : deux assertions obsolètes et un contrôle inerte

### 3.1 `src/integration/purchase-order-receive-returned.test.ts:142`

```
expect(src).toContain("fetch('/api/purchase-orders')")
```

Le composant `src/components/SuppliersPanel.tsx:41` contient `fetch('/api/purchase-orders', { signal })` — un `AbortSignal` a été ajouté pour annuler la requête au démontage. L'assertion exigeait la chaîne **exacte sans argument** : elle échouait sur du code CORRECT, et la seule façon de la verdir sans la corriger aurait été de **retirer l'annulation**.

Correction : l'assertion porte désormais sur l'APPEL, pas sur sa forme littérale.

```js
expect(src).toMatch(/fetch\('\/api\/purchase-orders'\s*(?:,|\))/)
```

La garantie reste identique : la liste des bons existants est bien chargée. Les trois autres assertions du test (route de réception, `method: 'POST'`, `setErreurReception`) sont inchangées.

### 3.2 `src/lib/__tests__/secrets-jamais-distribues.test.ts:105-111` (GF-DUR-044)

Deux échecs successifs, même famille :

```
expect(scan.trackedFileCount).toBeGreaterThan(1000)   → reçu 0
expect(scan.trackedPaths).toContain('.env.example')   → absent
```

**Premier** : le contrôle s'appuie sur `git ls-files`. Le dossier n'était suivi par aucun dépôt — le dépôt englobant était enraciné sur le dossier utilisateur et ne suivait aucun fichier GarageFlows. Le contrôle **n'inspectait rien** tout en passant ses assertions de contenu. Corrigé par l'initialisation d'un dépôt dédié (autorisée) : 2 864 fichiers suivis, le contrôle inspecte réellement.

**Second** : `.env.example` était **exclu par `.gitignore`**. Le fichier déclare pourtant explicitement `!.env.example` à la ligne 157, mais quatre motifs `.env*` apparaissent PLUS BAS (lignes 119, 137, 184, 193) — et dans un `.gitignore`, c'est le dernier motif correspondant qui décide. `vercel link` en ajoute un à chaque exécution, avec `.vercel`. Résultat : 28 ko de contrat d'environnement documenté, sans aucune valeur, que `git add -A` ne prenait jamais.

Correction : un bloc final, commenté, réaffirme `!.env.example` et `!.env.*.example` **après** tous les motifs `.env*`, avec la consigne de le maintenir en dernière position. Vérifié : `.env.example` et `.env.storage.example` suivis ; `.env`, `.env.local`, `.vercel` toujours ignorés.

### 3.3 `src/lib/__tests__/keygen-activation-roundtrip.test.ts` — fichier en erreur, non déterministe

```
Error: spawnSync python3 ETIMEDOUT   (timeout: 10000 ms, signal SIGTERM)
  at runPython (scripts/reproduce-keygen-roundtrip.mjs:35)
```

Le délai de 10 s était un garde-fou contre un blocage, pas une mesure de performance. Lancé seul, le scénario tient en **~5 s**. Lancé avec les 365 fichiers de la suite en parallèle, le **premier** démarrage de l'interpréteur (alias d'exécution Windows Store + import de `cryptography`) dépassait 10 s et faisait échouer **tout le fichier** — 10 tests, aucun exécuté, de façon non déterministe.

Corrections :
- délai porté à 60 s, avec la justification en commentaire (même cause et même remède que le `hookTimeout: 30_000` déjà présent dans `vitest.config.mts`) ;
- résolution de l'interpréteur élargie aux formes Windows : `.venv/Scripts/python.exe`, puis `python3`, puis `python`, chacune sondée avant usage.

Un vrai blocage reste détecté : la limite est franche, simplement compatible avec une machine chargée.

## 4. Les 34 tests ignorés — inventaire complet

| Fichier | Nb | Raison exacte |
|---|---:|---|
| `license-devices.postgres.int.test.ts` | 15 | `TEST_POSTGRES_URL` neutralisé pour le passage STANDARD |
| `licensed-session.postgres.int.test.ts` | 6 | idem |
| `rate-limit-multi-instance.int.test.ts` | 5 | `TEST_REDIS_URL` neutralisé pour le passage STANDARD |
| `document-numbering.postgres.int.test.ts` | 1 | `TEST_POSTGRES_URL` neutralisé |
| `stock-concurrency.postgres.int.test.ts` | 1 | idem |
| `license/__tests__/forgery-resistance.test.ts` | 4 | `keys/private.pem` absent (`SANS_CLE`) |
| `license/__tests__/public-key-consistency.test.ts` | 2 | `GF_TEST_LICENSE` (jeton GF2 réel) non fourni |

**28 des 34** correspondent aux suites conditionnelles de service. Elles ne sont PAS comptées vertes dans ce passage — et elles ont été **exécutées séparément** par `npm run release:gate` contre un vrai PostgreSQL et un vrai Redis, où elles passent (voir `RELEASE_GATE_FINAL.md`). Cette séparation est voulue par la porte elle-même : la baseline machine doit décrire la suite reproductible partout, sans service externe.

**6 des 34** dépendent de la clé privée d'émission de licences, absente de ce poste. La propriété qu'ils vérifient est néanmoins démontrée par `scripts/reproduce-keygen-roundtrip.mjs` avec une paire de fixtures éphémère — 19/19, licence altérée, clé étrangère, expiration, `exp` manquant, version non gérée, substitution d'algorithme et courbe incorrecte comprises (voir `LICENCES_CRYPTO_FINAL.md`).

## 5. Ce qui n'a pas été fait

- aucun test supprimé ;
- aucun test échoué transformé en ignoré ;
- aucune assertion affaiblie : la seule assertion réécrite (3.1) garde la même garantie et cesse d'interdire une amélioration du produit ;
- aucune suite désactivée ;
- aucune configuration permissive (`vitest.config.mts` inchangé).

## 6. Confirmation indépendante

`npm run release:gate` rejoue la suite complète et régénère la baseline :

```
▶ Suite de tests (vitest) + baseline machine + baseline humaine… OK (52s)
▶ Cohérence documentaire (post-baseline)… OK (1s)
```

Le second contrôle échouerait si un document du dépôt annonçait un compte de tests divergent des mesures réelles.
