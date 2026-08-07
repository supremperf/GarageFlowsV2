# FINAL BASELINE PRE-V13 — état vérifié avant l'intervention V13

> Baseline de la règle « zéro régression » : chaque résultat ci-dessous provient
> d'une commande **réellement exécutée** à la date indiquée, dans l'environnement
> décrit. Aucun chiffre recopié d'un document antérieur.

## 1. Identité

| Champ | Valeur |
|---|---|
| Produit | GarageFlows |
| Version (package.json) | 1.1.0 |
| Commit (SHA) | `1e45128f84d1524eb5fcca2316d6e69bccab76d3` |
| Branche | `claude/garageflow-final-unified-merge-ub0l67` |
| Date UTC | 2026-08-07T10:40Z – 10:50Z |
| OS | Linux 6.18.5 (conteneur d'audit) |
| Node / npm | v22.22.2 / 10.9.7 |
| TypeScript | ^5 (5.9.3) |
| Next.js | ^14.2.35 |
| Electron | ^31.7.7 |
| Prisma | ^5.16.1 (client 5.22.0) |
| PostgreSQL local d'audit | 16.13 (cluster jetable, port 54329) |
| Dépôt compagnon | garagesite3 `3405bcd`, arbre propre |
| git status | **propre** (0 modification) sur les deux dépôts |

## 2. Résultats exécutés (état AVANT V13)

| Contrôle | Commande | Résultat |
|---|---|---|
| TypeScript | `npx tsc --noEmit` | **0 erreur** |
| Lint | `npx next lint` | **0 avertissement, 0 erreur** |
| Tests (suite standard) | `npm test` | **112 suites vertes / 5 conditionnelles**, **1301 tests verts, 0 échec, 28 skippés** (1329) |
| Suites conditionnelles PG ×4 | `TEST_POSTGRES_URL=… vitest run` (numbering, stock, license-devices, licensed-session) | **exécutées : 21 tests verts** (PostgreSQL 16.13 réel) |
| Suite conditionnelle Redis | `TEST_REDIS_URL=… vitest run rate-limit-multi-instance` | **exécutée : 5 tests verts** (redis-server local) |
| Skips restants | — | `public-key-consistency` : 1 cas gated par un jeton de licence réel (poste opérateur) ; reste = cas gated environnement déjà couverts ci-dessus |
| Gardes de cohérence | `npm run check:consistency` | **10/10 vertes** (branding, docs, PWA, monnaie ×3, migrations ×3, fichiers critiques) |
| Build production | `npm run build` | **OK** — 16 pages générées |
| Budget de perf | `npm run check:perf-budget` | **OK** — total < 3,00 MiB ; plus gros chunk 435,0 KiB < 512 KiB |
| Audit dépendances prod | `node scripts/audit-ci.js` | **OK** — 0 high/critical non dérogée (1 dérogation documentée : postcss, réexamen avant 2026-10-31) |
| Migrations PG sur base neuve | `validate-server-db.js` (base créée à vide) | **OK** — migrations appliquées, contraintes + cascade vérifiées, smoke test CRUD |

## 3. Revalidations directes (sans confiance dans les rapports antérieurs)

- **Float monétaires** : `grep Float` sur les DEUX schémas Prisma → uniquement
  `taxRate Float` (4 modèles × 2 schémas). **Un taux de TVA n'est pas un
  montant** : tous les montants sont en entiers (centimes ou dix-millièmes).
  Convention documentée ; gardée par `check:money-fields` (zéro Float monétaire).
- **Electron** : les 3 `BrowserWindow` observés dans `electron/main.js` portent
  `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`,
  `webSecurity: true` (lignes 1678, 1708-1711, 1786-1789). Aucun `eval`/`new
  Function` dans `electron/`. Fuses planifiées dans `scripts/fuse-config.js`
  (appliquées au packaging par `afterPack`).
- **En-têtes de sécurité** : `next.config.mjs` définit CSP (avec
  `frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`,
  `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security`.
- **Secrets — fichiers suivis** : gitleaks 8.24.3 sur `git archive HEAD`
  (fichiers suivis uniquement) → **0 fuite** (V2 et site3).
- **Secrets — arbre de travail** : 14 alertes, toutes dans `.next/` (artefacts
  de build non suivis : clés preview aléatoires régénérées à chaque build) —
  **faux positifs classés**, aucun fichier suivi concerné.
- **Secrets — historique git complet** : V2 4 occurrences
  (`keys/server_config.json`, `keys/licenses_db.json`) ; site3 5 occurrences
  (anciens `.env.local`). **Toutes correspondent aux sources déjà recensées**
  dans `scripts/compromised-secrets.json` (empreintes SHA-256) — considérées
  compromises, rotation outillée par `npm run verify:rotation`, purge
  d'historique = décision propriétaire (non destructif sans autorisation).
  **Aucun secret nouveau découvert.**

## 4. Limites de l'environnement (ce que cette baseline ne prouve PAS)

- Pas de build/installation **Windows réels** (conteneur Linux) — packaging,
  Authenticode, SmartScreen : poste opérateur requis.
- Pas d'accès aux environnements **Neon/Vercel/Upstash de production** — les
  preuves PG/Redis utilisent des instances locales jetables équivalentes.
- Pas de test de **charge** sur infrastructure réelle.
- Validations juridiques/comptables/réglementaires : hors de portée du code
  (voir `docs/data-room/09-risks/EXTERNAL_VALIDATIONS.md`).

Cette baseline sert de point de comparaison : la V13 ne doit dégrader **aucun**
de ces résultats.
