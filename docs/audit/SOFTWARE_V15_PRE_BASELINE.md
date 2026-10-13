<!-- doc-numbers: journal -->
<!-- doc-status: actif -->

# Software V15 — baseline avant durcissement

> Journal. État courant faisant foi : `FINAL_VERIFICATION_BASELINE.md` /
> `artifacts/verification/baseline.json`.

| Champ | Valeur |
|---|---|
| Commit de départ | `f314850` |
| Branche | `claude/garageflow-final-unified-merge-ub0l67` |
| git status | propre (0 modification) |
| Date UTC | 2026-08-07 |
| Node / npm | v22.22.2 / 10.9.7 |
| Next / Prisma / Electron / TS | 14.2.35 / 5.22.0 / 31.7.7 / 5.9.3 |

## Résultats ré-exécutés (avant V15)

- `tsc --noEmit` : **0 erreur**
- `next lint` : **0**
- Tests (baseline.json, suite standard) : **1332 / 1360 (28 ignorés), 0 échec**
- Conditionnels réels : PostgreSQL 21 verts + Redis 5 verts
- `release:gate` : **11/11 OK** (V13.1)

## Acquis des passes précédentes (à NE PAS refaire)

Déjà construit et prouvé : matrice d'isolation tenant (63 tests + audit statique
141 routes, 0 faille), matrice RBAC 128 cellules, concurrence numérotation +
stock sur PostgreSQL réel, CSP prod sans `unsafe-eval` + garde d'en-têtes,
E2E métier 13 étapes via vrais handlers, Electron durci (baseline), PWA gardée,
0 Float monétaire (3 gardes), immuabilité facture testée, portail à jeton de
capacité testé, e-invoicing formats validés XSD.

## Cible V15

Trouver et corriger les faiblesses logicielles **restantes** (pas de redite) :
mass-assignment, validation d'entrée IPC/API, licenseId-as-auth, open-redirect,
CSV formula injection, RBAC mécanicien E2E, idempotence paiements, dette
technique — avec preuve reproductible pour chaque correction.
