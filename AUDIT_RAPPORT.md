# AUDIT_RAPPORT — GarageFlow V2

**Date** : 2026-08-03
**Auditeur** : revue finale pré-production (TypeScript / Next.js 14 / Electron / Prisma / sécurité).
**Périmètre réel mesuré** : **571 fichiers suivis** par git (`git ls-files`), dont **125 routes API** (`src/app/api/**/route.ts`) et **73 fichiers de tests**.
> Écart honnête avec l'énoncé : le prompt annonçait ~816 fichiers et ~267 routes API. Le dépôt réellement présent en compte 571 et 125. L'audit porte sur les fichiers réellement présents. `src/generated/**` (clients Prisma) est **gitignoré** (artefact de build) et hors périmètre.

---

## 1. Phase 1 — Vérifications automatisées (sorties réelles)

Exécutées à la racine, environnement Linux, Node 20, après `npm ci`.

| # | Commande | Code retour | Résultat |
|---|---|---|---|
| 1 | `npm ci` | 0 | Dépendances installées. |
| 2 | `npx tsc --noEmit` | 0 | **Aucune erreur de type.** |
| 3 | `npm run lint` (`next lint`) | 0 | `✔ No ESLint warnings or errors`. |
| 4 | `npx prisma validate` (desktop SQLite) | 0 | `The schema at prisma/schema.prisma is valid 🚀`. |
| 5 | `npx prisma validate --schema prisma/server/schema.prisma` | 0* | Schéma **valide** quand `DATABASE_URL` + `DIRECT_URL` sont fournis (cas CI). Sans `.env` local avec `DIRECT_URL`, échoue avec `P1012 Environment variable not found: DIRECT_URL` — problème d'environnement local, **pas** du schéma. |
| 6 | `npm run build` (`prisma generate ×2 && next build`) | 0 | Build de production réussi, 15 pages générées. |
| 7 | `npx vitest run` | 0 | **760 tests passés, 26 skipped** ; 69 fichiers de test OK, 3 skipped. Durée ~14 s. |
| 8 | `npm audit` | (1) | 30 vulnérabilités (1 critique, 24 hautes, 4 modérées, 1 basse) **toutes dépendances confondues**. Voir §2. |
| 9 | `npm audit --omit=dev` (production) | (1) | **7 vulnérabilités prod (3 hautes, 4 modérées)**. Les 3 hautes (`next`, `nodemailer`, `postcss`) sont **dérogées et datées** (réexamen 2026-10-31) dans `scripts/audit-ci.js`. |
| 10 | `node scripts/audit-ci.js` (porte CI) | 0 | **Passe** : aucune high/critical prod non dérogée. |
| 11 | gitleaks | n/a | **Non installable dans cet environnement** (pas de binaire, pas de réseau vers github releases). Scan **manuel** effectué (§4) : aucun secret en clair, aucun fichier sensible suivi. CI exécute gitleaks 8.24.3 sur l'arbre. |
| 12 | `npm run test:e2e` (Playwright) | — | Voir §7 (limites) : tenté, nécessite serveur applicatif + services. |

**Verdict Phase 1** : `tsc`, `lint`, `build`, `prisma validate` (×2), `vitest` sont **tous au vert**. Le socle automatisé est sain. La suite de l'audit cible ce que ces outils ne voient pas (IDOR/logique/cas limites/sécurité applicative).

---

## 2. Vulnérabilités de dépendances (`npm audit`)

**Distinction essentielle production vs dev/build** (le CI ne bloque que sur la production via `scripts/audit-ci.js`) :

- **Production (runtime), high** : `next` (DoS/SSRF/cache-poisoning/XSS divers), `nodemailer` (injection SMTP via CRLF), `postcss` (tiré transitivement par Next). → **Dérogations documentées et datées** (2026-10-31), correctif = montées majeures planifiées. Exploitabilité jugée faible dans ce contexte (motifs dans `scripts/audit-ci.js:27-48`).
- **Production, moderate** : `@anthropic-ai/sdk` (memory tool path validation — non utilisé ici en tant que serveur d'outil), `jspdf`→`dompurify`, `uuid`, `next-auth`→`nodemailer`.
- **Dev / build uniquement** (non exposées au runtime) : chaîne `electron-builder` (`app-builder-lib`, `builder-util*`, `dmg-builder`…), **`tar` (critique)**, `sharp`, `glob`, `brace-expansion`, `js-yaml`, `lodash`, `picomatch`, `vite`, `flatted`, `form-data`, `tmp`, `@xmldom/xmldom`. Ces paquets servent au packaging/tests, pas au serveur en production.

**Recommandation** : bumps de patch sûrs (`next` 14.2.x le plus récent, `nodemailer` 7.x le plus récent) à valider par build+tests ; migration `electron-builder` récente pour purger `tar`/`app-builder-lib` (build-time). Voir §6 pour ce qui a été appliqué.

---

## 3. Tableau des anomalies

> Sévérités : **P0** = bloquant / perte de données / faille exploitable · **P1** = bug fonctionnel · **P2** = fragilité / cas limite · **P3** = mineur / qualité.

48 anomalies numérotées (A1–A48). Aucune P0 non corrigée ; **aucun P1 ouvert** (tous corrigés + re-vérifiés).

### P1 — bugs fonctionnels / rupture d'isolation (tous CORRIGÉS)

| ID | Sév. | Fichier:lignes | Description | Preuve | Impact | Correctif | Statut |
|---|---|---|---|---|---|---|---|
| A8 | P1 | `src/app/api/vehicles/[id]/route.ts:46-50` | PATCH acceptait `clientId` sans `assertRelations` (le POST validait) | Le GET fait `include:{client:true}` | IDOR 2nd ordre : rattacher son véhicule à un client d'un autre garage → lecture de sa PII (cross-tenant) | Ajout `assertRelations` sur `clientId` avant l'update | **Corrigé** ✅ |
| A11 | P1 | `src/app/api/garages/route.ts:10-22` | GET sans garde de rôle + `include` sans `select` → renvoyait `smtpPass` **en clair**, `smtpUser`/`iban`/`bic` à tout rôle | `email/route.ts:36` écrit `smtpPass` brut ; grep : aucun consommateur de `GF_SMTP_CIPHER_KEY` | Mot de passe SMTP + coordonnées bancaires lisibles par MECHANIC/VIEWER | `smtpPass` retiré de la réponse (destructuration) | **Corrigé** ✅ (chiffrement au repos = recommandé) |
| A16 | P1 (P0-licence) | `electron/main.js:81` | `IS_DEV = process.env.ELECTRON_DEV==='1'` sans garde `app.isPackaged` | l.2332 `if(!IS_DEV)` saute le contrôle ; l.2354 injecte un cookie admin | `set ELECTRON_DEV=1 && GarageFlow.exe` = accès **admin complet sans licence**, trivial | `!app.isPackaged &&` ajouté (ignoré en build packagé) | **Corrigé** ✅ |
| A24 | P1 | `src/lib/money.ts:31` | `toCents` : `Number.EPSILON` fixe ne corrige que [1,2) → arrondi faux ≥2€ sur entrées 3 décimales | Node : `9.995→999`, `39.995→3999`, `8.665→866` (22 723 valeurs fausses 0..20000€) | Sous-facturation de 1c non déterministe | Arrondi demi-haut tolérant à l'échelle du centime (`*100 + 1e-7`) + 4 tests | **Corrigé** ✅ |

### P2 — fragilités / cas limites

| ID | Sév. | Fichier:lignes | Description | Preuve | Correctif | Statut |
|---|---|---|---|---|---|---|
| A3 | P2 | `src/lib/auth.ts:90-93` | Login staff : pas de `bcrypt.compare` si user absent → énumération par timing ; pas de lockout/2FA staff | Le portail neutralise via `DUMMY_HASH` (`portal/auth/login:44`) | `bcrypt.compare` factice sur user-not-found (aligné portail) | **Corrigé** ✅ (lockout/2FA staff = recommandé) |
| A5 | P2 | `portal/tickets/route.ts:41`, `portal/appointments/route.ts:48` | `vehicleId` client stocké sans contrôle d'appartenance | Aucune revérif dans les lectures | Validation `vehicle findFirst {id,garageId,clientId}` sinon 400 | **Corrigé** ✅ |
| A9 | P2 | `src/app/api/jobs/[id]/route.ts:67-71` | PATCH acceptait `mechanicId` sans contrôle (le PUT le fait) | FK requise → id étranger existant passe | Contrôle d'appartenance `mechanicId` ajouté au PATCH | **Corrigé** ✅ |
| A10 | P2 | `src/app/api/estimate/route.ts:130-133` | `mechanic.findMany where:{id:{in}}` sans `garageId` (sink de A9) | — | `garageId` ajouté au `where` | **Corrigé** ✅ |
| A25 | P2 | `src/lib/money.ts:71` | TVA via `Math.round` asymétrique → facture+avoir ne s'annulent pas (résidu 1c) | Node : facture +0,05 taxe 1c, avoir −0,05 taxe 0c | `roundHalfAwayFromZero` sur la ligne TVA | **Corrigé** ✅ |
| A26 | P2 | `src/lib/money.ts:40-43` | `multiplyCents` asymétrique → casse la garantie « négatifs symétriques » | Node : `500` vs `-499` | `roundHalfAwayFromZero` | **Corrigé** ✅ |
| A34 | P2 | `src/components/LoanerPanel.tsx:117-128` | `load()` sans try/catch → `setLoading(false)` inatteignable → spinner bloqué | — | `try/catch/finally` + état d'erreur | **Corrigé** ✅ |
| A1 | P2 | `src/app/api/admin/monitoring/route.ts:16-20` | Métriques hôte (OS/CPU/disque) exposées à OWNER/MANAGER via `requireSession` au lieu de `isAdminSession` | `metrics.ts:104` renvoie `os.release()` | Recommandé : gater derrière `isAdminSession()` (change qui y accède → à confirmer) | Recommandé |
| A18 | P2 | `electron/main.js:1016-1042,1156-1161` | Révocation/expiration fail-open sans `GF_LICENSE_SERVER` (défaut) ; sonde `1.1.1.1` générique | `.env` = `.env.example`, serveur commenté | Recommandé : embarquer `GF_LICENSE_SERVER` (URL réelle requise), ne pas fail-open silencieux | Recommandé |
| A19 | P2 | `src/lib/license/session.ts:80` | Pas de contrôle licence par requête en Electron ; cookie `gf_session` minté localement | `ELECTRON==='1'` désactive l'enforcement | Recommandé (inhérent offline ; documenter/2nd rempart) | Recommandé |
| A27 | P2 | `src/app/api/finance/route.ts:54-72` | Marge = (CA payé − coût de TOUTES les pièces)/CA → marge trompeuse/négative | Populations différentes (division gardée, pas de NaN) | Recommandé : même population OU renommer (changement métier) | Recommandé |
| A33 | P2 | `src/components/JobModal.tsx:55,118-144` | Form édition écrasé au retour d'onglet (refetch → `editingJob` change → `setForm`) → perte de saisie | `page.tsx:158-164` refetch >30s | Recommandé : init sur `[isJobModalOpen,selectedJobId]` seulement | Recommandé |
| A35 | P2 | `src/components/InspectionModal.tsx:210-258` | Auto-save débouncé sans flush au close → perte des dernières saisies | flush seulement à `handleComplete` | Recommandé : flush `pendingUpdates` sur `onClose` + cleanup | Recommandé |
| A36 | P2 | `src/components/QuoteInvoiceModal.tsx:563-564` | `key={index}` sur lignes supprimables (atténué : inputs contrôlés) | `removeLine` filtre par index | Recommandé : id stable par ligne | Recommandé |
| A37 | P2 (latent) | `src/components/WorkOrderModal.tsx:232-279` | `document.write` sans échappement (injection HTML same-origin) — **composant = code mort** | Non monté | Recommandé : échapper si réactivé | Recommandé |
| A43 | P2 | `email/route.ts:36` + schémas | SMTP **en clair** malgré commentaire « encrypted » | grep : aucun consommateur `GF_SMTP_CIPHER_KEY` | Commentaire de schéma corrigé (les 2) ; chiffrement AES-GCM recommandé | **Partiel** (commentaire ✅) |
| A44 | P2 | `.env.example` | `GF_DB_MAC_SECRET` requis en prod (throw) absent du template ET de `validateEnv` | `record-mac.ts:21` throw ; grep=0 | Ajout au `.env.example` (+ `GF_PRIVATE_KEY`, `GF_SIGNATURE_SECRET`, `GF_BACKUP_KEY`, `GF_INTERNAL_EXPORT_KEY`) | **Corrigé** ✅ (`validateEnv` = recommandé) |
| A47 | P2 | `prisma/{schema,server/schema}.prisma` RepairTypePart | `garageId` scalaire nu : pas de FK/onDelete/index → orphelins | `migration.sql:712` seule FK = `partId` | Recommandé (migration PG non validable ici) : relation `Garage @relation(onDelete:Cascade)` + `@@index` | Recommandé |

### P3 — mineurs / qualité (échantillon ; liste complète dans AUDIT_TRACKER.md)

| ID | Fichier:lignes | Description | Statut |
|---|---|---|---|
| A2 | `admin/backups/*` | Sous `/api/admin/*` mais gated par `requireOwner` (garageId-scoped, checksum vérifié → non exploitable) — écart de cohérence | Recommandé |
| A4 | `portal/auth/register:39-40` | Énumération de comptes (409) | Recommandé |
| A6 | `security/rate-limit.ts:281-289` | Sujet `'unverified'` constant en self-host mal configuré (échoue vers PLUS restrictif) | Recommandé (doc) |
| A7 | `internal-auth.ts:32-36` | Check loopback conditionnel à XFF (clé forte toujours exigée → non exploitable) | Recommandé |
| A12 | `parts/route.ts`, `parts/[id]` | N'utilisent pas leurs schémas Zod (quantity négatif/NaN) | Recommandé |
| A13 | `labor-operations/bulk-import` | Pas de cap sur `operations[]` | Recommandé |
| A20 | `src/config/license.ts:18-19` | `hwidMinMatch` mort et trompeur | **Corrigé** ✅ |
| A21 | `license/record-mac.ts:24-25` | Repli secret DB hardcodé (gardé par NODE_ENV prod) | Recommandé |
| A28 | `export/fec/route.ts:33,58` | FEC avoir déséquilibré (TVA omise si ≤0) + Débit/Crédit négatifs | Recommandé (format sensible) |
| A29 | `stock-forecast/plan.ts:45` | `periodDays=0` → NaN (non atteint par la route) | **Corrigé** ✅ (garde) |
| A30 | `stats/route.ts:96,120,124` | Divisions non gardées (mauvaise config) | Recommandé |
| A31 | `portal/appointments` | Pas de détection de chevauchement + fuseau serveur | Recommandé |
| A32 | `money.ts:83-106` | `applyDiscountCents`/`balanceCents` = code mort (aucune remise appliquée) | Recommandé |
| A38-A42 | composants divers | Erreurs fetch avalées ; `setLoading` inatteignable si throw ; i18n ~15 composants FR en dur ; `NotificationCenter` href non validé ; PATCH/PUT jobs | Recommandé |
| A45 | `docs/DATABASE_ARCHITECTURE.md:46` | « 86 entrées » → **125** | **Corrigé** ✅ |
| A46 | `docs/SECURITY.md:74` | Rate-limit décrit « en mémoire » alors qu'Upstash est exigé | **Corrigé** ✅ |
| A48 | `User`/`Mechanic`/`Part` | `@@index([garageId])` manquant (surtout `Part`) | Recommandé |
| C1 | `.eslintrc.json` | Lint sans règles TS-aware (filet = tsc) | Recommandé |
| C2 | `ci.yml:35`, `.gitleaks.toml` | Gitleaks arbre courant only + allowlist `.md`/`.env.example` | Recommandé |

---

## 4. Sécurité — secrets (scan manuel)

- Aucun fichier `.env`, `.pem`, `.key`, `.p12`, `id_rsa` **suivi par git** (`git ls-files` filtré). Les fichiers `*secret*` suivis sont du **code** (`electron/secret.js`, `src/lib/auth-secret.ts`, `src/lib/portal-secret.ts`, `src/lib/session-secret.ts`, `scripts/secrets.js`) et de la doc de rotation — pas des secrets.
- Aucun secret réel en dur détecté dans le code écrit à la main (patterns `sk-ant-…`, `AKIA…`, `-----BEGIN … PRIVATE KEY-----`, `ghp_…`, littéraux longs). Les correspondances sont des noms de champs Prisma générés (hors périmètre) et un placeholder du health-check.
- `.gitleaks.toml` présent, CI exécute gitleaks sur l'arbre courant.

---

## 5. Synthèse chiffrée

**Couverture** : 571 / 571 fichiers suivis traités dans `AUDIT_TRACKER.md` (statut `OK` ou rattaché à une anomalie). Revue par 6 axes (routes API métier, routes sécurité admin/portal/internal, monétaire/logique, Electron/licence, React/hooks, config/Prisma/docs) + revue personnelle des primitives de sécurité et re-vérification.

**Vérifications automatisées — avant / après corrections** (sorties réelles collées §1 et §6) :

| Commande | Avant | Après |
|---|---|---|
| `npm ci` | 0 | 0 |
| `tsc --noEmit` | 0 | **0** |
| `next lint` | 0 (0 warning) | **0** |
| `prisma validate` desktop | 0 | **0** |
| `prisma validate` serveur (avec env) | 0 | **0** |
| `next build` | 0 | **0** (15/15 pages) |
| `vitest run` | 760 OK / 26 skip | **764 OK / 26 skip** |
| `audit-ci.js` (porte prod) | passe | **passe** |

**Anomalies par sévérité** (48 au total) :

| Sévérité | Total | Corrigées | Ouvertes (recommandées) |
|---|---|---|---|
| P0 | 0 | — | **0** |
| P1 | 4 (A8, A11, A16, A24) | **4** | **0** |
| P2 | 18 | 8 | 10 |
| P3 | 26 | 6 | 20 |

→ **Critère « Zéro P0/P1 ouvert » : ATTEINT.** Les P2/P3 ouvertes sont soit des changements de comportement/métier, soit des changements de build/migration non validables dans cet environnement — toutes documentées avec correctif précis (§3, §6).

**Points non vérifiables ici** (détail et procédures §7) : gitleaks (binaire absent — scan manuel effectué, CI l'exécute), Playwright e2e (serveur+services requis), packaging electron-builder (Windows), migrations Postgres réelles + tests d'intégration seats/rate-limit (Postgres/Redis requis — exécutés en CI).

---

## 6. Corrections appliquées (Phase 6)

**18 anomalies corrigées** (diff minimal, sans changement de comportement métier voulu) :

| ID | Fichier | Nature du correctif |
|---|---|---|
| A8 | `src/app/api/vehicles/[id]/route.ts` | `assertRelations` sur `clientId` (anti-IDOR) |
| A9 | `src/app/api/jobs/[id]/route.ts` | Contrôle d'appartenance `mechanicId` dans PATCH |
| A10 | `src/app/api/estimate/route.ts` | `garageId` ajouté au `mechanic.findMany` |
| A11 | `src/app/api/garages/route.ts` | `smtpPass` retiré de la réponse GET |
| A5 | `src/app/api/portal/tickets/route.ts`, `.../appointments/route.ts` | Validation d'appartenance de `vehicleId` |
| A3 | `src/lib/auth.ts` | `bcrypt.compare` factice (anti-énumération timing) |
| A16 | `electron/main.js` | `!app.isPackaged &&` sur `IS_DEV` (fin du bypass licence) |
| A20 | `src/config/license.ts` | Suppression de `hwidMinMatch` (config morte) |
| A24/A25/A26 | `src/lib/money.ts` (+ `__tests__/money.test.ts`) | Arrondi demi-haut symétrique robuste + 4 tests |
| A29 | `src/lib/stock-forecast/plan.ts` | Garde `periodDays > 0` |
| A43 | `prisma/schema.prisma`, `prisma/server/schema.prisma` | Commentaire `smtpPass` corrigé (n'était pas chiffré) |
| A44 | `.env.example` | 5 secrets ajoutés (dont `GF_DB_MAC_SECRET` requis en prod) |
| A45 | `docs/DATABASE_ARCHITECTURE.md` | « 86 » → « 125 » entrées |
| A46 | `docs/SECURITY.md` | Section rate-limit obsolète corrigée |

**Non appliquées volontairement** (changement de comportement / build / migration non validable ici → **recommandations** avec diff précis, règle §7) : A1 (gating monitoring), A17 (fuses Electron + mode `enforce` + signature exe), A18 (URL serveur licence), A19, A27 (marge finance), A28 (FEC avoir), A31, A33/A35/A36/A37 (React data-loss/print), A47 (FK RepairTypePart → migration Postgres), A48 (index), chiffrement SMTP réel, A38-A42 (robustesse front / i18n), C1/C2.

### Contre-vérification (après corrections)

| Commande | Avant | Après |
|---|---|---|
| `tsc --noEmit` | 0 | **0** ✅ |
| `next lint` | 0 | **0** ✅ |
| `prisma validate` (×2) | 0 | **0** ✅ |
| `vitest run` | 760 OK / 26 skip | **764 OK / 26 skip** ✅ (+4 tests money) |
| `next build` | 0 | **0** ✅ (15/15 pages) |

---

## 7. Limites de cet environnement & procédures de vérification

| Élément | Pourquoi non vérifiable ici | Comment vérifier |
|---|---|---|
| gitleaks | Binaire non installé, pas d'accès github releases | CI (`.github/workflows/ci.yml` job `secrets`) ; ou `gitleaks dir . --config .gitleaks.toml --redact`. |
| Playwright e2e | Nécessite serveur Next lancé + éventuels services | `npm run build && npm start` puis `npm run test:e2e`. |
| Migrations serveur Postgres | Pas de Postgres provisionné | `node scripts/validate-server-db.js` avec `DATABASE_URL`/`DIRECT_URL` Postgres (fait en CI). |
| Packaging Electron (`dist`) | Windows/electron-builder non disponible | `npm run dist` sur Windows x64. |
| Tests d'intégration seats/rate-limit | Requièrent Postgres+Redis | Fournir `TEST_POSTGRES_URL` + `TEST_REDIS_URL` (fait en CI). |
