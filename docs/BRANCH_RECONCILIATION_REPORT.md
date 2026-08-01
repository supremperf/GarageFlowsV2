# Rapport de réconciliation des branches — GarageFlow

_Étape obligatoire de la mission (comparaison `production-audit` ↔
`acquisition-prep`). Réalisé de première main le 2026-08-01. Aucun force-push,
aucune réécriture d'historique._

## 1. Contexte

La branche de travail `claude/garageflow-acquisition-prep-914inr` avait apporté
une large documentation d'acquisition mais, côté **application desktop
(GarageFlowsV2)**, elle avait **réintroduit des régressions de sécurité** qui
avaient été corrigées sur `claude/garageflow-production-audit-0qp9ui`.

Ce rapport documente la comparaison des deux branches, les régressions
identifiées, les choix de fusion et les preuves de correction.

## 2. Méthode

- Récupération de `origin/claude/garageflow-production-audit-0qp9ui` dans les deux
  dépôts.
- `git merge-base` + `git diff --stat` + lecture **fichier par fichier** des
  divergences de code (hors documentation).
- Classement de chaque divergence : **durcissement perdu à restaurer** /
  **ajout légitime d'acquisition-prep à préserver** / **neutre**.
- Restauration à l'identique des durcissements via `git checkout origin/prod-audit -- <fichier>`.
- Vérification : `tsc`, tests unitaires (dont les tests de durcissement restaurés),
  suites d'intégration concernées.

## 3. Résultat par dépôt

### 3.1 garagesite3 (control-plane) — AUCUNE régression
`git merge-base --is-ancestor prod-audit HEAD` = **VRAI** : la branche
acquisition-prep du cloud **est** `production-audit` (164eccd) **+** les commits
de cette mission (cron de rollback, marque blanche). Le seul écart de code est
une **amélioration** (`site.ts` : nom produit surchargable par env). **Rien à
restaurer.**

### 3.2 GarageFlowsV2 (desktop) — 16 fichiers de durcissement restaurés
Ancêtre commun : `e90b165` (« Consolidation → main »). La consolidation vers
`main` — base d'acquisition-prep — n'avait **pas** repris les durcissements
postérieurs de `production-audit`. Ils ont été restaurés.

## 4. Régressions détectées et corrigées (desktop)

| Fichier | Régression (présente sur acquisition-prep) | Correctif restauré |
|---|---|---|
| `electron/main.js` | Validation d'origine par `url.startsWith('http://127.0.0.1:PORT')` — accepte `…:PORT@evil.com` / `…:PORT8` (origine hostile avec pont preload attaché) | Comparaison d'**origine exacte** `new URL(url).origin === localOrigin` (will-navigate + will-redirect) |
| `electron/main.js` | **Saisie manuelle** de licence : un token lié au **HWID d'une autre machine** était accepté | Contrôle HWID à la soumission (miroir de `checkStoredLicense`) — refus si mismatch |
| `src/lib/photo-store.ts` + `jobs/[id]/photos/route.ts` | Extension dérivée du MIME client (`mime.split('/')[1]`), **aucune** limite de taille, **aucune** protection de traversée sur `subDir` | Liste blanche MIME→extension, `MAX_PHOTO_BYTES` (8 Mo) vérifié avant allocation, neutralisation anti-traversée de `subDir`, validation **avant** stockage (413) |
| `src/app/api/vehicles/[id]/route.ts` | **IDOR 2nd ordre** : un `clientId` d'un autre garage pouvait être rattaché à un véhicule (PII exposée via `include: { client }`) | `assertRelations(garageId, [{model:'client', id:clientId}])` avant update |
| `src/app/api/parts/route.ts` + `[id]/route.ts` + `schemas/index.ts` | **Injection d'opérateur Prisma** : `data[f] = body[f]` laissait passer `{ increment }`/`{ multiply }` et persistait des `NaN` | `coercePartField` : refuse objets, `NaN`/`Infinity`, hors-bornes ; borne les chaînes |
| `work-orders/route.ts` + `[id]/route.ts` | Calculs monétaires en **flottant** (`reduce` + `Math.round`) — bruit binaire, invariant TTC rompu | Délégation à `money.computeTotals` (**centimes entiers**) |
| `src/app/api/suppliers/route.ts` | Décrément de stock en **read-modify-write** (`quantity = q - n`) — *lost update* concurrent | Décrément **atomique** `{ decrement: n }` |
| `labor-operations/bulk-import/route.ts` | `Number(x) < 1` contournable (`NaN < 1` === `false`), pas de borne de lot | Nombres **finis** et bornés + `MAX_BULK = 1000` (413) |
| `src/lib/signature/key.ts` | `GF_SIGNATURE_SECRET` faible accepté (clé de scellement prévisible) | Rejet **fail-closed** d'un secret faible (`isWeakSecret`) |
| `src/app/login/page.tsx` | **Open redirect** : `?callbackUrl=https://evil.com` (ou `//evil.com`) suivi après connexion | `callbackUrl` restreint aux chemins **internes relatifs** (`/^\/(?![/\\])/`) |
| `scripts/post-build.js` | Le `.env` racine copié par `next build` dans `.next/standalone` était **embarqué dans l'installateur Windows** (fuite de secrets si le poste de build en contenait) | Suppression de tout `.env`/`.env.*` du bundle standalone au post-build |
| `src/app/api/admin/monitoring/route.ts` | Métriques **hôte** (CPU/mémoire) accessibles à l'admin d'un tenant en PWA (fuite inter-tenant) | Réservé au **super-admin** en `isPwaProduction()` |
| `src/lib/__tests__/security-hardening.test.ts` | **117 lignes de tests supprimées** | Fichier restauré (**14 tests verts**) |

## 5. Ajouts d'acquisition-prep **préservés** (non écrasés)

- `src/config/brand.ts` + `src/config/__tests__/brand.test.ts` (marque blanche typée, 8 tests).
- `src/config/app.ts` : `name: BRAND.productName` (conservé — supérieur à
  `name:'GarageFlow'` de prod-audit).
- `src/app/api/portal/auth/2fa/verify/route.ts` : verrou 2FA **par compte**.
- Toute la data room et la documentation d'acquisition.

## 6. Choix de fusion

- Restauration **à l'identique** des fichiers de durcissement (pas de réécriture),
  car acquisition-prep n'avait pas modifié ces fichiers depuis `e90b165` : la
  restauration applique proprement le durcissement sans conflit.
- Fichiers modifiés par cette mission (`config/app.ts`, `2fa/verify`) : **non
  écrasés** — vérifié après restauration (`BRAND.productName` et
  `portal-2fa-acct:` toujours présents).
- Dépendances des fichiers restaurés (`money.computeTotals`, `isWeakSecret`,
  `isPwaProduction`, `isAdminSession`, `assertRelations`) : **toutes présentes**
  dans HEAD avant restauration → build non cassé.

## 7. Preuves de correction

| Vérification | Résultat |
|---|---|
| `npx tsc --noEmit` (GarageFlowsV2) | **exit 0** |
| `security-hardening.test.ts` restauré | **14 / 14 verts** |
| Suite complète (mono-thread) | **692 / 692 verts (65 suites), exit 0** |
| Suite complète (parallèle) | 670 verts + 3 suites d'intégration en *hook timeout* (contention `prisma db push` en `beforeAll`, **infra/timing** — vertes en isolation : 22/22). Flakiness **préexistante**, non liée à la restauration. |

## 8. Risques de régression

- Faible. Les fichiers restaurés proviennent d'une branche où ils compilaient et
  passaient déjà les tests ; toutes leurs dépendances existent dans HEAD ; les
  ajouts d'acquisition-prep sont préservés et vérifiés.
- La seule instabilité observée (3 suites d'intégration) est **antérieure** à
  cette mission (contention de `prisma db push` sous parallélisme) et n'affecte
  pas la correction — ces suites passent en mono-thread.

---

_Voir aussi : `docs/ACQUISITION_READINESS_AUDIT.md`,
`docs/FINAL_250K_ACQUISITION_READINESS_REPORT.md`._
