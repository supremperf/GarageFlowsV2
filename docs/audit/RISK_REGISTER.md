# Registre de risques — Audit maître GarageFlows

> Consolidation des 12 cartographies en lecture seule (Phase 0/1) sur les deux
> dépôts : **GarageFlowsV2** (application, HEAD de départ `cec7588`) et
> **garagesite3** (vitrine + control-plane, `2d56142`). Chaque risque cite une
> preuve `fichier:ligne`. Sévérité honnête ; aucun secret en clair.
>
> **Statut de vérification** : `PLAUSIBLE` = rapporté par un lecteur de
> cartographie, non encore reproduit par l'auditeur ; `CONFIRMÉ` = reproduit et
> vérifié par lecture directe de l'auditeur ; `CORRIGÉ` = correctif appliqué et
> testé dans cette session (commit référencé).
>
> Mise à jour : 2026-08-06. Les items marqués « garagesite3 » relèvent du dépôt
> vitrine/control-plane. La priorisation reprend l'ordre du prompt maître :
> 1) perte de données, 2) fuite inter-garages, 3) exactitude financière,
> 4) licences/sessions, 5) PI, 6) conformité, 7) résilience.

## Tableau de synthèse

| ID | Sévérité | Domaine | Dépôt | Titre | Preuve | État | Phase |
|---|---|---|---|---|---|---|---|
| AUD-001 | Haute→**Corrigé** | finance | V2 | Immutabilité facture émise contournable (retour à `draft` puis ré-édition/suppression) | invoices/[id]/route.ts:35-61 | **CORRIGÉ** `a5044a0` | 7 |
| AUD-002 | Haute→**Corrigé** | finance/légal | V2 | OR signé supprimable via rétrogradation de statut | work-orders/[id]/route.ts:92,119,170 | **CORRIGÉ** `a5044a0` | 9 |
| AUD-003 | Haute→**Corrigé** | electron/sécurité | V2 | Garde de navigation inopérante : `localOrigin` indéfini → échec ouvert | main.js:1898,1907 | **CORRIGÉ** `a5044a0` | 13 |
| AUD-004 | Moyenne→**Corrigé** | finance | V2 | Devis accepté modifiable + lignes remplacées hors transaction | quotes/[id]/route.ts:36-52 | **CORRIGÉ** `a5044a0` | 7 |
| AUD-005 | Haute | secrets | V2+site3 | Historique git NON purgé : blobs de secrets toujours résolvables | SECRETS_ROTATION.md (V2) ; .env.local ×4 (site3) | PLAUSIBLE | 4/23 |
| AUD-006 | Haute | secrets | V2+site3 | Rotations obligatoires déclarées NON faites (cases décochées) | SECRETS_ROTATION.md:120-122 (V2) ; :33-41 (site3) | PLAUSIBLE | 4 |
| AUD-007 | Haute | licence | V2+site3 | Licences GF-XXXX (HMAC déprécié) forgeables, réémission non tracée ; décision ECDSA en suspens | POST_ROTATION_RECOVERY.md:18 ; SECRETS_ROTATION.md:40 (site3) | PLAUSIBLE | 6 |
| AUD-008 | Haute | supply-chain | V2 | Installeur Windows NSIS non signé (aucun Authenticode) | package.json:158-169 ; SECURITY-HARDENING.md:233 | PLAUSIBLE | 13/23 |
| AUD-009 | Haute→**Corrigé** | authz | site3 | 7 routes publiques sur limiteur mémoire (inopérant serverless) | crash/contact/newsletter/notifications/route.ts | **CORRIGÉ** lot D1 `8f880af` (6 routes → limiteur distribué fail-closed ; health = exception documentée) | 4 |
| AUD-010 | Haute | authz | site3 | Clé admin unique statique, sans identité/expiration, en sessionStorage | admin/_lib/client.ts:13 ; licenses/auth.ts:29 | PLAUSIBLE — refonte (identités + expiration) hors périmètre d'un correctif isolé, à cadrer | 4/6 |
| AUD-011 | Haute | authz | site3 | Notifications lisibles/acquittables par simple `licenseId` (pas de preuve d'appareil) | notifications/route.ts:22 ; ack/route.ts:26 | PLAUSIBLE — enforcement casserait les clients déployés (electron/main.js:734 n'envoie que licenseId) ; **déploiement coordonné 2 phases requis** ; impact réel faible (diffusions, aucune donnée métier) | 4 |
| AUD-012 | Haute | licence | site3 | Vérificateur vitrine ignore le type `mechanic` : licence mécanicien rejetée | licenses/verify.ts:12,68,127 | PLAUSIBLE — question ouverte : rejet intentionnel (licences mécanicien confinées à l'app) ? à confirmer puis tester explicitement | 6 |
| AUD-013 | Critique(PI) | pi | V2+site3 | Aucun fichier LICENSE ni champ `license`, alors que « Tous droits réservés » | package.json (les 2) ; README.md:201 (site3) | PLAUSIBLE | 11 |
| AUD-014 | Critique(RGPD) | rgpd | V2+site3 | Aucun registre traitements, DPA art. 28, procédure droits/violations | PRIVACY-CRASH-REPORTING.md:37 ; rgpd/page.tsx:131 | PLAUSIBLE | 10 |
| AUD-015 | Haute | pi | V2+site3 | Aucun THIRD_PARTY_NOTICES / SBOM / inventaire licences OSS | absence vérifiée sur les 2 dépôts | PLAUSIBLE | 11/23 |
| AUD-016 | Haute | pi | V2+site3 | Aucune provenance du code ni registre de contribution IA | branches `claude/*` ; plan lot E | PLAUSIBLE | 11 |
| AUD-017 | Critique(test) | tests | V2 | Restauration de sauvegarde JAMAIS exécutée par un test | backup/snapshot.test.ts (« no DB ») | PLAUSIBLE | 16/22 |
| AUD-018 | Critique(test) | tests | site3 | `requireAdminKey` (25 routes admin) sans aucun test | licenses/auth.ts:28 | PLAUSIBLE | 22 |
| AUD-019 | Critique(test)→**Corrigé** | tests | V2 | Isolation inter-garage non permutée sur la majorité des familles de routes | 22 tests de handler / 141 routes | **CORRIGÉ** lot C (audit statique 141 routes : 0 faille + matrice de permutation 14 familles × tous verbes + matrice de rôles 128 cellules) | 5/22 |
| AUD-020 | Haute | tests | V2 | Concurrence de numérotation de factures testée sur mock mémoire uniquement | document-numbering.test.ts | PLAUSIBLE | 7/22 |
| AUD-021 | Haute | tests | V2 | Concurrence de stock prouvée sur mock mémoire, pas de décrément SQL atomique testé en réel | stock-parts.test.ts | PLAUSIBLE | 12/22 |
| AUD-022 | Haute | tests | V2 | Portail client : 20 routes, 0 test de handler | portal/__tests__ (fonctions pures) | PLAUSIBLE | 22 |
| AUD-023 | Haute | tests | V2+site3 | E2E jamais exécuté en CI ; aucun parcours métier complet | ci.yml (pas de playwright) | PLAUSIBLE | 22 |
| AUD-024 | Moyenne | frontend | V2+site3 | CSP `script-src 'unsafe-inline' 'unsafe-eval'` sans nonce (admin inclus) | next.config.mjs:15 (V2/site3) | PLAUSIBLE | 4/14 |
| AUD-025 | Moyenne | pwa | V2 | `skipWaiting()` inconditionnel → rechargement forcé, perte de saisie atelier | sw.js:20 ; PwaRegister.tsx:44 | PLAUSIBLE | 14 |
| AUD-026 | Moyenne | i18n | V2 | RTL/lang jamais restaurés au rechargement ; 27 composants sans i18n | i18n.tsx:53 ; layout.tsx:37 | PLAUSIBLE | 21 |
| AUD-027 | Moyenne | frontend | V2 | Aucun error boundary (error.tsx/global-error.tsx absents) | src/app (aucun) | PLAUSIBLE | 14/19 |
| AUD-028 | Moyenne | a11y | V2 | StockPanel sans rôle modale/nom accessible + contrastes < 3:1 | StockPanel.tsx:108,273 | PLAUSIBLE | 20 |
| AUD-029 | Moyenne | ci | V2 | `check-critical-files.js` fonctionnel mais câblé nulle part | check-critical-files.js:7 | PLAUSIBLE | 23 |
| AUD-030 | Moyenne | ci | V2 | Pipeline de durcissement desktop (Fuses/intégrité) jamais exécuté en CI | ci.yml (pas de dist/afterPack) | PLAUSIBLE | 23 |
| AUD-031 | Moyenne | supply-chain | V2 | Gitleaks binaire téléchargé sans vérification de checksum ; actions sur tags mobiles | ci.yml:32,21,72 | PLAUSIBLE | 23 |
| AUD-032 | Moyenne | secrets | V2+site3 | Allowlist Gitleaks trop large (tous les .md exemptés) ; V2 ne scanne pas l'historique | .gitleaks.toml:34 (les 2) | PLAUSIBLE | 23 |
| AUD-033 | Moyenne | session | V2 | Session staff NextAuth JWT sans invalidation serveur (rôle figé ≤ 30 j) | authOptions (stratégie JWT) | PLAUSIBLE | 4 |
| AUD-034 | Moyenne | bdd/perf | V2 | Index FK manquants (QuoteLine.quoteId, InvoiceLine.invoiceId, JobPhoto.jobId…) | schema.prisma | PLAUSIBLE | 12/18 |
| AUD-035 | Moyenne | crypto | V2 | Recalcul `recordMac` incomplet dans revoke-by-key/PATCH admin (brique la clé) | mechanic-licenses routes | PLAUSIBLE | 6 |
| AUD-036 | Moyenne | licence | V2 | Divergence HWID keygen Python ↔ Electron malgré commentaire « cohérence CRITIQUE » | keygen_core.py ↔ electron | PLAUSIBLE | 6 |
| AUD-037 | Moyenne→**Corrigé** | authz | site3 | CORS `/api/v1/*` par défaut `*` (doc annonce l'inverse) ; blob-upload hors guardAdmin | api/http.ts:9 ; blob-upload/route.ts | **CORRIGÉ** lot D2 `cbfa5e3` (CORS défaut-refus + blob-upload rate-limit distribué + audit) | 15 |
| AUD-038 | Moyenne→**Corrigé** | secrets | site3 | `LICENSE_ADMIN_API_KEY` réutilisée comme clé HMAC des jetons SSE (rotation impossible) | sse-token.ts:15 | **CORRIGÉ** lot D2 `cbfa5e3` (secret dédié GF_SSE_SIGNING_SECRET ou dérivation à séparation de domaine) | 4 |
| AUD-039 | Moyenne | scripts | V2 | `restore.js` interactif inutilisable (rl.close avant 2e question) ; protect-resources sans dry-run | restore.js:142 ; protect-resources.js:38 | PLAUSIBLE | 24 |
| AUD-040 | Moyenne | docs | V2 | `docs/history/` référencé ×3 mais absent ; livrables cités absents | PRODUCTION-READINESS.md:8,134,165 | EN COURS (lot A) | 25 |
| AUD-041 | Moyenne | docs/marque | V2+site3 | « GarageFlow » sans « s » dans docs/ (V2, hors scanner) et partout dans la vitrine visible | SECURITY-HARDENING.md:1 ; site.ts:9 | PLAUSIBLE | 19/25 |
| AUD-042 | Moyenne | docs | V2+site3 | Comptes de tests divergents non datés (679 vs 1040 ; 6 valeurs côté site3) | RESPONSIVE.md:67 ; TESTING.md:13 | PLAUSIBLE | 25 |
| AUD-043 | Moyenne | légal | V2 | `docs/SIGNATURE.md` qualifie la signature d'« inviolable » (HMAC local, non eIDAS) | SIGNATURE.md:3 | PLAUSIBLE | 9/25 |
| AUD-044 | Moyenne | juridique | site3 | Affirmations marketing (sauvegardes auto, RGPD conforme) contredites par docs internes | content.ts:198 ; securite/page.tsx:94 | PLAUSIBLE | 25/26 |
| AUD-045 | Basse | secrets | V2 | `.env` dupliqué dans `.next/standalone/` (inoffensif aujourd'hui, risque de packaging) | .next/standalone/.env | PLAUSIBLE | 24 |
| AUD-046 | Basse | licence | site3 | Tolérance HWID 75 % + `if (!storedHwid) return true` | licenses/verify.ts:146 | PLAUSIBLE | 6 |
| AUD-047 | Basse | authz | site3 | Routes update/latest, changelog, downloads sans rate limit | update/latest/route.ts | PLAUSIBLE | 4/16 |
| AUD-048 | Basse | ci | V2 | Aucune SAST (CodeQL/Semgrep) ; postinstall écrit `.env` sur tout `npm ci` | ci.yml ; package.json:18 | PLAUSIBLE | 23 |

## Lot C — Isolation multi-garage : conclusion (2026-08-06)

**Résultat** : AUCUNE faille d'isolation (IDOR) trouvée sur les 141 routes. Le
risque AUD-019 était un trou de PREUVE (isolation non testée systématiquement),
pas une vulnérabilité. Il est désormais prouvé sur les deux plans :

1. **Audit statique adversarial** (workflow, 8 groupes couvrant les ~56 familles,
   chaque opération Prisma vérifiée puis chaque faille alléguée soumise à un
   vérificateur adversarial) : `totalAlleged: 0, confirmed: 0`. Toutes les routes
   confirmées scopées par garageId — y compris les cas subtils : jetons de
   capability portail (jobId ET garageId proviennent du JWT signé, non
   forgeable), anti-traversal photos + contrôle de propriété, injection de FK
   systématiquement validée via `assertRelations`/`findFirst` avant usage.
2. **Matrice de permutation end-to-end** (`tenant-isolation-matrix.test.ts`, 38
   tests) : session garage A → ressource garage B sur 14 familles × chaque verbe
   exporté (GET/PATCH/PUT/DELETE/POST) → statut ≥ 400 ET ressource de B intacte ;
   contrôles positifs (A accède aux siennes) ; scoping de 10 collections.
3. **Matrice de rôles exhaustive** (`authz-full-matrix.test.ts`, 139 tests) : les
   4 × 32 = 128 cellules rôle × permission asserties contre une table attendue
   indépendante (détecte toute dérive), + deny-by-default + hiérarchie stricte.

**Hardening appliqué** : `parts/[id]` DELETE faisait un `delete` direct
(P2025/500 pour une pièce d'un autre garage — pas une fuite, mais contrat
incohérent). Aligné sur le motif `findFirst → 404` de toutes les autres routes.

**Risque résiduel** : le PATCH de purchase-orders n'a pas de machine à états
(noté par l'audit, hors périmètre isolation) → à traiter au lot financier (D3).
Les espaces mécanicien et portail sont audités SÛRS mais leurs handlers restent
peu couverts par des tests d'intégration dédiés (AUD-022) → lot tests.

## Lot D — Durcissement authz du control-plane (garagesite3, 2026-08-06)

Deux commits sur `garagesite3` (branche `claude/garageflow-final-unified-merge-ub0l67`) :

**D1 `8f880af` — limiteur de débit fail-closed distribué (AUD-009)**. Six
routes abuse-sensibles (crash, contact, newsletter, notifications,
notifications/ack, admin/stream SSE) migrées du limiteur mémoire — inopérant
sur serverless multi-instances — vers le limiteur distribué Upstash via un
garde centralisé `enforceDistributedLimit` : 503 SERVICE_UNAVAILABLE si le
limiteur est indisponible en production (fail-closed), 429 au dépassement.
**Exception délibérée et documentée** : `health` conserve le limiteur mémoire —
une sonde de vivacité doit rester observable indépendamment de Redis ; la rendre
fail-closed renverrait « degraded » alors que l'app est saine. Preuve :
`rate-guard.test.ts` (503 fail-closed prod, 429 corps métier, pass-through).

**D2 `cbfa5e3` — CORS, blob-upload, jeton SSE (AUD-037, AUD-038)**.
- CORS défaut-refus : `corsHeaders()` calculé à la requête, aucun ACAO sans
  `GARAGEFLOW_API_CORS_ORIGIN` (l'ancien `*` contredisait la doc). Preuve :
  `cors.test.ts`.
- blob-upload : limiteur distribué (30/min/IP) + audit des tentatives ; clé
  invalide → 401 tracé (la clé transite par clientPayload, contrainte
  @vercel/blob → ne peut passer par guardAdmin).
- jeton SSE : clé de signature séparée de `LICENSE_ADMIN_API_KEY` (secret dédié
  ou dérivation à séparation de domaine). Preuve : `sse-token-key.test.ts` — un
  jeton forgé à la clé admin brute est désormais **rejeté**.

**Résiduels non corrigés (décisions honnêtes)** :
- **AUD-011** (notifications sans preuve d'appareil) : NON corrigé
  unilatéralement — l'enforcement casserait tous les clients déployés
  (`electron/main.js:734` n'envoie que `licenseId`). Nécessite un déploiement
  coordonné en 2 phases (client envoie le deviceToken → serveur l'exige). Impact
  réel faible (notifications de diffusion, aucune donnée métier). Procédure de
  retour arrière préservée en ne modifiant pas le contrat.
- **AUD-047** (update/latest, changelog, downloads sans rate limit) : différé.
  Les rendre fail-closed casserait la vérification de mise à jour de TOUS les
  clients pendant une panne Redis (tradeoff de disponibilité défavorable pour un
  risque « basse »). À traiter avec un limiteur soft dédié.
- **AUD-010** (clé admin unique statique) : refonte (identités par opérateur +
  expiration + révocation fine) hors périmètre d'un correctif isolé — à cadrer.
- **AUD-012** (type `mechanic` rejeté par la vitrine) : question ouverte
  (rejet intentionnel ?) — à confirmer avec le propriétaire puis tester.

## Détail des risques critiques et hauts

### AUD-001 — Immutabilité facture émise contournable — **CORRIGÉ**
**Cause** : le seul verrou (`invoices/[id]/route.ts:35`) ne se déclenchait que si `body.lines` ou `body.taxRate` étaient présents ; un `PATCH {status:'draft'}` seul passait et repassait la facture émise en brouillon (ligne 61), la rendant ré-éditable/supprimable. **Impact** : perte de données comptables, trous dans la série FEC, altération d'une facture légalement figée. **Correctif** (`a5044a0`) : `src/lib/document-status.ts` refuse tout retour à `draft` (409) ; DELETE désormais non contournable. Preuve : `document-immutability.test.ts` (facture payée → 409 ; suppression → 409).

### AUD-002 — OR signé supprimable — **CORRIGÉ**
**Cause** : la garde « signé » (`work-orders/[id]/route.ts:92`) ne couvrait que lignes/TVA, pas `status` ; après `PATCH {status:'draft'}` le DELETE (ligne 170) effaçait le document signé. **Impact** : destruction d'une preuve juridique signée. **Correctif** (`a5044a0`) : transition vers `draft` bloquée + DELETE d'un OR signé refusé quel que soit le statut (`isDeletable('workOrder', …, {signed})`).

### AUD-003 — Garde de navigation Electron en échec ouvert — **CORRIGÉ**
**Cause** : `electron/main.js:1898,1907` passait `localOrigin`, variable jamais définie → `ReferenceError` levée avant `event.preventDefault()`, laissant la navigation se poursuivre. **Impact** : une redirection 3xx du serveur loopback ou un XSS aurait pu naviguer plein-cadre vers une origine étrangère avec le pont preload attaché. **Correctif** (`a5044a0`) : `const localOrigin = new URL(APP_URL).origin`.

### AUD-005 / AUD-006 / AUD-007 — Secrets historiques & rotations (cluster)
**Cause** : blobs `keys/server_config.json`, `keys/licenses_db.json` (V2) et `.env.local` ×4 (site3) toujours résolvables dans l'historique git ; `docs/SECRETS_ROTATION.md` laisse « rotation GARAGEFLOW_API_KEY », « NEXTAUTH_SECRET distinct » et « purge historique » décochées ; licences GF-XXXX signées par l'ancien secret HMAC déclarées forgeables sans réémission tracée ; décision ECDSA (clé privée nouvelle vs publique ancienne) en suspens. **Impact** : si les rotations ne sont pas faites, ces secrets restent EXPLOITABLES, pas seulement exposés — passage possible en critique. **Action** : rotation confirmée + purge d'historique + réémission des licences (opérateur, lot C/E ; non exécutable ici). **Nuance** : ces risques sont documentés et assumés dans les runbooks — c'est la preuve d'exécution qui manque.

### AUD-008 — Installeur non signé
**Cause** : `package.json` build.win sans `signtoolOptions`/certificat. **Impact** : SmartScreen alerte ; un installeur substitué est indiscernable. Le binaire est durci en interne (Fuses + manifeste HMAC) mais rien n'authentifie l'origine du `.exe`. **Action** : Authenticode (opérateur Windows, lot F).

### AUD-009 / AUD-010 / AUD-011 / AUD-012 — Control-plane vitrine (cluster authz/licence)
Sept routes publiques utilisent le limiteur mémoire (contournable par parallélisme sur Vercel) ; la clé admin unique statique en sessionStorage n'a ni identité ni expiration ni révocation fine ; les notifications sont lisibles/masquables par simple `licenseId` sans preuve d'appareil (énumération, contrairement à `/api/license/status` qui refuse explicitement ce motif) ; le vérificateur de la vitrine rejette le type `mechanic` alors que le keygen l'émet. **Action** : lot C/D (durcissement authz control-plane) — dépôt garagesite3.

### AUD-013 / AUD-014 / AUD-015 / AUD-016 — Manques de due diligence PI & RGPD (cluster)
Aucun fichier LICENSE ni champ `license` (les deux dépôts revendiquent pourtant « Tous droits réservés ») ; aucun THIRD_PARTY_NOTICES/SBOM alors que le produit est distribué en binaire Electron (MIT/Apache/BSD exigent la reproduction des notices) ; aucune provenance du code ni registre de contribution IA (branches `claude/*`) ; aucun registre de traitements RGPD, DPA art. 28, ni procédure droits/violations, alors que l'éditeur est sous-traitant de données de clients finaux. **Action** : lot E (SBOM, notices, registres — préparés ici ; revue juridique = avocat/DPO).

### AUD-017 / AUD-018 / AUD-019 — Trous de test critiques (cluster)
La restauration de sauvegarde n'est jamais exécutée (seul le chiffrement l'est) — le chemin qui compte en sinistre n'est pas prouvé ; `requireAdminKey` (25 routes admin de la vitrine) n'a aucun test ; l'isolation inter-garage n'est permutée A→B que sur 5-6 familles sur ~56 (les primitives sont prouvées, leur câblage effectif par route ne l'est pas). **Action** : lot C/I (tests de restauration, permutations systématiques, tests de handler admin).

## Questions ouvertes consolidées (dédupliquées)

1. **Rotations de secrets** : les rotations de `GARAGEFLOW_API_KEY`, `NEXTAUTH_SECRET` distinct, mot de passe Neon, `LICENSE_ADMIN_API_KEY` ont-elles été réellement exécutées en production (aucune trace datée dans les dépôts) ? Sans confirmation, AUD-005/006 passent en critique.
2. **Purge d'historique git** planifiée pour l'un ou l'autre dépôt ? Les blobs sont résolvables aujourd'hui ; un fork/cache GitHub conserverait les valeurs indépendamment d'une purge future.
3. **Clé ECDSA de licence** : l'état actuel de `GF_PRIVATE_KEY` en production est-il l'ancienne paire (empreinte publique `7bed…`) ou la nouvelle ? Conditionne la validité de toutes les licences émises.
4. **Licences GF-XXXX HMAC** : réémises en tokens ECDSA GF2 ? Combien restent falsifiables ?
5. **Anciennes clés au repos** (`GF_SMTP_CIPHER_KEY`, `GF_TOTP_ENC_KEY`, `GF_BACKUP_KEY`) conservées avant la rotation du 2026-08-04 ? Sinon SMTP/2FA/sauvegardes antérieures définitivement perdus.
6. **Type de licence `mechanic`** : doit-il être accepté par la vitrine ou est-il délibérément confiné à l'app (rejet à tester explicitement) ?
7. **Entité juridique éditrice** (raison sociale, SIREN, directeur de publication) et variables `NEXT_PUBLIC_LEGAL_*` renseignées en production ? Sinon non-conformité LCEN.
8. **Sous-traitants** (Neon, Vercel, Upstash, SMTP) sous contrat art. 28 et instances localisées UE, comme l'affirme la page RGPD publique ?
9. **Consentement cookies** : un mécanisme existe-t-il ? Aucun composant trouvé dans la vitrine alors que la page RGPD le promet.
10. **Protections de branche GitHub** (revue obligatoire, checks requis, interdiction de force-push) — non vérifiables depuis le dépôt local ; la CI n'est bloquante que si le job `check` est `required` sur `main`.
11. **Cible de déploiement** exclusivement Vercel (où `VERCEL=1` fournit l'IP de confiance) ou hébergement alternatif (auquel cas `TRUST_PROXY_HEADERS` doit être documenté et le repli `unverified` fusionne tous les clients) ?
12. **Pipeline de release** : aucun workflow de release ; sur quelle machine `npm run dist` est-il exécuté, et la clé du manifeste d'intégrité (`electron/integrity.js`) est-elle recalculable par un attaquant qui obtient le `.exe` ?
