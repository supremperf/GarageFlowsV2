---
doc-numbers: journal
---

# RÉSULTATS DE TESTS — rapport MASTER 6

Toutes les mesures ci-dessous ont été obtenues sur **l'arbre intégré** qui est publié, pas sur un état antérieur.

---

## 1. Synthèse

| Suite | Réussis | Échoués | Ignorés | Code |
|---|---:|---:|---:|---:|
| Vitest (365 fichiers) | **4 390** | **0** | 34 | 0 |
| **Playwright authentifié** | **135** | **0** | 9 | 0 |
| `test:release-safety` | 190 | **0** | 3 | 0 |
| `test:audit` | 23 | 0 | 0 | 0 |
| `test:config` | 245 | 0 | 0 | 0 |
| `test:config:auto` | 119 | 0 | 0 | 0 |
| `test:keygen` (Python, OCR réel) | 39 | 0 | 0 | 0 |
| `test:sbom` | 11 | 0 | 0 | 0 |
| 10 parcours métier | 899 assertions | **0** | — | 0 |
| chaîne ECDSA P-256 | 19 | 0 | 0 | 0 |
| HWID V1 Node ↔ Python | 5 vecteurs + 23 tests | 0 | 0 | 0 |
| HTTP réels contre staging | **35** | **0** | 0 | 0 |
| arbitrage métier | 8 | **0** | — | 0 |
| **`release:gate`** | **16 / 16** | **0** | **0** | **0** |

## 2. Évolution depuis MASTER 4

| Indicateur | MASTER 4 | MASTER 5 | **MASTER 6** |
|---|---:|---:|---:|
| Vitest — fichiers rouges | **84** | 0 | **0** |
| Vitest — tests réussis | 3 517 | 4 390 | **4 390** |
| Vitest — échoués | 3 | 0 | **0** |
| Vitest — ignorés | 869 | 34 | **34** |
| **Playwright réussis** | 0 | 54 | **135** |
| **Playwright ignorés** | 90 | 90 | **9** |
| TypeScript | 247 lignes d'erreurs | 0 | **0** |
| `release:gate` OK | 9 | 16 | **16** |
| `release:gate` échecs | 3 | 0 | **0** |
| HTTP réels contre staging | 0 | 0 | **35** |

## 3. `release:gate` — les 16 contrôles

```
✅ TypeScript (tsc --noEmit)                                                  OK
✅ ESLint                                                                     OK
✅ Gardes de cohérence (check:consistency)                                    OK
✅ Preuve de rotation des secrets                                             OK
✅ Suite de tests (vitest) + baseline machine + baseline humaine              OK
✅ Cohérence documentaire (post-baseline)                                     OK
✅ Tests PostgreSQL réels (concurrence numérotation/stock/licences/sessions)  OK
✅ Migrations PostgreSQL sur base neuve + smoke test                          OK
✅ Rate-limit distribué multi-instance (Redis réel)                           OK
✅ Audit complet dépendances (tous niveaux)                                   OK
✅ Audit runtime desktop empaqueté (Electron)                                 OK
✅ Manifeste de release (commit-bound)                                        OK
✅ Vérification d'artefact (identité + cohérence + secrets)                   OK
✅ Empaquetage + vérification d'artefact RÉEL (ZIP extrait, sans .git)        OK
✅ Build de production (next build)                                           OK
✅ Budget de performance (bundle client)                                      OK

✅ GATE LOCAL PASSÉ
EXIT=0
```

Services réels fournis : **PostgreSQL 17.11** et **Redis 7** en conteneurs jetables, conformément à la cible documentée des tests de concurrence.
Preuve : `MASTER6_EVIDENCE/logs/16-release-gate-m6.txt`.

## 4. Les 34 tests Vitest ignorés — inventaire

| Fichier | Nb | Raison |
|---|---:|---|
`license-devices.postgres.int.test.ts` | 15 | `TEST_POSTGRES_URL` neutralisé pour le passage **standard** |
`licensed-session.postgres.int.test.ts` | 6 | idem |
`rate-limit-multi-instance.int.test.ts` | 5 | `TEST_REDIS_URL` neutralisé pour le passage **standard** |
`document-numbering.postgres.int.test.ts` | 1 | idem |
`stock-concurrency.postgres.int.test.ts` | 1 | idem |
`license/__tests__/forgery-resistance.test.ts` | 4 | `keys/private.pem` absent (clé de production introuvable) |
`license/__tests__/public-key-consistency.test.ts` | 2 | `GF_TEST_LICENSE` non fourni à ce passage |

**28 des 34** sont les suites conditionnelles de service. Elles ne sont pas comptées vertes dans le passage standard — et elles sont **exécutées séparément par `release:gate` contre de vrais PostgreSQL et Redis, où elles passent**. Cette séparation est voulue : la baseline machine doit décrire la suite reproductible partout.

**6 des 34** dépendent de la clé privée d'émission. La propriété qu'ils vérifient est néanmoins démontrée par `reproduce-keygen-roundtrip.mjs` avec une paire de fixtures : **19/19**.

## 5. Les 9 tests Playwright ignorés — par conception

Trois tests `responsive.spec.ts` × trois gabarits non-mobiles, avec exclusion explicite dans le code :

```ts
test.skip(page.viewportSize()!.width >= 768, 'Assistant en colonne au-delà de md')
test.skip(page.viewportSize()!.width >= 768, 'Sélecteur mono-mécanicien en mobile uniquement')
test.skip(page.viewportSize()!.width >= 768, 'Menu « Plus » en mobile uniquement')
```

Ils s'exécutent et passent sur les trois gabarits mobiles. Aucun n'est ignoré faute de prérequis.

## 6. Les 3 tests `release-safety` ignorés

Bits de permission POSIX inapplicables à NTFS, avec la mention du projet « POSIX permission bits are not NTFS ACLs » :
`keys:sync` partiel, et 2 × `setup-dev` ACL.

## 7. Tests HTTP réels contre le staging — 35/35

En **mode production** (`NODE_ENV=production`, instrumentation *fail-closed* active), contre les services de staging réellement provisionnés.

| Domaine | Contrôles | Résultat |
|---|---:|---|
| santé (`/api/health`, `/api/ping`) | 2 | 200, 200 |
| authentification (redirection, `/login`, providers, CSRF) | 4 | OK |
| autorisation (11 API privées sans session) | 11 | **401** sur les 11 |
| licence (statut, activation avec jeton invalide) | 2 | 200, **400** |
| portail (`/clients` → 307, `/portal` → 308) | 2 | OK |
| cron protégé (sans jeton, mauvais jeton) | 2 | **401**, **401** |
| en-têtes de sécurité (CSP, sans `unsafe-eval`, HSTS, XFO, nosniff) | 5 | OK |
| PostgreSQL de staging (connexion, 48 tables) | 2 | **PostgreSQL 18.6** |
| Redis de staging (PING, écriture/lecture, expiration, nettoyage) | 4 | OK |
| tenue sous rafale (30 requêtes concurrentes) | 1 | **30/30 en 227 ms** |

Preuve : `MASTER6_EVIDENCE/logs/11-staging-http-reel.txt`.

## 8. Un faux négatif de ma propre sonde, corrigé

Mon premier passage HTTP comptait 33/34 : j'attendais 401/403 sur le cron e-invoicing, qui renvoyait **409 `FEATURE_DISABLED`**. Le drapeau de fonctionnalité était éteint dans mon environnement de test, et il est évalué **avant** l'autorisation. Après activation du drapeau, l'autorisation est réellement exercée et répond **401** sans jeton comme avec un mauvais jeton → **35/35**. C'était une lacune de mon assertion, pas du produit.

## 9. Validations rejouées sur l'arbre intégré précis

L'arbre publié contient **3 188 fichiers suivis** — soit 213 fichiers amont de plus que l'arbre validé en MASTER 5. Les contrôles sensibles au contenu de l'arbre ont donc été **rejoués** :

| Contrôle | Résultat |
|---|---|
| `tsc --noEmit` | **0 erreur** |
| `npm run lint` | **0** |
| `npm run check:consistency` | **OK** (dont `check:docs`, `check:public-key`, `keys:check`) |
| `npm run test:release-safety` (dont `secret-scan-policy` et GF-DUR-044 qui scanne `git ls-files`) | **190 / 0 / 3** |
| Vitest complet | **360 fichiers passés, 4 390 réussis, 0 échec** |

Preuve : `MASTER6_EVIDENCE/logs/20-validation-arbre-integre.txt`.
