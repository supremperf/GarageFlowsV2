<!-- doc-numbers: journal -->
<!-- doc-status: actif -->

# V13.1 — Baseline AVANT correction (Phase 0)

> État capturé au démarrage de l'intervention V13.1, avant toute modification.
> Journal (comptes datés). L'état COURANT faisant foi est la baseline
> canonique `FINAL_VERIFICATION_BASELINE.md`.

| Champ | Valeur |
|---|---|
| Commit de départ | `c3fb30497bf3107450c75b1f8f39246a172e8b63` (`c3fb304`) |
| Branche | `claude/garageflow-final-unified-merge-ub0l67` |
| git status | propre (0 modification) — dépôt compagnon garagesite3 `3405bcd` propre |
| Date UTC | 2026-08-07 |
| Node / npm | v22.22.2 / 10.9.7 |
| Next.js / Prisma / Electron / TS | 14.2.35 / 5.22.0 / 31.7.7 / 5.9.3 |
| PostgreSQL (audit) | 16.13 (cluster local, redémarré) |
| Fichiers de tests | 119 (suite standard vitest) |

## Résultats ré-exécutés (avant fix)

- `tsc --noEmit` : **0 erreur**
- `next lint` : **0**
- `npm test` : **1323 passés / 1351 (28 ignorés), 0 échec**
- `check:consistency` : **10/10** (garde docs = version pré-V13.1)
- `build` : **OK** (16 pages) ; budget perf OK
- `audit-ci` : OK (1 dérogation datée : postcss)
- migrations PG base neuve : OK

## Incohérence principale identifiée (motif de la V13.1)

**Double source de vérité** : `docs/PRODUCTION-READINESS.md` (« seule source de
vérité », chiffres 2026-08-06 : 1 040/1 059) ET
`docs/audit/FINAL_VERIFICATION_BASELINE.md` (« source de vérité unique », V13)
se déclaraient tous deux canoniques. Résolu en V13.1 (cf. commit de source
canonique unique).

## Scripts disponibles au départ

type-check, lint, test, build, check:branding/docs/pwa/money(×3)/migration-safety/
sqlite-template/pg-migrations/critical-files/perf-budget, check:consistency,
verify:rotation, release:gate, demo:seed/reset/wipe.
