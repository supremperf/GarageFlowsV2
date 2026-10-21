# GarageFlows — Registre final des anomalies

**Date :** 2026-10-20 · Consolide les phases 1 à 4.

## Corrigées et vérifiées

| # | Anomalie | Gravité | Preuve de correction |
|---|---|---|---|
| A-01 | `.env.example` local était une copie du `.env` (36 secrets) | P0 → **P2** | Corrigé. Gravité revue : le `.env.example` **versionné** du dépôt est propre (4 variables, secrets vides) et l'historique git n'a jamais porté de secret. Le risque était local, pas public. |
| A-03 | `verify-rotation` ne s'exécutait jamais sous Windows | P1 | `pathToFileURL` ; 3 tests sur le point d'entrée ; régression réintroduite → 2 échecs |
| A-03b | `verify:rotation` appelé par aucune porte | P1 | Étape obligatoire dans `final-release-gate.mjs` |
| A-04 | Le keygen CLI signait avec une clé orpheline, sans avertir | P1 | 4 chemins refusent (exit 3) ; génération toujours possible sur autorité cohérente |
| A-05 | `docs-consistency` jugeait sur un dépôt englobant | P2 | Garde `racineDeDepot()` ; 5/5 |
| A-06 | Manifeste de release empruntant le commit d'un autre dépôt | P1 | `git: null` + note explicite hors dépôt |
| V-01 | Aucune variable déclarée sur Vercel | P0 | **`check-env-vercel` production → exit 0**, 10/10 |
| V-02 | Preview pouvait écrire dans les données clients | P0 | Base Neon dédiée + garde `verifierIsolationPreview` + 11 tests négatifs |
| V-04 | Aucune tâche planifiée | P1 → **P2** | `vercel.json` + 7 tests. Gravité revue : une seule tâche manquait réellement, pas quatre. |
| V-05 | `check-env-vercel` aveugle au défaut V-01 | P1 | 3 défauts corrigés ; rapporte désormais le vrai constat |
| — | 10 secrets PostgreSQL compromis | P0 | **Roté sans coupure** : rôle `gf_app`, testé en lecture et écriture |
| — | `/api/admin/licenses` sans limiteur de débit | P3 | Limiteur ajouté, aligné sur les 5 routes sœurs |
| — | `installer-shortcuts` échouait sur tout clone Windows | P2 | Fins de ligne normalisées ; 9/9 |

## Ouvertes — action fournisseur ou propriétaire

| # | Anomalie | Gravité | Ce qui manque |
|---|---|---|---|
| — | `BLOB_READ_WRITE_TOKEN` encore compromis | **P0** | Révocation via la console Vercel Storage (non exposée au CLI) |
| V-03 | 5 routes absentes de la production | P0 | Un redéploiement, après Preview validé |
| — | Upstash Preview | P1 | Finalisation navigateur (conditions Marketplace) |
| A-08 | `api_key` du keygen ≠ `GARAGEFLOW_API_KEY` | P2 | Aligner depuis Vercel ; savoir laquelle est la bonne |
| V-06 | `validateEnv` ne couvre que 5 des 9 variables | P1 | Faire dériver la liste du manifeste |
| V-07 | Node 24 sur Vercel vs `engines <23` | P2 | Fixer Vercel sur 22.x |
| V-09 | 4 intégrations orphelines + résidu `upstashnewv5` | P2 | Nettoyage console |
| V-10 | Fonctions et base de production aux USA | P2 | Arbitrage RGPD (la base Preview est en UE) |
| V-11 | 5 variables Upstash inconnues du manifeste | P2 | Les déclarer `platformProvided`, ou les bannir |
| — | Compteur de débit partagé entre 8 routes sync | P2 | Auto-blocage d'un poste démontrable ; à re-vérifier avant correction |
| — | Coût d'achat accessible sans `financial:read` | P2 | 4 portes du stock ; à re-vérifier |
| — | GF31-AUD-050 incomplet (prix non numérique → 0 €) | P2 | Appliqué à `bulk-import` seulement |
| — | Portail : énumération de comptes, 2FA sans ré-auth | P2 | À re-vérifier avant correction |
| — | `/api/internal/migrate` sans garde moteur ni `catch` | P3 | — |
| — | `synchro-voie-de-retour` instable | P3 | 1 échec sur 3 passes complètes ; cause non élucidée |
| — | 1 vulnérabilité Dependabot modérée | P3 | Signalée par GitHub au push |

## Écartées après vérification

| # | Constat initial | Pourquoi écarté |
|---|---|---|
| V-08 | Repli SQLite silencieux de `db.ts` | Neutralisé en amont par `assertEnv`, présent dans l'artefact compilé |
| — | `GET /api/admin/licenses` exfiltre tous les jetons | Le jeton y est exposé **à dessein** : la console admin l'affiche pour le transmettre au client. Restreindre le `select` aurait cassé la fonction. |
| — | Divergence de schéma `Client` desktop/serveur | Mon erreur de test : les deux portent `name`. Le test de parité passe (6/6). |

## Points de méthode

Trois constats ont été **rectifiés à la baisse** après vérification (A-01, V-04,
et celui sur `/api/admin/licenses`), et un **écarté** (V-08). Un rapport d'audit
qui ne corrige jamais ses propres constats n'est pas fiable ; ceux-ci l'ont été
avant d'être présentés comme acquis.

La vérification adversariale automatisée n'a pas pu tourner (limite de session) :
les constats marqués « à re-vérifier » reposent sur une seule lecture.
