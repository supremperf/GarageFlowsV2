# Audit de production — écosystème GarageFlow

**Date :** 2026-07-31 · **Périmètre :** `GarageFlowsV2` (Desktop Electron +
serveur/PWA) et `garagesite3` (control-plane licences / vitrine / PWA).
**Branche :** `claude/garageflow-production-audit-0qp9ui` (les deux dépôts).

> Ce rapport ne déclare rien « parfait ». Chaque conclusion s'appuie sur une
> commande exécutée et un résultat reproductible (§8, tableau de preuves). Ce qui
> n'a pas pu être exécuté ici (Windows, iOS/Android, Neon, Vercel) est
> **explicitement** listé comme non exécuté, avec la procédure pour le compléter.

---

## 1. Verdict par produit

| Produit | Verdict | Justification |
|---|---|---|
| **GarageFlow Desktop** | **APPROUVÉ AVEC RÉSERVES** | Typecheck/lint/tests/build ✅ ; bundle standalone démarre (DB SQLite OK, auth 401 effective, en-têtes de sécurité) ; Electron durci (isolation/sandbox/webSecurity sur toutes les fenêtres). Corrigés : fuite `.env` packagée, navigation Electron, liaison HWID à la saisie manuelle. **Réserves** : packaging Windows NSIS et parcours GUI E2E non exécutables ici ; 2 défauts licence (offline/heartbeat) **documentés** faute de validation possible (voir `REMAINING_RISKS.md`). |
| **Serveur / API (PWA multi-instance)** | **APPROUVÉ AVEC RÉSERVES** | Prisma PostgreSQL, build ✅, isolation multi-tenant/IDOR robuste, TOCTOU factures/PO/sièges corrigés (prouvés sur PostgreSQL réel), rate-limit distribué (prouvé Redis réel), env fail-closed. Corrigés : IDOR véhicule↔client (ÉLEVÉ), open-redirect login, secret de signature faible, fuite métriques hôte multi-tenant. **Réserve** : Neon/Vercel réels non exécutés ici. |
| **Control-plane (`garagesite3`)** | **APPROUVÉ AVEC RÉSERVES** | Typecheck/lint/tests/build ✅. Corrigé : **abus du rollback automatique** via `/api/crash` public (ÉLEVÉ) — corrigé et **prouvé par test d'intégration sur PostgreSQL réel**. **Réserve** : rate-limit du crash en mémoire (recommandation distribuée, `REMAINING_RISKS.md`). |
| **PWA** | **APPROUVÉE AVEC RÉSERVES** | Manifest + service worker présents ; en-têtes (CSP, HSTS, XFO:DENY, nosniff) **présents sur réponses live** ; cache `private`. **Réserve** : parcours installation/offline sur navigateurs réels (iOS/Android) non exécutés. |
| **Déploiement public multi-instance** | **APPROUVÉ AVEC RÉSERVES** | Rate-limit distribué + sièges atomiques + fail-closed prouvés. **Réserve** : validation finale sur l'infra cible (Neon/Vercel/Upstash réels). |

**Aucun produit n'est REFUSÉ.** Les réserves portent sur des validations
nécessitant un environnement externe, ou sur 2 défauts licence Electron
**documentés** (non validables ici) — jamais sur un défaut critique laissé ouvert.

---

## 2. Résumé du travail

- Inventaire : 2 dépôts, **181 routes API** (125 + 56), **3 schémas Prisma**
  (37 desktop + 37 serveur + 13 control-plane), **~67 k lignes** TS/TSX.
- Ground truth **avec preuves** : typecheck, lint, tests, build (les deux repos).
- **Toutes** les suites exécutées, y compris les 37 tests d'intégration
  habituellement ignorés — via **PostgreSQL 16 + Redis 7 réels** montés pour
  l'occasion. Aucune fabrication.
- Audit adverse (workflow multi-agents : 11 dimensions + **vérification
  indépendante** de chaque finding) → **9 défauts CONFIRMÉS** sur 17 évalués
  (8 rejetés par le vérificateur comme non exploitables).
- Correction en priorité (données/sécurité d'abord), **régression testée**,
  documentation. 1,5 M tokens d'analyse subagent, 28 agents.

---

## 3. Défauts CONFIRMÉS (vérification adverse indépendante) et traitement

| ID | Sévérité | Projet · Fichier | Défaut | Traitement |
|---|---|---|---|---|
| **A-01** | **ÉLEVÉ** | GFV2 · `api/vehicles/[id]/route.ts` | IDOR 2nd ordre : PATCH accepte un `clientId` hors garage (mass assignment) → réassociation + **fuite PII cross-tenant** via `include:{client}` du GET | **CORRIGÉ** — `assertRelations` sur `clientId` (miroir du POST). Test. |
| **A-02** | **ÉLEVÉ** | site3 · `api/crash` + `lib/crashes/service.ts` | `/api/crash` public : 10 rapports anonymes gonflaient `crashCountForVersion` (fallback `?? r.id`) → **rollback automatique forcé** d'une version saine (déni de service du déploiement) | **CORRIGÉ** — ne compter que les HWID d'**appareils enregistrés** (Device). **Test d'intégration PostgreSQL réel** (30 rapports anonymes/factices → count=2). |
| **A-03** | **ÉLEVÉ** | GFV2 · `scripts/post-build.js` | `.env` de la racine embarqué dans l'installateur NSIS (`extraResources` sans filtre) → fuite possible de secrets aux clients | **CORRIGÉ** — suppression de tout `.env*` du bundle standalone. Vérifié. |
| **A-04** | **MOYEN** | GFV2 · `api/suppliers/route.ts` | Décrément de stock read-modify-write (lost update) au retour de commande, asymétrique de l'incrément atomique | **CORRIGÉ** — décrément atomique `{ decrement }`. |
| **A-05** | **MOYEN** | GFV2 · `lib/signature/key.ts` | `GF_SIGNATURE_SECRET` faible accepté (seul contrôle : non vide) → clé de scellement prévisible | **CORRIGÉ** — `isWeakSecret` fail-closed (cohérent avec la politique). Test. |
| **A-06** | **MOYEN** | GFV2 · `app/login/page.tsx` | Open redirect : `callbackUrl` poussé sans validation → navigation externe (phishing) | **CORRIGÉ** — chemin interne relatif uniquement (rejette `//`, `/\`, absolu). Test. |
| **A-07** | **MOYEN** | GFV2 · `electron/main.js` (offline) | `last_online.json` sans intégrité : édition du `ts` prolonge la grâce hors-ligne (retarde la révocation) | **DOCUMENTÉ** (`REMAINING_RISKS.md` R-1) — correctif HMAC recommandé, non validable ici (risque de verrouiller les clients post-màj). |
| **A-08** | **MOYEN** | GFV2 · `electron/main.js` (heartbeat) | Réponse `/api/license/check` acceptée sans signature applicative + `GF_LICENSE_SERVER` redéfinissable par variable d'env | **DOCUMENTÉ** (`REMAINING_RISKS.md` R-2) — signature de heartbeat + épinglage recommandés (changement de protocole, non validable ici). |
| **A-09** | **FAIBLE** | GFV2 · `api/admin/monitoring/route.ts` | Métriques de l'hôte **partagé** lisibles par l'admin de n'importe quel tenant (PWA) | **CORRIGÉ** — super-admin requis en prod PWA ; propriétaire/responsable conservé en desktop. |
| **A-10** | **FAIBLE** | GFV2 · `electron/main.js` (submit) | Liaison HWID non vérifiée à la **saisie manuelle** du token (contrôlée seulement à la réouverture) | **CORRIGÉ** — `hwidMatches` à la saisie (miroir de `checkStoredLicense`). |

*(A-01 à A-10 = les 9 findings vérifiés-CONFIRMÉS + la fuite `.env` A-03 trouvée
indépendamment et vérifiée. 7 corrigés, 2 documentés faute de validation.)*

## 4. Durcissements additionnels appliqués (findings rejetés par le vérificateur comme non exploitables, mais corrigés par prudence — défense en profondeur)

| ID | Projet · Fichier | Durcissement |
|---|---|---|
| H-01 | GFV2 · `electron/main.js` | `will-navigate`/`will-redirect` : comparaison d'**origine** exacte au lieu de `startsWith` (bloque `http://127.0.0.1:PORT@evil.com`). |
| H-02 | GFV2 · `api/work-orders/route.ts` (+ `[id]`) | Totaux HT/TTC via `money.ts` (centimes) au lieu de flottant — invariant `TTC=HT+TVA`. Test. |
| H-03 | GFV2 · `api/jobs/[id]/photos` + `lib/photo-store.ts` | Upload photo : liste blanche MIME, extension jamais dérivée du client, taille bornée (8 Mo, refus 413), anti-traversée. Test. |
| H-04 | GFV2 · `api/parts` (+ `[id]`) | Coercition stricte : refuse les objets opérateur Prisma (`{increment}`), NaN, hors-bornes. Test. |
| H-05 | GFV2 · `api/labor-operations/bulk-import` | Borne dure sur la taille du lot + rejet des `NaN` (l'ancienne garde `Number(x)<1` était contournable). |

---

## 5. Risques connus (Phase 30 du cahier des charges) — état vérifié

Tous **déjà traités** par le socle antérieur et **re-vérifiés** ici (rate-limit
distribué, sièges TOCTOU, IDOR, numérotation factures, réception PO, Float
maîtrisé en centimes, clé SSE hors URL, pagination, confusion PG/SQLite, routes
admin protégées, HWID, mises à jour signées). Preuves : §8 + `REMAINING_RISKS.md`.
Le seul risque Phase 30 non re-vérifiable ici : « fonctionnalités invisibles dans
l'UI » (nécessite l'exécution GUI — `REMAINING_RISKS.md` R-UI).

---

## 6. Méthode de correction (cause racine)

Pour chaque défaut : cause racine identifiée → recherche des occurrences sœurs
(ex. IDOR : balayage de toutes les routes écrivant une FK → seul `vehicles/[id]`
manquait la garde) → correction au point unique → test de non-régression →
revalidation complète.

## 7. Fichiers modifiés

**GarageFlowsV2** : `scripts/post-build.js`, `electron/main.js`,
`src/app/api/vehicles/[id]/route.ts`, `src/app/api/work-orders/route.ts`,
`src/app/api/work-orders/[id]/route.ts`, `src/app/api/suppliers/route.ts`,
`src/app/api/jobs/[id]/photos/route.ts`, `src/lib/photo-store.ts`,
`src/app/api/parts/route.ts`, `src/app/api/parts/[id]/route.ts`,
`src/app/api/labor-operations/bulk-import/route.ts`, `src/lib/schemas/index.ts`,
`src/app/api/admin/monitoring/route.ts`, `src/lib/signature/key.ts`,
`src/app/login/page.tsx`, `src/lib/__tests__/security-hardening.test.ts` (+ docs).

**garagesite3** : `src/lib/crashes/service.ts`,
`src/lib/crashes/__tests__/crash-rollback-abuse.integration.test.ts`.

## 8. Tableau de preuves

| Contrôle | Commande / méthode | Résultat | Statut |
|---|---|---|---|
| Typecheck GFV2 | `npx tsc --noEmit` | 0 erreur | ✅ |
| Lint GFV2 | `npx next lint` | 0 warning/erreur | ✅ |
| Tests GFV2 (incl. intégration réelle) | `TEST_POSTGRES_URL/TEST_REDIS_URL … vitest run` | **704 passed** (67 fichiers, 0 skip) | ✅ |
| Build GFV2 | `npm run build` | exit 0, standalone | ✅ |
| Post-build GFV2 | `node scripts/post-build.js` | assemblé + `.env` supprimé | ✅ |
| Runtime GFV2 | boot `server.js` + `curl` | `/api/health db:connected` ; `/api/clients`,`/admin/monitoring`,`/internal/migrate` → 401 ; CSP/HSTS/XFO présents | ✅ |
| Typecheck site3 | `npx tsc --noEmit` | 0 erreur | ✅ |
| Lint site3 | `npm run lint` | 0 warning/erreur | ✅ |
| Tests site3 (unit + Redis) | `TEST_REDIS_URL … vitest run` | **139 passed** | ✅ |
| Sièges TOCTOU site3 | `TEST_DATABASE_URL … vitest device-seats` | **9 passed** (Postgres réel) | ✅ |
| **Anti-abus rollback crash** | `TEST_DATABASE_URL … vitest crash-rollback-abuse` | **1 passed** (30 rapports → count=2) | ✅ |
| Rate-limit distribué site3 | `TEST_REDIS_URL … vitest rate-limit-distributed` | **4 passed** (Redis réel) | ✅ |
| Build site3 | `npm run build` | exit 0 | ✅ |
| Secrets tracked | `git ls-files | grep clés/secrets` | aucun secret, aucun `.env` commité | ✅ |
| Packaging Windows / Neon / Vercel / iOS-Android | — | **non exécuté** (infra externe) | ⚠️ |

Voir aussi : `FUNCTIONAL_COVERAGE_MATRIX.md`, `CONFIGURATION_GUIDE.md`,
`BUILD_AND_RELEASE_GUIDE.md`, `REMAINING_RISKS.md`.
