<!-- doc-numbers: journal -->
<!-- doc-status: actif -->

# Open Items — risques résiduels classifiés (V13.1)

Chaque item porte un **statut obligatoire** parmi :
`CODE_OPEN` · `EXTERNAL_ACTION_REQUIRED` · `EXTERNAL_VALIDATION_REQUIRED` ·
`BUSINESS_DECISION_REQUIRED` · `RISK_ACCEPTED` · `FIXED_AWAITING_VERIFICATION` ·
`CLOSED`.

Colonnes : sévérité · composant · impact · preuve (fichier:ligne / test) ·
action · propriétaire logique · **bloque acquisition** (Acq) · **bloque
production** (Prod). « Bloque acquisition » = empêche une due diligence sérieuse
(≈ jamais, si documenté) ; « Bloque production » = empêche un déploiement réel.

## Cluster secrets & rotation

### AUD-005 — Secrets présents dans l'historique git
- **Statut : `EXTERNAL_ACTION_REQUIRED`** · sévérité Haute · composant secrets (V2+site3)
- **Impact** : les valeurs (`GARAGEFLOW_API_KEY`/`NEXTAUTH_SECRET` réutilisés, jetons de licence, `.env.local` vitrine) restent lisibles dans l'historique git tant qu'elles ne sont pas rotées ET/OU l'historique purgé.
- **Preuve** : gitleaks 8.24.3 `git log` → 4 occurrences V2 (`keys/server_config.json`, `keys/licenses_db.json`), 5 site3 (`.env.local`) ; toutes recensées dans `scripts/compromised-secrets.json`. Aucun secret **nouveau** (fichiers suivis à HEAD : 0 fuite).
- **Action** : rotation (voir AUD-006) ; purge d'historique optionnelle (`docs/runbooks/GIT_HISTORY_SECRET_PURGE.md`). **Ne jamais afficher les valeurs** (formes masquées uniquement).
- **Propriétaire** : opérateur/propriétaire du dépôt · **Acq : non** (documenté) · **Prod : oui** (jusqu'à rotation prouvée).

### AUD-006 — Rotation réelle des secrets de production non exécutée
- **Statut : `EXTERNAL_ACTION_REQUIRED`** · sévérité Haute · secrets (V2+site3)
- **Impact** : la documentation N'EST PAS une preuve de rotation. Tant que le secret de production reste la valeur exposée, il est compromis.
- **Preuve** : mécanisme de preuve livré — `npm run verify:rotation` (`scripts/verify-rotation.mjs`) compare l'empreinte SHA-256 du secret ACTUEL au manifeste des compromis ; **exit 0 = preuve cryptographique de rotation**. La rotation infra (Vercel/Neon/Upstash) n'est pas exécutable dans l'environnement d'audit.
- **Action** : roter chaque secret hors dépôt ; exécuter `verify:rotation` ; archiver la sortie « OK » comme preuve. Aucune affirmation « rotation completed » sans cette preuve.
- **Propriétaire** : opérateur · **Acq : non** · **Prod : oui**.

## Cluster licences

### AUD-007 — Mécanisme de licence HMAC (GF-XXXX) déprécié, forgeable
- **Statut : `BUSINESS_DECISION_REQUIRED`** · sévérité Haute · licence (V2+site3)
- **Impact** : les anciennes licences HMAC `GF-XXXX` sont forgeables si le secret HMAC fuit ; la décision de migration vers ECDSA (`GF2.` déjà en place, signé asymétrique) est en suspens. Le format **actuel** (`GF2.`) est signé ECDSA (clé privée jamais dans le dépôt).
- **Preuve** : format vivant `GF2.` = ECDSA P-256 (`garagesite3 src/lib/licenses/verify.ts:74` — `crypto.createVerify('SHA256')` + clé publique) ; l'ancien HMAC est un chemin de compatibilité (`POST_ROTATION_RECOVERY.md:18`).
- **Action** : décider (a) déprécier/supprimer le chemin HMAC si aucune licence HMAC active ne subsiste, OU (b) le conserver pour compatibilité et documenter sa portée + tests. **Ne pas supprimer** une compatibilité client sans inventaire des licences émises.
- **Propriétaire** : propriétaire produit (décision) + dev (exécution) · **Acq : non** · **Prod : non** (le format sûr est déjà par défaut).

### AUD-012 — Le vérificateur vitrine « rejette » le type `mechanic`
- **Statut : `RISK_ACCEPTED` (comportement intentionnel)** · sévérité Haute→**requalifiée Basse** · licence (site3)
- **Impact** : NUL. Les licences mécanicien ne sont PAS des licences garage et ne transitent jamais par le vérificateur public de la vitrine.
- **Preuve (par le code)** : le vérificateur public `garagesite3 src/lib/licenses/verify.ts:68` limite `_VALID_TYPES` à `trial/premium/enterprise/admin` — **par conception**. Les licences mécanicien sont vérifiées par un **chemin dédié** dans l'app : `GarageFlowsV2 src/lib/license/mechanic-session.ts:81-119` (cookie `gf_session` `typ='mechanic'` + enregistrement base `licenseType='mechanic'` + intégrité `recordMac`). Deux systèmes distincts, volontairement séparés.
- **Action** : aucune (documenté comme intentionnel). Amélioration possible : commentaire explicite dans `verify.ts` reliant au chemin mécanicien.
- **Propriétaire** : — · **Acq : non** · **Prod : non**.

## Cluster control-plane (site3)

### AUD-010 — Clé admin unique statique (sans identité ni expiration)
- **Statut : `CODE_OPEN`** · sévérité Haute · authz (site3)
- **Impact** : l'accès admin du control-plane repose sur une clé partagée statique (pas d'identité par opérateur, pas d'expiration, stockée en `sessionStorage`). Compromission = accès admin complet, sans révocation granulaire.
- **Preuve** : `garagesite3 src/app/admin/_lib/client.ts:13`, `src/lib/licenses/auth.ts:29` ; garde `requireAdminKey` fail-closed **testée** (`admin-auth.test.ts`, 9 tests — 401/500 fail-closed, x-gf-key + Bearer). Le fail-closed est prouvé ; la faiblesse est le **modèle** (clé unique).
- **Action** : refonte vers identités par opérateur + jetons courts/scopés + rotation (RBAC service-to-service). Refonte transverse, hors correctif isolé — à cadrer.
- **Propriétaire** : dev (site3) · **Acq : non** · **Prod : conditionnel** (acceptable en interne restreint ; à durcir avant exposition large).

### AUD-011 — Notifications lisibles/acquittables par `licenseId` seul
- **Statut : `BUSINESS_DECISION_REQUIRED`** · sévérité Haute→**requalifiée Moyenne** · authz (site3)
- **Impact** : **borné**. Connaître un `licenseId` permet de lire/acquitter les **diffusions** (notifications de maj/marketing) ciblant ce client. **Aucune donnée métier** n'est exposée (le handler le garantit : « Ne renvoie jamais de donnée métier »).
- **Preuve** : `garagesite3 src/app/api/notifications/route.ts:15-40` (GET par `licenseId`, rate-limité, sortie = notifications de diffusion) ; `.../ack/route.ts`. Le client Electron déployé n'envoie que `licenseId` (`GarageFlowsV2 electron/main.js:734`).
- **Action** : ajouter une **preuve d'appareil** (device token) en **déploiement coordonné 2 phases** (serveur tolérant → clients mis à jour → enforcement) pour ne pas casser la flotte installée. Test négatif à ajouter (cross-license = aucune donnée métier).
- **Propriétaire** : produit (décision 2 phases) + dev · **Acq : non** · **Prod : non** (impact borné, non bloquant).

## Cluster supply-chain

### AUD-008 — Installeur Windows non signé (Authenticode absent)
- **Statut : `EXTERNAL_ACTION_REQUIRED`** · sévérité Haute · supply-chain (V2)
- **Impact** : SmartScreen alerte ; un installeur substitué serait indiscernable côté OS (le binaire est durci en interne — Fuses + manifeste HMAC — mais rien n'authentifie l'origine du `.exe`).
- **Preuve** : `package.json` build.win sans `signtoolOptions`/certificat ; `SECURITY-HARDENING.md:233`. La chaîne de MàJ est fail-closed testée (`update-verify`) — c'est la SIGNATURE de l'installeur qui manque.
- **Action** : certificat Authenticode (opérateur) + signature + timestamp — pipeline documenté (`docs/data-room/06-intellectual-property` / `EXTERNAL_VALIDATIONS`). *Code signing infrastructure prepared. Production Authenticode signing requires the production certificate.*
- **Propriétaire** : opérateur Windows · **Acq : non** · **Prod : oui** (distribution grand public).

## Items CODE (poursuivables sans externe)

| ID | Titre | Sév. | Statut | Preuve | Acq | Prod |
|---|---|---|---|---|---|---|
| AUD-024 | CSP à nonce (lever `'unsafe-inline'` scripts) | Moyenne | `CODE_OPEN` (partiel : `unsafe-eval` déjà retiré en prod, `759532a`) | `security-headers.test.ts` | non | non |
| AUD-022 | Handlers portail restants (login/2FA/tickets/RDV) | Moyenne | `CODE_OPEN` (partiel : handler capability-token testé) | `portal-token-isolation.test.ts` | non | non |
| AUD-023 | Parcours Playwright AUTHENTIFIÉ en CI | Haute | `CODE_OPEN` (partiel : E2E métier via handlers fait) | `business-workflow-e2e.test.ts` | non | non |
| AUD-026 | i18n des 27 composants restants + WCAG AA outillé | Moyenne | `CODE_OPEN` (partiel) | RTL + a11y StockPanel faits | non | non |
| — | e-invoicing PDF/A-3 + Schematron | Moyenne | `CODE_OPEN` (+ `EXTERNAL_VALIDATION` pour la certif) | XSD MINIMUM validé | non | non |
| — | Anonymisation client automatisée (RGPD) | Moyenne | `CODE_OPEN` | `RGPD_TECHNICAL_MEASURES.md` | non | non |
| — | Rétentions paramétrables AuditLog/NotificationLog | Basse | `CODE_OPEN` | `DATA_INVENTORY.md` | non | non |

## Synthèse

- **Risques critiques code ouverts** : **0**.
- **CODE_OPEN** (améliorations planifiables) : 7 (dont 3 partiellement traités).
- **EXTERNAL_ACTION_REQUIRED** : AUD-005, AUD-006, AUD-008.
- **BUSINESS_DECISION_REQUIRED** : AUD-007, AUD-011.
- **CODE_OPEN (modèle à durcir)** : AUD-010.
- **RISK_ACCEPTED** : AUD-012 (intentionnel).
