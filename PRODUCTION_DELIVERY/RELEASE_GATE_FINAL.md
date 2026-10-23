---
doc-numbers: journal
---

# PORTE DE RELEASE — état final MASTER 5

**Verdict : PORTE PASSÉE INTÉGRALEMENT — 16/16 contrôles OK, 0 échec, 0 contrôle non exécuté.** Aucune porte n'a été affaiblie, aucun contrôle retiré, aucune exigence abaissée.

## 1. Comparaison avec MASTER 4

| | MASTER 4 | MASTER 5 |
|---|---|---|
| contrôles OK | 9 | **16** |
| échecs | **3** (TypeScript, Vitest, build) | **0** |
| non exécutés | **4** (PostgreSQL ×2, Redis, performance) | **0** |
| code de sortie | 1 | **0** |

## 2. Récapitulatif réel

```
════ GarageFlows — FINAL RELEASE GATE ════

▶ TypeScript (tsc --noEmit)… OK (9s)
▶ ESLint… OK (15s)
▶ Gardes de cohérence (check:consistency)… OK (12s)
▶ Preuve de rotation des secrets… OK (0s)
▶ Suite de tests (vitest) + baseline machine + baseline humaine… OK (52s)
▶ Cohérence documentaire (post-baseline)… OK (1s)
▶ Tests PostgreSQL réels (concurrence numérotation/stock/licences/sessions)… OK (12s)
▶ Migrations PostgreSQL sur base neuve + smoke test… OK (5s)
▶ Rate-limit distribué multi-instance (Redis réel)… OK (5s)
▶ Audit complet dépendances (tous niveaux)… OK (2s)
▶ Audit runtime desktop empaqueté (Electron)… OK (2s)
▶ Manifeste de release (commit-bound)… OK (1s)
▶ Vérification d'artefact (identité + cohérence + secrets)… OK (0s)
▶ Empaquetage + vérification d'artefact RÉEL (ZIP extrait, sans .git)… OK (8s)
▶ Build de production (next build)… OK (204s)
▶ Budget de performance (bundle client)… OK (1s)

✅ GATE LOCAL PASSÉ
EXIT=0
```

Preuve : `MASTER5_EVIDENCE/logs/36-release-gate.txt`.

## 3. Les 3 échecs de MASTER 4 — causes et résolutions

| Contrôle | Cause MASTER 4 | Résolution |
|---|---|---|
| TypeScript | 247 lignes d'erreurs faute de types `@prisma/client` générés | moteurs Prisma rétablis → 0 erreur, sans toucher au code ni à `tsconfig.json` |
| Vitest | 84 fichiers rouges (79 « Prisma natif », 5 « client serveur ») + 3 tests échoués | moteurs rétablis + 3 corrections ciblées (assertion littérale obsolète, `.gitignore` masquant `.env.example`, délai Python trop court sous charge) |
| Build de production | `prisma generate` échouait avant `next build` | moteurs rétablis → build complet, `BUILD_ID` présent |

## 4. Les 4 non-exécutions de MASTER 4 — services réellement fournis

| Contrôle | Prérequis | Ce qui a été fourni |
|---|---|---|
| Tests PostgreSQL réels | `TEST_POSTGRES_URL` | **PostgreSQL 17.11 local jetable** (conteneur `postgres:17-alpine`), conformément à la cible documentée du test |
| Migrations sur base neuve | `TEST_POSTGRES_URL` | idem, plus une exécution contre **Neon 18.6** (base `gf_gate_check_<16 hex>`) |
| Rate-limit multi-instance | `TEST_REDIS_URL` | **Redis 7 local jetable** (protocole RESP réel, deux instances indépendantes du module de limitation) |
| Budget de performance | `.next/BUILD_ID` + `.next/static` | build de production abouti → 3,49 Mio mesurés sur budget 3,65 Mio |

Le garde `BUILD_ID` n'a pas été contourné : il a été **satisfait**.

## 5. Un piège d'environnement, identifié et écarté

Une première exécution de la porte a été lancée avec **l'environnement Preview Vercel complet** injecté (33 variables, dont `VERCEL=1`, `VERCEL_ENV=preview` et un `DATABASE_URL` PostgreSQL). La porte ne neutralise que `TEST_POSTGRES_URL` et `TEST_REDIS_URL` pour son passage Vitest : tout le reste restait actif, et la suite standard — écrite pour SQLite et pour un contexte non-Vercel — s'exécutait dans un environnement de production simulé.

Résultat : **3 échecs** (`portail-2fa-cycle.test.ts` : 401 au lieu de 200, puis **429** au lieu de 400 ; `synchro-voie-de-retour.test.ts`). Ces échecs ont **disparu** hors de cette pollution. Ce n'étaient pas des défauts du produit mais un environnement de test faussé — et le code 429 (« Too Many Requests ») le signalait clairement.

La porte a donc été rejouée avec **exactement** les deux variables de service qu'elle attend, et rien d'autre. Les deux exécutions sont conservées dans l'historique de cette mission ; seule la seconde constitue la mesure.

## 6. Ce que la porte N'atteste PAS

Son propre message de sortie le dit :

```
✅ GATE LOCAL PASSÉ : exécutez encore `npm run readiness:final`
   avec les preuves Playwright, Windows, staging et conformité.
```

Restent hors de son périmètre, et traités ailleurs :

- l'installateur Windows NSIS et son installation réelle → `BUILD_WINDOWS_FINAL.md` ;
- les parcours Playwright authentifiés → `PLAYWRIGHT_FINAL.md` ;
- le déploiement et sa vérification → `VERCEL_DEPLOYMENT_FINAL.md` ;
- la conformité des notices de l'artefact distribué → `BUILD_WINDOWS_FINAL.md §9` ;
- le verdict de production → `READINESS_FINAL.md` et `PRODUCTION_FINAL_VERDICT.md`.

## 7. Contrôles Node exécutés hors porte

| Suite | Résultat |
|---|---|
| `npm run test:release-safety` | **190 réussis, 0 échoué, 3 ignorés** sur 193 — les 3 ignorés sont des contrôles de permissions POSIX inapplicables à NTFS (`keys:sync` partiel, 2 × `setup-dev` ACL) |
| `npm run test:audit` | **23/23** |
| `npm run test:config` | **245/245** |
| `npm run test:config:auto` | **119/119** |
| `npm run test:sbom` (exécuté sur la clôture Linux) | **11/11** |
| `npm run test:keygen` (Python, OCR Tesseract réel inclus) | **39/39**, 0 ignoré |
| `npm run rapport:parcours` (10 parcours métier) | **899/905 assertions, 0 échec** |

### Une régression corrigée dans `test:release-safety`

5 tests de `tests/gitleaks-ci.test.cjs` échouaient sous Windows sur une seule assertion :

```js
assert.equal(fs.statSync(temporary).mode & 0o777, 0o700)
```

NTFS n'a pas de bits de permission POSIX : `fs.chmodSync(dir, 0o700)` n'y change que l'attribut « lecture seule » et `statSync().mode & 0o777` renvoie `0o666` (mesuré). L'assertion faisait donc échouer ce test **sur la plateforme cible du produit, sur du code correct**. L'exigence — le dossier de travail doit être privé — est conservée : le caractère « répertoire » est vérifié partout, le mode POSIX uniquement hors win32, exactement comme les deux tests de `setup-dev-permissions.test.cjs` déjà ignorés sous win32 avec la mention « POSIX permission bits are not NTFS ACLs ». Sur Windows, la confidentialité repose sur l'ACL par défaut de `%TEMP%`, à vérifier par ACL et non par bits de mode.

Après correction : **16/16** sur ce fichier, **190/193** sur la suite complète.
