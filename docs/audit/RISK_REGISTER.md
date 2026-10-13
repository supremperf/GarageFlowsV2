<!-- doc-numbers: journal — comptes datés point-dans-le-temps, exempts du contrôle de compte courant (V13.1) -->
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
| AUD-005 | Haute | secrets | V2+site3 | Historique git NON purgé : blobs de secrets toujours résolvables | SECRETS_ROTATION.md (V2) ; .env.local ×4 (site3) | **V13.1 : `EXTERNAL_ACTION_REQUIRED`** — gitleaks `git log` re-confirmé (V2 4, site3 5, tous recensés ; 0 NOUVEAU ; 0 fuite fichiers suivis à HEAD). Purge = propriétaire (runbook `GIT_HISTORY_SECRET_PURGE.md`, non destructif sans autorisation). Prod : oui jusqu'à rotation | 4/23 |
| AUD-006 | Haute | secrets | V2+site3 | Rotations obligatoires déclarées NON faites (cases décochées) | SECRETS_ROTATION.md:120-122 (V2) ; :33-41 (site3) | **V13.1 : `EXTERNAL_ACTION_REQUIRED`** — mécanisme de preuve livré (`npm run verify:rotation`, `8d81488` : exit 0 = preuve cryptographique). Rotation infra (Vercel/Neon/Upstash) non exécutable ici. Aucune affirmation « rotation completed » sans preuve | 4 |
| AUD-007 | Haute | licence | V2+site3 | Licences GF-XXXX (HMAC déprécié) forgeables, réémission non tracée ; décision ECDSA en suspens | POST_ROTATION_RECOVERY.md:18 ; SECRETS_ROTATION.md:40 (site3) | **V13.1 : `BUSINESS_DECISION_REQUIRED`** — le format VIVANT `GF2.` est ECDSA P-256 (clé privée hors dépôt, `verify.ts:74`) ; le HMAC est un chemin de compatibilité. Décider sort du chemin déprécié après inventaire des licences émises. Prod : non bloquant (format sûr par défaut). Voir OPEN_ITEMS | 6 |
| AUD-008 | Haute | supply-chain | V2 | Installeur Windows NSIS non signé (aucun Authenticode) | package.json:158-169 ; SECURITY-HARDENING.md:233 | **V13.1 : `EXTERNAL_ACTION_REQUIRED`** — pipeline documenté, certificat = opérateur (« Code signing infrastructure prepared. Production Authenticode signing requires the production certificate »). Prod : oui (distribution grand public) | 13/23 |
| AUD-009 | Haute→**Corrigé** | authz | site3 | 7 routes publiques sur limiteur mémoire (inopérant serverless) | crash/contact/newsletter/notifications/route.ts | **CORRIGÉ** lot D1 `8f880af` (6 routes → limiteur distribué fail-closed ; health = exception documentée) | 4 |
| AUD-010 | Haute | authz | site3 | Clé admin unique statique, sans identité/expiration, en sessionStorage | admin/_lib/client.ts:13 ; licenses/auth.ts:29 | **V13.1 : `CODE_OPEN`** — fail-closed prouvé (`admin-auth.test.ts`, 9) ; faiblesse = MODÈLE (clé unique). Refonte identités/jetons courts à cadrer. Acquisition : non bloquant ; prod : conditionnel (interne restreint OK) | 4/6 |
| AUD-011 | Haute→**Moyenne** | authz | site3 | Notifications lisibles/acquittables par simple `licenseId` (pas de preuve d'appareil) | notifications/route.ts:15-40 ; ack/route.ts | **V13.1 : `BUSINESS_DECISION_REQUIRED`** — impact BORNÉ (diffusions, « ne renvoie jamais de donnée métier » ; vérifié dans le handler). Device-proof = déploiement 2 phases (client déployé n'envoie que licenseId, `electron/main.js:734`). Non bloquant | 4 |
| AUD-012 | Haute→**Basse** | licence | site3 | Vérificateur vitrine « rejette » le type `mechanic` | licenses/verify.ts:68 | **V13.1 : `RISK_ACCEPTED` (intentionnel, tranché)** — les licences mécanicien sont vérifiées par un chemin DÉDIÉ (`GarageFlowsV2 src/lib/license/mechanic-session.ts:81-119` : cookie gf_session typ=mechanic + base licenseType=mechanic + recordMac). La vitrine ne traite que les licences garage — par conception. Impact nul | 6 |
| AUD-013 | Critique(PI)→**Corrigé** | pi | V2+site3 | Aucun fichier LICENSE ni champ `license`, alors que « Tous droits réservés » | package.json (les 2) ; README.md:201 (site3) | **CORRIGÉ** `833dc98`/`42bafa3` (LICENSE propriétaire + `license:UNLICENSED` + lockfiles ; termes contractuels CLUF/EULA = conseil) | 11 |
| AUD-014 | Critique(RGPD)→**Partiel** | rgpd | V2+site3 | Aucun registre traitements, DPA art. 28, procédure droits/violations | PRIVACY-CRASH-REPORTING.md:37 ; rgpd/page.tsx:131 | **PARTIEL** `833dc98` : registre art. 30 (PROJET, 11 traitements) livré ; DPA + bases légales + procédures droits/violations + revue = **DPO/avocat** (externe) | 10 |
| AUD-015 | Haute→**Corrigé** | pi | V2+site3 | Aucun THIRD_PARTY_NOTICES / SBOM / inventaire licences OSS | absence vérifiée sur les 2 dépôts | **CORRIGÉ** `833dc98`/`42bafa3` (SBOM CycloneDX 106+51 composants, notices générées reproductibles, inventaire : 0 copyleft fort, LGPL sharp documentée) | 11/23 |
| AUD-016 | Haute→**Partiel** | pi | V2+site3 | Aucune provenance du code ni registre de contribution IA | branches `claude/*` ; plan lot E | **PARTIEL** `833dc98` : `docs/PROVENANCE.md` (faits observables, développement IA tracé) ; cession de droits + garantie non-contrefaçon = **conseil PI** | 11 |
| AUD-017 | Critique(test)→**Corrigé** | tests | V2 | Restauration de sauvegarde JAMAIS exécutée par un test | backup/snapshot.test.ts (« no DB ») | **CORRIGÉ** `e796ab8` (round-trip réel SQLite : backup→corruption→restore exact, scopé garage, confirmation+intégrité prouvées — 6 tests) | 16/22 |
| AUD-018 | Critique(test)→**Corrigé** | tests | site3 | `requireAdminKey` (25 routes admin) sans aucun test | licenses/auth.ts:28 | **CORRIGÉ** lot I (admin-auth.test.ts, 9 : 401/500 fail-closed, x-gf-key+Bearer valides) | 22 |
| AUD-019 | Critique(test)→**Corrigé** | tests | V2 | Isolation inter-garage non permutée sur la majorité des familles de routes | 22 tests de handler / 141 routes | **CORRIGÉ** lot C (audit statique 141 routes : 0 faille + matrice de permutation 14 familles × tous verbes + matrice de rôles 128 cellules) | 5/22 |
| AUD-020 | Haute→**Corrigé** | tests | V2 | Concurrence de numérotation de factures testée sur mock mémoire uniquement | document-numbering.test.ts | **CORRIGÉ** `84b0742` (test PG réel : 50 créations parallèles → 50 numéros distincts contigus, 0 échec) | 7/22 |
| AUD-021 | Haute→**Corrigé** | tests | V2 | Concurrence de stock prouvée sur mock mémoire, pas de décrément SQL atomique testé en réel | stock-parts.test.ts | **CORRIGÉ** lot I (stock-concurrency.postgres.int : stock 5, 10 ajouts //, 2 succès/8×409, stock=1 jamais négatif) | 12/22 |
| AUD-022 | Haute→**Partiel** | tests | V2 | Portail client : 20 routes, 0 test de handler | portal/__tests__ (fonctions pures) | **PARTIEL** lot I : handler le plus sensible couvert (portal-token-isolation, 5, cloisonnement capability-token). RESTE : login/2FA/tickets/RDV handlers | 22 |
| AUD-023 | Haute→**Partiel** | tests | V2+site3 | E2E jamais exécuté en CI ; aucun parcours métier complet | ci.yml (pas de playwright) | **PARTIEL** `e796ab8` + V13 `dc2d68d`/`351d77a` : parcours métier COMPLET bout-en-bout via vrais handlers (13 étapes, persistance vérifiée en base, échecs contrôlés) ; suite Playwright rendue réellement exécutable (gabarits WebKit→Chromium — le job CI échouait au lancement) et 3× verte contre le build de production. RESTE : parcours Playwright authentifié en CI (identifiants semés) | 22 |
| AUD-024 | Moyenne→**Partiel** | frontend | V2+site3 | CSP `script-src 'unsafe-inline' 'unsafe-eval'` sans nonce (admin inclus) | next.config.mjs:15 (V2/site3) | **PARTIEL** V13 `759532a` (V2) : `'unsafe-eval'` restreint à NODE_ENV=development — CSP de PRODUCTION vérifiée au runtime sans unsafe-eval, Playwright 3× vert contre cette instance ; garde `security-headers.test.ts` (exceptions verrouillées). RESTE : nonce pour lever `'unsafe-inline'` scripts ; même durcissement côté site3 | 4/14 |
| AUD-025 | Moyenne→**Corrigé** | pwa | V2 | `skipWaiting()` inconditionnel → rechargement forcé, perte de saisie atelier | sw.js:20 ; PwaRegister.tsx:44 | **CORRIGÉ** `e50b35d` (skipWaiting retiré de l'install ; activation sur clic « Mettre à jour » uniquement) | 14 |
| AUD-026 | Moyenne→**Partiel** | i18n | V2 | RTL/lang jamais restaurés au rechargement ; 27 composants sans i18n | i18n.tsx:53 ; layout.tsx:37 | **PARTIEL** lot H : restauration lang/dir au montage corrigée (`applyLangAttributes`, test i18n-rtl). RESTE : 27 composants à câbler sur useTranslation | 21 |
| AUD-027 | Moyenne→**Corrigé** | frontend | V2 | Aucun error boundary (error.tsx/global-error.tsx absents) | src/app (aucun) | **CORRIGÉ** lot H (error.tsx segment + global-error.tsx racine, reset + journalisation) | 14/19 |
| AUD-028 | Moyenne→**Corrigé** | a11y | V2 | StockPanel sans rôle modale/nom accessible + contrastes < 3:1 | StockPanel.tsx:108,273 | **CORRIGÉ** lot H (role=dialog/aria-modal/aria-label, noms accessibles boutons icône, contraste relevé) | 20 |
| AUD-029 | Moyenne→**Corrigé** | ci | V2 | `check-critical-files.js` fonctionnel mais câblé nulle part | check-critical-files.js:7 | **CORRIGÉ** lot I (script npm + chaîné dans check:consistency + étape ci.yml) | 23 |
| AUD-030 | Moyenne | ci | V2 | Pipeline de durcissement desktop (Fuses/intégrité) jamais exécuté en CI | ci.yml (pas de dist/afterPack) | PLAUSIBLE | 23 |
| AUD-031 | Moyenne | supply-chain | V2 | Gitleaks binaire téléchargé sans vérification de checksum ; actions sur tags mobiles | ci.yml:32,21,72 | PLAUSIBLE | 23 |
| AUD-032 | Moyenne→**Corrigé** | secrets | V2+site3 | Allowlist Gitleaks trop large (tous les .md exemptés) ; V2 ne scanne pas l'historique | .gitleaks.toml:34 (les 2) | **CORRIGÉ** `8d81488`/`51543e0` (exemption `.*\.md` retirée dans les 2 dépôts + allowlist ciblée ; découvert : scan était rouge sur fixtures test → corrigé ; 0 fuite vérifié gitleaks 8.24.3). Scan d'historique planifié = reste recommandé | 23 |
| AUD-033 | Moyenne | session | V2 | Session staff NextAuth JWT sans invalidation serveur (rôle figé ≤ 30 j) | authOptions (stratégie JWT) | PLAUSIBLE | 4 |
| AUD-034 | Moyenne→**Corrigé** | bdd/perf | V2 | Index FK manquants (QuoteLine.quoteId, InvoiceLine.invoiceId, JobPhoto.jobId…) | schema.prisma | **CORRIGÉ** `e50b35d` (5 index FK ajoutés : 2 schémas + runner SQLite 180-184 + template re-baseliné + migration PG appliquée/vérifiée) | 12/18 |
| AUD-035 | Moyenne | crypto | V2 | Recalcul `recordMac` incomplet dans revoke-by-key/PATCH admin (brique la clé) | mechanic-licenses routes | PLAUSIBLE | 6 |
| AUD-036 | Moyenne | licence | V2 | Divergence HWID keygen Python ↔ Electron malgré commentaire « cohérence CRITIQUE » | keygen_core.py ↔ electron | PLAUSIBLE | 6 |
| AUD-037 | Moyenne→**Corrigé** | authz | site3 | CORS `/api/v1/*` par défaut `*` (doc annonce l'inverse) ; blob-upload hors guardAdmin | api/http.ts:9 ; blob-upload/route.ts | **CORRIGÉ** lot D2 `cbfa5e3` (CORS défaut-refus + blob-upload rate-limit distribué + audit) | 15 |
| AUD-038 | Moyenne→**Corrigé** | secrets | site3 | `LICENSE_ADMIN_API_KEY` réutilisée comme clé HMAC des jetons SSE (rotation impossible) | sse-token.ts:15 | **CORRIGÉ** lot D2 `cbfa5e3` (secret dédié GF_SSE_SIGNING_SECRET ou dérivation à séparation de domaine) | 4 |
| AUD-039 | Moyenne | scripts | V2 | `restore.js` interactif inutilisable (rl.close avant 2e question) ; protect-resources sans dry-run | restore.js:142 ; protect-resources.js:38 | PLAUSIBLE | 24 |
| AUD-040 | Moyenne→**Corrigé** | docs | V2 | `docs/history/` référencé ×3 mais absent ; livrables cités absents | PRODUCTION-READINESS.md:8,134,165 | **CORRIGÉ** lot J `a946027` (3 réf. `docs/history/` supprimées → convention marqueur `doc-status: historique` ; check:docs vert) | 25 |
| AUD-041 | Moyenne | docs/marque | V2+site3 | « GarageFlow » sans « s » dans docs/ (V2, hors scanner) et partout dans la vitrine visible | SECURITY-HARDENING.md:1 ; site.ts:9 | PLAUSIBLE | 19/25 |
| AUD-042 | Moyenne→**Partiel** | docs | V2+site3 | Comptes de tests divergents non datés (679 vs 1040 ; 6 valeurs côté site3) | RESPONSIVE.md:67 ; TESTING.md:13 | **PARTIEL** lot J `a946027` (V2 : compte figé retiré de RESPONSIVE.md → renvoi baseline unique PRODUCTION-READINESS.md §3 ; reste : TESTING.md côté site3) | 25 |
| AUD-043 | Moyenne→**Corrigé** | légal | V2 | `docs/SIGNATURE.md` qualifie la signature d'« inviolable » (HMAC local, non eIDAS) | SIGNATURE.md:3 | **CORRIGÉ** lot J `a946027` (requalifié « sceau d'intégrité local » + bloc honnête eIDAS ; terme « inviolable » interdit par check:docs, neutralisation des lignes qui le récusent) | 9/25 |
| AUD-044 | Moyenne | juridique | site3 | Affirmations marketing (sauvegardes auto, RGPD conforme) contredites par docs internes | content.ts:198 ; securite/page.tsx:94 | PLAUSIBLE | 25/26 |
| AUD-045 | Basse | secrets | V2 | `.env` dupliqué dans `.next/standalone/` (inoffensif aujourd'hui, risque de packaging) | .next/standalone/.env | PLAUSIBLE | 24 |
| AUD-046 | Basse | licence | site3 | Tolérance HWID 75 % + `if (!storedHwid) return true` | licenses/verify.ts:146 | PLAUSIBLE | 6 |
| AUD-047 | Basse | authz | site3 | Routes update/latest, changelog, downloads sans rate limit | update/latest/route.ts | PLAUSIBLE | 4/16 |
| AUD-048 | Basse | ci | V2 | Aucune SAST (CodeQL/Semgrep) ; postinstall écrit `.env` sur tout `npm ci` | ci.yml ; package.json:18 | PLAUSIBLE | 23 |
| AUD-049 | Critique→**Corrigé** | licence/crypto | V2 | Clé publique du dépôt périmée après la rotation totale du 2026-08-08 22:16 : tout binaire/PWA construit depuis le dépôt refuse SILENCIEUSEMENT chaque licence émise par la production | public-key.ts:16 ; main.js:167 (empreinte `3150baac…` vs `1f1be919…` en production) | **CORRIGÉ** — `npm run keys:sync` + preuve bout en bout (licence réelle émise à 22:29 acceptée par `verifyLicenseToken`) | 6 |
| AUD-050 | Haute→**Corrigé** | ci/gardes | V2 | Deux gardes « clé publique » structurellement muettes : recherche d'empreintes hexadécimales dans des fichiers qui n'en contiennent aucune, et exigence d'une empreinte PÉRIMÉE satisfaite par un simple commentaire | check-critical-files.js:50-65 (avant correction) | **CORRIGÉ** — gardes reconstruites sur l'empreinte DÉRIVÉE des littéraux + liste des clés retirées tenue automatiquement ; les deux sens vérifiés par rejeu | 6/23 |
| AUD-051 | Haute→**Corrigé** | build/release | V2 | Porte de release inexécutable sous Windows : `spawnSync('sh', …)` échoue au lancement pour les 10 étapes, affichées « ÉCHEC — exit null » avec une sortie `undefined` — indiscernable d'un vrai échec | final-release-gate.mjs:34 (avant correction) | **CORRIGÉ** — exécution portable (`shell: true`), étape PostgreSQL réécrite en JS, échec de LANCEMENT distingué d'un échec de contrôle ; porte complète verte sous Windows (build inclus) | 23 |
| AUD-052 | Haute→**Corrigé** | runtime/prod | V2 | La PWA de production s'exécutait sur Node **24.x** alors que CI, baseline et docs verrouillent Node 22, avec un Next.js 14.2 antérieur à ce majeur : le seul environnement servant de vrais clients était le seul que rien ne testait | `vercel project inspect garagesite5` (Node.js Version 24.x) vs ci.yml:78,202,265 + baseline.json:11 | **CORRIGÉ** — `engines.node: "22.x"` déclaré (Vercel s'en sert pour choisir le runtime) + test de non-dérive CI↔engines↔runtime courant | 23/24 |
| AUD-053 | Basse→**Corrigé** | hygiène | V2 | `.vercel/` non ignoré : un `vercel link` local aurait committé la cible de déploiement de tout le monde | .gitignore (absence) | **CORRIGÉ** — `.vercel/` ignoré | 24 |
| AUD-054 | Haute→**Corrigé** | licence/UX | V2 | Refus d'activation présenté comme une RÉVOCATION (statut `device_limit` absent de la table de l'overlay → repli « Compte révoqué ») et diagnostic « autorité injoignable ? » émis alors que l'autorité venait de répondre | garageflow.log 2026-08-08 20:35→20:38 (clé mécanicien non attribuée) ; main.js:1234-1247 + LicenseRevokedOverlay.tsx:183 (avant correction) | **CORRIGÉ** — décision extraite dans `electron/activation-report.js` (10 tests de comportement, plus de motif textuel), statut `activation_refused` honnête, overlay idempotent survivant à un rechargement | 6/19 |
| AUD-055 | Basse→**Corrigé** | hygiène | V2 | ~20 bases SQLite `.tmp-*.db` laissées à la racine par les tests d'intégration, non ignorées : un `git add -A` après `npm test` les committait | `git status` après `vitest run` | **CORRIGÉ** — `.tmp-*.db` et `.tmp-*.db-journal` ignorés (aucune n'était déjà suivie) | 24 |
| AUD-056 | Haute | distribution | V2 | Une installation lancée par-dessus une installation de MÊME version s'est exécutée 118 s **sans écrire un seul fichier**, en silence : le poste a continué de faire tourner l'ancien paquet. Non reproduit après changement d'état — cause non établie | Observé 2026-08-08 23:38 (0 fichier modifié après coup, `app.asar` inchangé, ancien `main.js` conservé) ; installation propre à 23:43 = 19 s et conforme | **PARTIEL** — `buildId` (empreinte d'`app.asar`) journalisé au démarrage : un paquet non remplacé devient visible en une ligne. Cause racine NON identifiée ; discipline de version = opérateur | 17/23 |
| AUD-057 | Moyenne→**Corrigé** | licence/observabilité | V2 | `/api/license/activate` : QUATRE causes distinctes de refus mécanicien (licence inconnue du serveur, mauvais type, clé sans mécanicien, mécanicien absent du garage) partageaient un unique 403 sans aucune trace serveur — les journaux Vercel montraient « étape 0 : requête reçue » puis un 403 muet | Journaux de production 2026-08-09 (403 sur `/api/license/activate`) ; activate/route.ts:84-88,106,133,149 avant correction | **CORRIGÉ** — cause discriminante journalisée côté serveur ; réponse client INCHANGÉE dans les quatre cas (pas d'énumération d'identifiants) | 6/39 |
| AUD-058 | Critique→**Corrigé** | finance/réglages | V2 | `PATCH /api/garages` n'appliquait AUCUNE validation (`UpdateGarageSchema` existait, jamais appelé) : TVA 150 % persistée ; **TVA 0 % impossible** (`parseFloat(x) \|\| 20`), donc franchise art. 293 B indéclarable ; tarif horaire >4 décimales remplacé par 60 €/h en silence ; devise « EUROS » et e-mail malformé acceptés | Parcours garage réel, 2026-08-09 | **CORRIGÉ** — schéma appliqué (+ champs d'atelier ajoutés, sinon Zod les supprimait), `\|\|` remplacés, conversion monétaire stricte ; revérifié sur l'API | 7/19 |
| AUD-059 | Moyenne→**Corrigé** | api/projection | V2 | `GET /api/garages` : `return` anticipé court-circuitant `garageToEuros` → `hourlyRate` `undefined` côté client | garages/route.ts:26-31 | **CORRIGÉ** — conversion appliquée à l'objet expurgé | 19 |
| AUD-060 | Haute→**Corrigé** | stock/finance | V2 | `POST`/`PATCH /api/parts` ignoraient leurs schémas : quantité **négative** acceptée (stock −3) et prix à 6 décimales arrondi en silence | `{quantity:-3}` → 201 | **CORRIGÉ** — schémas appliqués, `parseAmountToScaled` strict | 12/19 |
| AUD-061 | Moyenne→**Corrigé** | mécaniciens | V2 | `specialty:'Moteur'` accepté en 201 puis stocké `"[]"` : spécialité perdue sans message | Création réelle d'un mécanicien | **CORRIGÉ** — le schéma exige un tableau ; la lecture tolérante (délibérée) reste intacte | 10 |

## Lot parcours garage — Utilisation réelle de bout en bout (2026-08-09)

**Méthode** : base SQLite neuve issue du modèle, serveur standalone de production
(`ELECTRON=1`, port isolé), licence garage réelle, parcours joué via l'API HTTP —
vrais handlers, vraie base, vraie validation, données accentuées.

**Quatre défauts (AUD-058 à 061), une seule cause** : des schémas présents dans
`src/lib/schemas` que les routes n'appelaient pas. Aucun n'était détectable en
lisant les tests existants ; tous sont apparus à la première utilisation
réaliste.

**Solide** : isolation multi-garage (404 sur les 5 ressources d'un autre garage,
liste vide, aucune fuite) · exactitude financière (186,91 € HT / 224,29 € TTC,
identiques au calcul indépendant) · FEC **équilibré** (débit 448,58 = crédit
448,58) · immuabilité (devis accepté et facture émise verrouillés, pas de retour
au brouillon) · numérotation contiguë · machine à états cohérente · encodage
intact de bout en bout.

**Non testé** : rendu des PDF (généré côté CLIENT par jsPDF, hors d'atteinte sans
navigateur) et interface React (aucune automatisation disponible pour Electron).

**Attention** : ces correctifs bloquent l'écriture de nouvelles valeurs invalides,
ils ne réparent pas l'existant. Une base portant déjà un taux hors bornes le
conserve — un contrôle des réglages en place est recommandé.

## Lot packaging — Cycle Windows complet (2026-08-08, nuit)

**Exécuté réellement** sur Windows 10 19045 : build → installeur NSIS →
installation silencieuse → lancement → désinstallation → réinstallation.

**Conformité du paquet** : clé publique `1f1be919…` aux deux emplacements
(`resources/keys/public.pem` et `_PK` extrait d'`app.asar`), aucun `.env`,
aucune clé privée, manifeste d'intégrité de 11 fichiers couvrant `keys/public.pem`,
Fuses conformes (relus par `@electron/fuses`), Defender sans détection,
Authenticode absent (AUD-008 inchangé).

**Preuve du P0 par l'artefact** : l'installeur présent sur disque avant cette
session embarquait `3150baacc…`, clé RETIRÉE — il aurait refusé toutes les
licences émises par la production.

**Désinstallation** : dossier vidé, deux clés de registre et deux raccourcis
supprimés, **données conservées** (`garageflow.db` d'empreinte identique avant et
après, 40 sauvegardes intactes).

**AUD-056** : la première tentative d'installation par-dessus l'existant n'a rien
écrit et n'a rien dit. Après désinstallation, l'installation a réussi en 19 s ;
une réinstallation ultérieure par-dessus le même paquet a bien restauré un
fichier témoin supprimé — le mécanisme n'est donc pas cassé en général et la
cause reste inconnue. Ce qui est corrigé, c'est l'INVISIBILITÉ : `buildId` rend
deux paquets de même version distinguables dès la première ligne du journal.

**AUD-056 — SECONDE OCCURRENCE (2026-08-09 01:03), signature obtenue.**
Reproduit une deuxième fois, et cette fois le code de sortie a été capturé :

| | installation par-dessus (échec) | installation après désinstallation |
|---|---|---|
| durée | 118 s, puis 163,7 s | 19 à 22 s |
| code de sortie | **2** | 0 |
| fichiers écrits | **aucun** | 2330 |

Le code 2 est celui que `handleUninstallResult` (app-builder-lib) pose —
`SetErrorLevel 2` puis `Quit` — lorsque le désinstalleur de la version en place
rend un code non nul. L'application NE tournait PAS (arrêtée 7 min plus tôt,
journal à l'appui), et le même désinstalleur, lancé SEUL juste après, a rendu
**0 en 2,1 s** en nettoyant correctement. L'échec est donc intermittent et se
situe dans l'enchaînement installeur → désinstalleur, pas dans le désinstalleur.
Les deux occurrences suivent immédiatement un build ayant écrit ~1 Go (analyse
antivirus en cours plausible, non prouvée).

Règle opérationnelle sûre en attendant : **désinstaller avant d'installer**, ou
vérifier le `buildId` au démarrage — c'est lui qui a rendu les deux échecs
visibles au lieu de les laisser passer pour des succès.

## Lot rotation — Réalignement cryptographique post-rotation (2026-08-08, soir)

**Contexte** : l'opérateur a exécuté une rotation cryptographique TOTALE le
2026-08-08 à 22:16 (nouvelle paire ECC P-256, `GF_PRIVATE_KEY` de production
régénérée, 19 variables Vercel recréées, table `LicenseKey` purgée). Elle a mis à
jour son dossier de build local — **pas le dépôt**, qui n'est pas le même
répertoire.

**Constat** (AUD-049) : le dépôt embarquait encore `3150baac…` tandis que la clé
privée déployée en production dérive `1f1be919…`. C'est la TROISIÈME occurrence
du même défaut (`f6ef4db`, puis `a6fbff7`) : la clé est recopiée à la main dans
trois fichiers, et une rotation n'en met jamais à jour la totalité.

**Preuves** :
- empreinte SPKI-DER de la clé privée de production = `1f1be919…` (dérivée
  localement, la clé privée n'a jamais quitté son fichier) ;
- une licence réellement émise APRÈS la rotation (2026-08-08 22:29) est
  désormais ACCEPTÉE par `verifyLicenseToken`, et sa variante à signature
  altérée REJETÉE (`GF_TEST_LICENSE`, 5 tests verts) ;
- la production tourne sur un déploiement créé à 22:17:47, soit 72 s après
  l'écriture de la nouvelle paire : elle porte donc déjà la bonne clé. Le dépôt
  était le seul point de divergence — mais un push l'aurait propagée à la PWA.

**Correction structurelle** : `npm run keys:sync` propage `keys/public.pem` vers
les TROIS ancrages en une commande et inscrit l'empreinte sortante parmi les
clés retirées (une re-rotation vers une clé anciennement retirée l'en retire
symétriquement). `npm run keys:check` refuse la divergence sans rien écrire, et
s'annonce NON EXÉCUTÉ — jamais vert — là où `keys/public.pem` est absent.

**Vérification des gardes** (AUD-050) : les deux nouveaux contrôles ont été
éprouvés par rejeu réel — retour forcé à la clé retirée → refus avec exit 1 ;
retour à la clé de production → acceptation. Aucune garde n'est déclarée
opérante sans avoir été vue mordre.

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

## Lot financier — Revérification (priorité #3, 2026-08-06)

Commit `84b0742` (V2). Les corrections d'immutabilité (AUD-001/002/004) ayant
été faites au lot P0/P7, ce lot revérifie numérotation, concurrence, FEC et
zéro-Float avec **preuves exécutées** :

- **Numérotation sous concurrence réelle (AUD-020) → CORRIGÉ**. Cluster
  PostgreSQL 16 local jetable (initdb + pg_ctl sous utilisateur non-root),
  schéma serveur poussé (`prisma db push`). Nouveau test
  `document-numbering.postgres.int.test.ts` : 50 `POST /api/invoices` en
  parallèle via le vrai handler → **50 numéros distincts et contigus (001..050),
  compteur = 50, 0 échec**. Confirme que le verrou de ligne sur `garage.update`
  (increment atomique) sérialise les incréments — pas de doublon ni de P2002.
  Résultat exécuté ici : 1/1 vert. Rejoué en CI via le service postgres:16.
- **Conformité FEC** : libellé TVA au taux réel (plus figé à 20 %) ; nom de
  fichier DGFiP `<SIREN>FEC<AAAAMMJJ>.txt`. Test `fec-export.test.ts` (7) :
  équilibre débit/crédit de chaque écriture, taux 10 %/5,5 %, autorisation.
- **Zéro Float monétaire re-prouvé** : `check:money`, `check:money-calculations`,
  `check:money-json` verts (534 fichiers, stockage 100 % entiers exacts).

**Résiduel (revue expert-comptable, assignée dans le plan)** : imputation 706
(services) vs 707 (ventes de pièces) ; hypothèse de clôture au 31/12 pour un
exercice décalé ; sous-comptes de TVA distincts par taux. Ces points relèvent
d'une validation comptable, hors compétence de l'audit technique.

## Lot secrets — Preuve de rotation & durcissement du scan (priorité #4, 2026-08-06)

Commits `8d81488` (V2), `51543e0` (garagesite3). Principe appliqué : « aucun
secret exposé n'est sûr sans preuve ». Aucune action destructive (la purge
d'historique reste au propriétaire, avec rollback documenté §4).

- **Mécanisme de preuve de rotation (AUD-005/006)** : `scripts/verify-rotation
  .mjs` + manifeste `compromised-secrets.json` comparent l'empreinte SHA-256 du
  secret ACTUEL aux empreintes des valeurs compromises. Exit 1 si un secret est
  encore la valeur exposée ; `--require-all` → exit 2 si un secret manque.
  Jamais de valeur affichée. Les 3 codes de sortie sont démontrés ; la mécanique
  est prouvée par `verify-rotation.test.ts` (5). L'opérateur lance
  `npm run verify:rotation` en production pour produire l'artefact de preuve.
- **Gitleaks durci (AUD-032)** : suppression de l'exemption globale `.*\.md`
  (55 docs V2 + README/14 docs site3) au profit de regexes ciblées. **Découverte
  au passage** : 3 fichiers de test portant des clés-fixtures n'étaient pas
  allowlistés → gitleaks sortait en échec (le scan de secrets était donc
  effectivement rouge, indépendamment de l'exemption .md). Corrigé et vérifié
  0 fuite avec gitleaks 8.24.3 sur `git archive HEAD` des deux dépôts.

**Résiduels (non exécutables ici, assignés)** :
- Rotation effective des secrets en production (Vercel/Neon) — opérateur ; la
  preuve se produit ensuite via `verify:rotation`.
- Purge de l'historique git (`git filter-repo`) — propriétaire du dépôt, après
  rotation, avec sauvegarde miroir (runbook §4). Un fork/cache GitHub conserve
  les valeurs indépendamment de la purge → la rotation est le vrai correctif.
- Scan d'historique planifié (hors chemin critique PR) — recommandé pour V2.

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
3. ~~**Clé ECDSA de licence** : l'état actuel de `GF_PRIVATE_KEY` en production est-il l'ancienne paire (empreinte publique `7bed…`) ou la nouvelle ?~~ **TRANCHÉE le 2026-08-08** : ni l'une ni l'autre. Une rotation totale à 22:16 a produit une TROISIÈME paire ; `GF_PRIVATE_KEY` de production dérive l'empreinte publique `1f1be919…`, vérifié localement. Le dépôt a été réaligné (AUD-049) et une licence émise après la rotation est prouvée acceptée. `7bed…` et `3150baac…` sont désormais inscrites parmi les clés RETIRÉES, dont le retour est refusé par `check:critical-files`.
4. **Licences GF-XXXX HMAC** : réémises en tokens ECDSA GF2 ? Combien restent falsifiables ?
5. **Anciennes clés au repos** (`GF_SMTP_CIPHER_KEY`, `GF_TOTP_ENC_KEY`, `GF_BACKUP_KEY`) conservées avant la rotation du 2026-08-04 ? Sinon SMTP/2FA/sauvegardes antérieures définitivement perdus.
6. **Type de licence `mechanic`** : doit-il être accepté par la vitrine ou est-il délibérément confiné à l'app (rejet à tester explicitement) ?
7. **Entité juridique éditrice** (raison sociale, SIREN, directeur de publication) et variables `NEXT_PUBLIC_LEGAL_*` renseignées en production ? Sinon non-conformité LCEN.
8. **Sous-traitants** (Neon, Vercel, Upstash, SMTP) sous contrat art. 28 et instances localisées UE, comme l'affirme la page RGPD publique ?
9. **Consentement cookies** : un mécanisme existe-t-il ? Aucun composant trouvé dans la vitrine alors que la page RGPD le promet.
10. **Protections de branche GitHub** (revue obligatoire, checks requis, interdiction de force-push) — non vérifiables depuis le dépôt local ; la CI n'est bloquante que si le job `check` est `required` sur `main`.
11. **Cible de déploiement** exclusivement Vercel (où `VERCEL=1` fournit l'IP de confiance) ou hébergement alternatif (auquel cas `TRUST_PROXY_HEADERS` doit être documenté et le repli `unverified` fusionne tous les clients) ?
12. **Pipeline de release** : aucun workflow de release ; sur quelle machine `npm run dist` est-il exécuté, et la clé du manifeste d'intégrité (`electron/integrity.js`) est-elle recalculable par un attaquant qui obtient le `.exe` ?
