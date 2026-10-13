<!-- doc-numbers: journal -->
<!-- Journal de mesures DATÉES : chaque compte de tests cité est le résultat
     d'une exécution horodatée de cet audit, et non une revendication d'état
     courant. L'état courant fait foi dans docs/audit/FINAL_VERIFICATION_BASELINE.md. -->

# BASELINE IMMUABLE — Master Software Assurance Program (MSAP)

> Instantané pris **avant toute modification**. Ce fichier ne doit plus être
> réécrit : les états ultérieurs vont dans `WORKLOG.md` et `FINDINGS.md`.
> Les rapports historiques du dépôt (`AUDIT_RAPPORT.md`, `FINAL_*.md`,
> `BASELINE.md` racine, `docs/audit/*`) sont traités comme de l'**information
> historique**, jamais comme une preuve courante (§2).

## 1. Environnement

| Élément | Valeur mesurée |
|---|---|
| Date | 2026-08-12 |
| OS | Windows 10 Home 10.0.19045 (win32) |
| Architecture | x64 |
| Node | v22.23.2 |
| npm | 10.9.8 |
| Python | 3.14.6 |
| Paquets installés | 591 (`npm ci` rejoué — voir §2.1) |

### 1.1 Deux emplacements distincts

| Rôle | Chemin |
|---|---|
| Environnement de build/exécution (répertoire de travail) | `C:\Users\Mathys\Desktop\GarageFlowsV2-claude-garageflow-final-unified-merge-ub0l67` — **n'est pas un dépôt git** |
| Dépôt git réel | `C:\Users\Mathys\.claude\jobs\2a11bc5b\tmp\repo` |

| Élément git | Valeur |
|---|---|
| Branche | `claude/garageflow-final-unified-merge-ub0l67` |
| HEAD | `e0a2ef79e824b08f74612a3a8fe48885a97847b7` |
| `git status` | arbre propre (aucune modification en attente) |

**Vérification d'équivalence.** Comparaison fichier à fichier des deux
emplacements, retours chariot normalisés (`tr -d '\r'`), en excluant
`node_modules`, `.next`, `dist`, `artifacts` :

```
TOTAL REAL DIFFS = 10
  scripts/__pycache__/*.pyc            (2)  — cache Python
  src/generated/server-client/*        (7)  — client Prisma régénéré
  tsconfig.tsbuildinfo                 (1)  — cache TypeScript
```

Aucune divergence de **code source**. Le répertoire de travail est donc une copie
fidèle de `e0a2ef7` ; tout constat y est opposable au dépôt.

### 1.2 État de configuration — environnement PROPRE, sans secret

| Constat | Conséquence |
|---|---|
| `.env` est **octet pour octet identique** à `.env.example` (23 481 o) | aucune valeur secrète réelle n'est présente |
| Le répertoire `keys/` **n'existe pas** dans l'environnement de travail | aucune clé de signature de licence disponible localement |

C'est la situation d'une **validation depuis un environnement propre** (§180).
Elle est notée ici parce qu'elle détermine ce qui est réellement testable : tout
test exigeant un identifiant réel (SMTP, provider e-facturation, base Neon de
production, PISTE) est `BLOCKED_EXTERNAL` dans cet environnement, et sera signalé
comme tel — jamais converti en `PASS` (§3).

## 2. Métriques recalculées (§5 — les chiffres annoncés ne sont qu'une indication)

| Élément | Annoncé dans le programme | **Mesuré** |
|---|---|---|
| Routes API (`src/app/api/**/route.ts`) | ~149 | **149** ✔ |
| Fichiers sous `src/` (`.ts`/`.tsx`) | ~629 | **626** |
| Fichiers de tests | ~178 | **178** ✔ |
| Scripts (`scripts/`) | ~60 | **58** |
| Modèles Prisma desktop | — | **42** |
| Modèles Prisma serveur | — | **46** |
| Migrations PostgreSQL (`prisma/server/migrations/`) | — | **16** |
| Migrations SQLite (`src/lib/migrations.ts`) | — | **202** entrées |
| Occurrences `skip`/`todo`/`skipIf` dans les tests | — | **20** (à justifier une par une, §142) |

Empreinte du code source auditée (concaténation triée de `src` + `electron` +
`prisma` + `scripts`, hors `src/generated`, CRLF normalisés) :

```
SHA-256 = df75f0c777b7bb2d4c99b858b87323b8fafcf8cf33970cfed7960af3dceb3c84
```

### 2.1 Incident d'environnement rencontré au démarrage

`node_modules` contenait **0 entrée** à l'ouverture de la session : un
`npm run dist` antérieur l'avait élagué (electron-builder). Les deux premières
tentatives de gate ont donc silencieusement exécuté des binaires téléchargés par
`npx` dans le cache npm, et non ceux du projet — `npx tsc` a répondu
« This is not the tsc command you are looking for » et `npx vitest` a échoué sur
un `MODULE_NOT_FOUND`. Corrigé par `npm ci` (591 paquets). **Aucun résultat de
gate antérieur à ce `npm ci` n'est retenu.**

## 3. Gates de référence — exécutés sur ce code, ce jour

| Gate | Commande | Code de sortie | Résultat |
|---|---|---|---|
| TypeScript | `npm run type-check` | 0 | **PASS** — 0 erreur |
| ESLint | `npm run lint` | 0 | **PASS** — « No ESLint warnings or errors » |
| Tests unitaires | `npm test` (vitest) | 1 | **FAIL** — 1 échec / 176 fichiers |

Détail de l'échec unique :

```
FAIL  src/lib/license/__tests__/forgery-resistance.test.ts
      > Clé embarquée > correspond à keys/public.pem (clé émettrice réelle)
Error: ENOENT: no such file or directory, open '…\keys\public.pem'
      at src/lib/license/__tests__/forgery-resistance.test.ts:90:17

 Test Files  1 failed | 170 passed | 5 skipped (176)
      Tests  1 failed | 1897 passed | 34 skipped (1932)
   Duration  28,44 s
```

Ce n'est **pas** un aléa d'environnement à écarter : `keys/*.pem` est ignoré par
git (`.gitignore:54`) et aucun fichier de `keys/` n'est suivi
(`git ls-files keys/` → vide). Le test est donc **structurellement condamné à
échouer sur tout clone neuf**, alors que ses cinq tests frères du même fichier
sont correctement gardés par `it.skipIf(SANS_CLE)`. Enregistré comme finding
(voir `FINDINGS.md`, GF31-AUD-001) et non comme bruit.

## 4. Périmètre effectivement testable dans cet environnement

| Domaine | Testable ici | Motif |
|---|---|---|
| Analyse statique, typage, lint, tests unitaires | OUI | — |
| Multi-tenant, autorisation, money, stock, concurrence (niveau intégration SQLite) | OUI | base locale synthétique |
| Signature/vérification de licence | PARTIEL | pas de `keys/` → paires générées à la volée dans les tests |
| SMTP réel, provider e-facturation réel, Neon de production, PISTE | NON | aucun identifiant — `BLOCKED_EXTERNAL` |
| Installateur Windows, fuses, raccourci bureau | OUI (Windows réel) | `npm run dist` disponible |

## 5. Documents historiques présents (à ne pas confondre avec des preuves)

`AUDIT_RAPPORT.md`, `AUDIT_TRACKER.md`, `BASELINE.md`, `CHANGELOG.md`,
`EXTERNAL_BLOCKERS.md`, `FINAL_ENTERPRISE_READINESS_REPORT.md`,
`FINAL_UNIFIED_GARAGEFLOW_REPORT.md`, `INITIAL_SHA256.txt`,
`REPOSITORY_INVENTORY.md`, `WORKLOG.md`, et l'arborescence `docs/`.

Aucun `FIXED` / `VERIFIED` / `PASS` de ces fichiers n'est repris sans
reproduction indépendante sur le code présent.
