# Budget de performance — bundle client (GarageFlows)

Ce document fixe un **budget de poids du JavaScript client** et décrit son
contrôle **automatique** en CI. Objectif : empêcher une régression silencieuse
du temps de chargement (surtout sur mobile / connexions lentes d'atelier).

## 1. Mesure de référence (2026-08-07)

Mesurée sur la sortie réelle de `next build` (production), en octets bruts sur
disque sous `.next/static/**.js` :

| Indicateur | Brut | Gzip (informatif) |
|---|---|---|
| **Total JS client** | 2,58 MiB (2 709 219 o) | 0,76 MiB (794 328 o) |
| **Plus gros chunk** (`app/page-*.js`) | 434,4 KiB (444 849 o) | 99,6 KiB (102 015 o) |
| Fichiers `.js` scannés | 42 | — |

Le plus gros chunk est la **page atelier/planning** (`app/page`), la plus riche
en interactions (modales, planning, assistant). Les autres chunks sont nettement
plus légers.

## 2. Budgets fixés (`perf-budget.json`)

| Budget | Valeur | Marge vs référence |
|---|---|---|
| `totalClientJsBytes` | 3 145 728 o (3,00 MiB) | ~ +16 % |
| `largestChunkBytes` | 524 288 o (512 KiB) | ~ +18 % |

La marge absorbe les variations mineures (dépendances patch, ajouts modestes)
sans masquer une vraie régression. **Relever un budget est une décision assumée**
qui se voit dans l'historique Git de `perf-budget.json`.

## 3. Contrôle automatique

- Script : `scripts/check-perf-budget.mjs` — commande `npm run check:perf-budget`.
- Unité : **octets bruts sur disque** (déterministes, indépendants de la version
  de zlib — contrairement au gzip, qui reste indiqué à titre informatif).
- **Fail-closed** : si `.next/static` est absent, le contrôle **échoue** (il faut
  `npm run build` d'abord). Un budget non mesuré n'est jamais réputé « respecté ».
- **CI** : étape « Performance budget (client bundle) » exécutée **après** le
  build (`.github/workflows/ci.yml`). Non incluse dans `check:consistency` (qui
  tourne sans build).

### Preuves d'efficacité (reproductibles)

```bash
npm run build                 # produit .next/static
npm run check:perf-budget     # ✅ 2,58 MiB < 3,00 MiB ; 434,4 KiB < 512 KiB → exit 0
```

Test négatif (le garde-fou détecte bien une régression) : en abaissant
temporairement les budgets à 0,95 MiB / 97,7 KiB, le script échoue (exit 1) en
listant les deux dépassements. Vérifié le 2026-08-07.

## 4. Comment rester dans le budget

- Préférer les **imports dynamiques** (`next/dynamic`) pour les modales et vues
  lourdes non nécessaires au premier rendu.
- Surveiller les dépendances ajoutées (`npm ls --prod`, taille transitive).
- Éviter d'importer une bibliothèque entière pour une seule fonction.
- Réserver les gros composants (éditeurs, graphes) aux routes qui les utilisent.

## 5. Limites

- Le budget porte sur le **poids du bundle**, pas sur des métriques d'exécution
  (LCP, TBT, INP) : celles-ci nécessitent une instance déployée + un outil de
  mesure terrain (Lighthouse/CrUX), à brancher au déploiement.
- Les octets bruts surestiment le poids réellement transféré (le serveur envoie
  du gzip/brotli) ; ils sont choisis pour leur **déterminisme** en CI, la colonne
  gzip donnant l'ordre de grandeur réel.
