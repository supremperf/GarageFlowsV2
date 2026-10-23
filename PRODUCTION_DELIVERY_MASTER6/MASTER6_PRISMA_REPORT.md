---
doc-numbers: journal
---

# PRISMA — rapport MASTER 6

**Verdict : PASS, sans régression.** Les acquis MASTER 5 ont été revérifiés sur l'arbre intégré ; aucun nouveau travail n'était nécessaire.

## 1. Pourquoi ce rapport est court

MASTER 5 avait entièrement résolu le blocage Prisma : moteurs officiels obtenus par le canal officiel avec TLS vérifié, deux clients générés, 10/10 opérations réelles sur Windows **et** sur Linux. Le mandat MASTER 6 demande explicitement de ne pas refaire ce qui est déjà prouvé et toujours valide.

Les contrôles ci-dessous confirment que rien n'a régressé.

## 2. Versions et moteurs

```
prisma                  : 5.22.0
@prisma/client          : 5.22.0
Computed binaryTarget   : windows
Query Engine (Node-API) : libquery-engine 605197351a3c8bdd595af2d2a9bc3025bca48ea2
Schema Engine           : schema-engine-cli 605197351a3c8bdd595af2d2a9bc3025bca48ea2
```

Deux clients générés : `node_modules/@prisma/client` (desktop, SQLite) et `src/generated/server-client` (serveur, PostgreSQL, avec les moteurs `debian-openssl-3.0.x` et `rhel-openssl-3.0.x` du déploiement).

## 3. Contrôles rejoués en MASTER 6

| Contrôle | Résultat |
|---|---|
| `prisma generate` ×2 pendant `npm run build` | **OK** — exécuté à chaque build de la porte |
| migrations serveur sur base **vierge** + smoke test | **OK** — 22/22, via `release:gate` |
| 4 suites d'intégration PostgreSQL (numérotation, stock, licences, sessions) | **OK** — contre PostgreSQL 17.11 jetable |
| 50 créations de factures **en parallèle** | **OK** — 50 numéros distincts et contigus |
| migrations appliquées sur la base de **staging** Neon | **OK** — 48 tables dans `public`, PostgreSQL 18.6 |
| base SQLite de recette créée et seedée (`db push` + seed) | **OK** |
| opérations CRUD réelles via les API HTTP | **OK** — voir `MASTER6_FUNCTIONAL_AUDIT.md` |

## 4. Schémas inchangés

`prisma/schema.prisma` (43 modèles) et `prisma/server/schema.prisma` (22 migrations) **n'ont pas été modifiés** par MASTER 6 — vérifié : 0 fichier différent sous `prisma/` entre l'arbre validé et l'arbre intégré.

Deux propositions de migration **additives** sont formulées sans être appliquées (`archivedAt` sur `Client`/`Vehicle`, auteur sur `StockMovement`) : voir `MASTER6_FUNCTIONAL_AUDIT.md`.

## 5. `prisma/dev.db`

**Non réinitialisée.** Aucune opération destructive. Les bases de travail créées pendant la mission sont toutes jetables et distinctes : `prisma/m6-e2e.db` (copie de recette), bases `gf_*` sur les conteneurs locaux.
