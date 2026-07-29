# GarageFlow — Audit Enterprise 360° & Validation de Production

_Date : 2026-07-29 · Périmètre : `GarageFlowsV2` (app desktop Electron + Next.js) et `garagesite3` (control-plane SaaS / site + API)._

Cet audit a été mené sur l'intégralité des deux dépôts (architecture, ~70 routes API,
schéma Prisma, sécurité Electron/crypto, logique métier/comptable, IA, control-plane).
La méthodologie : 9 auditeurs spécialisés par sous-système, chaque constat étant
**revérifié de façon adversariale** contre le code réel (file:line + scénario d'exploitation).

**Résultat : 78 constats confirmés — 4 critiques, 14 élevés, 29 moyens, 31 faibles.**
Ce même commit corrige les 4 critiques et la majorité des élevés/moyens (voir statut
par constat). Les points restants sont documentés avec un correctif précis.

> ⚠️ **GarageFlow n'est PAS encore « Production Ready ».** Deux conditions bloquantes
> subsistent, indépendantes du code livré : **(1) la rotation des secrets exposés**
> (ils restent dans l'historique git — voir §0) et **(2) l'application de la migration
> de schéma** (index + contraintes d'unicité). Voir la checklist §8.

---

## 0. ACTIONS BLOQUANTES IMMÉDIATES (secrets compromis)

Des secrets **réels de production** étaient committés dans les dépôts. Les retirer du
suivi (fait dans ce commit) **ne suffit pas** : ils restent dans l'historique git et
doivent être considérés comme **publics**. Ils DOIVENT être régénérés :

| Secret | Où il était | Impact si non tourné | Action |
|---|---|---|---|
| `DATABASE_URL` (mot de passe Neon) | `garagesite3/.env.example` + `.env.local` | Accès lecture/écriture direct à la base licences | Réinitialiser le mot de passe Neon |
| `LICENSE_ADMIN_API_KEY` | idem | Contrôle **total** du control-plane : révoquer toutes les licences, **publier une mise à jour → RCE sur tous les postes**, lire les crashs | `openssl rand -hex 32`, redéployer |
| `NEXTAUTH_SECRET` (control-plane) | idem | Forger des cookies `gf_session` | `openssl rand -base64 32` |
| `NEXTAUTH_SECRET` / `GARAGEFLOW_API_KEY` (app) | `GarageFlowsV2/.env.example`, `keys/server_config.json` | Forger n'importe quelle session/garageId/rôle ; auth du serveur de licences | Régénérer, valeurs **distinctes** |
| Base licences | `GarageFlowsV2/keys/licenses_db.json` | Fuite de tokens de licence émis | Considérer les tokens exposés comme révocables |

> Purger l'historique (BFG / `git filter-repo`) après rotation, ou considérer
> définitivement ces valeurs comme brûlées.

---

## 1. Notes globales par catégorie (/10)

Colonne « Avant » = état audité ; « Après » = après les correctifs de ce commit
(sous réserve des actions §0 et de la migration §8).

| Catégorie | Avant | Après | Commentaire |
|---|:---:|:---:|---|
| Architecture | 7.5 | 7.5 | Séparation app/control-plane nette, modules/entitlements, helpers `lib/*`. Dette : argent en `Float`, duplication `computeTotals`. |
| **Sécurité** | **3.0** | **6.5*** | 4 critiques corrigés (secret par-installation, fail-closed, RCE MAJ, IDOR). *\*plafonné tant que §0 non fait.* Restent : SSE key-in-URL, HWID flou, dev-bypass. |
| Performances | 7.0 | 8.0 | Index manquants ajoutés ; quelques listes non paginées restantes. |
| UX / UI | 7.5 | 7.5 | Riche, i18n 14 langues, responsive. Non ré-audité en profondeur ici. |
| Maintenabilité | 7.0 | 7.5 | TS strict, Zod, tests. Reste : code mort (keygen legacy), duplication. |
| Scalabilité | 6.0 | 6.5 | Desktop = mono-tenant/instance ; control-plane : rate-limit mémoire → Redis requis. |
| Qualité du code | 7.5 | 8.0 | Standards élevés, conventions cohérentes. |
| Documentation | 6.0 | 7.5 | `.env.example` complet, ce rapport, guides existants. |
| Robustesse | 7.0 | 7.5 | Erreurs génériques côté client, backups 3 niveaux, crash reporting. |
| Tests | 6.0 | 6.5 | Unitaires (79 app / 48 CP) ; **manquent** intégration/E2E/charge. |
| IA | 6.5 | 7.5 | Timeouts/retry, rate-limit par garage, sortie whitelistée, dégradation. |
| Configuration | 3.5 | 7.0* | Secrets retirés, `.env.example` documenté. *\*gated §0.* |
| **Production Readiness** | **2.5** | **Conditionnelle** | Voir §8. Bloquants : rotation secrets + migration. |

---

## 2. Constats CRITIQUES (4) — tous corrigés

### C1 — `NEXTAUTH_SECRET` codé en dur → forge de session/admin (auth-bypass) ✅ CORRIGÉ
- **Fichiers** : `electron/main.js` (:49,:554,:1267), `src/middleware.ts`, `src/lib/api-helpers.ts`.
- **Impact** : la constante `gf-electron-local-secret-2026-…` signait les sessions NextAuth
  **et** le cookie admin `gf_session`. Quiconque la lit forge un token avec un `garageId`/`role`
  arbitraire ou un `typ:'admin'`, court-circuitant toute l'isolation par `garageId`.
- **Correctif** : secret aléatoire **unique par installation** généré et persisté dans
  userData au 1er lancement (`ensureSessionSecret`) ; résolveur centralisé
  `src/lib/session-secret.ts` qui **échoue fermé** (refuse les constantes connues et l'absence
  de secret). Constantes retirées de `main.js`, `middleware`, `api-helpers`, `license/activate`.

### C2 — RCE via `app:install-update` (hash fourni par le renderer) ✅ CORRIGÉ
- **Fichier** : `electron/main.js` (`app:install-update`).
- **Impact** : le handler exécutait le binaire téléchargé si son SHA-256 correspondait à un
  hash **fourni par le renderer**. Un renderer compromis (XSS via données client/portail,
  navigation hostile) pouvait pointer vers un installeur piégé + son hash → exécution native.
- **Correctif** : le **processus principal** re-récupère le manifeste de mise à jour
  **autoritatif** (url + sha256 + size) depuis le serveur de licences via TLS et l'utilise ;
  l'entrée renderer n'est plus de confiance. HTTPS imposé (loopback excepté). Sans manifeste
  serveur signé, aucune exécution (repli navigateur).

### C3 — Secrets de production committés dans `garagesite3` ✅ RETIRÉ (rotation requise §0)
- **Fichiers** : `garagesite3/.env.example`, `.env.local` (suivis git).
- **Impact** : mot de passe Neon, `LICENSE_ADMIN_API_KEY` (clé maître du control-plane →
  publication de MAJ = RCE clients), `NEXTAUTH_SECRET`.
- **Correctif** : `.env.local` dé-suivi ; `.env.example` remis en placeholders documentés.
  **Rotation obligatoire** (§0) — l'historique contient encore les valeurs.

### C4 — Secrets committés dans `GarageFlowsV2/keys/*` ✅ RETIRÉ (rotation requise §0)
- **Fichiers** : `keys/server_config.json` (clé API réelle), `keys/licenses_db.json` (base licences).
- **Correctif** : `git rm --cached` + `.gitignore` durci (`keys/*.json`). `.env.example` ne
  contient plus de vraie valeur et `main.js` ne recopie plus le template dans un `.env` vivant.

---

## 3. Constats ÉLEVÉS (14)

| # | Constat | Fichier | Statut |
|---|---|---|:--:|
| H1 | `.env.example` livrait un vrai `NEXTAUTH_SECRET` auto-copié dans `.env` | `.env.example`, `main.js` | ✅ Corrigé |
| H2 | `revoke-by-key` : clé committée + comparaison non constant-time | `admin/licenses/revoke-by-key` | ✅ Corrigé (timingSafeEqual) |
| H3 | Jetons portail/signature signés avec le secret par défaut, sans scoping garageId | `portal-secret.ts`, `portal/*`, `quote/*` | ⚠️ Partiel : secret fail-closed corrigé ; **liaison garageId du jeton à faire** |
| H4 | IDOR : maj d'item d'inspection via `body.itemId` non scopé | `inspections/[id]` | ✅ Corrigé |
| H5 | Mot de passe + hash bcrypt journalisés à chaque login | `lib/auth.ts` | ✅ Corrigé |
| H6 | Session `gf_session` forgeable + serveur lié à `0.0.0.0` | `main.js`, `middleware.ts` | ✅ Secret corrigé · ⚠️ `0.0.0.0` conservé (portail LAN) — voir note |
| H7 | Conversion devis→facture non transactionnelle (double facture) | `quotes/[id]/convert` | ✅ Corrigé (transaction + claim atomique + `@@unique(quoteId)`) |
| H8 | Marge finance toujours ~100 % (coût pièces jamais compté) | `finance/route.ts` | ✅ Corrigé |
| H9 | Stock non décrémenté si pièce déjà présente → inventaire fantôme | `jobs/[id]/parts` | ✅ Corrigé |
| H10 | `quantity` négative acceptée → inversion du stock ; writes non atomiques | `jobs/[id]/parts` | ✅ Corrigé |
| H11 | Montants en `Float` sur tous les modèles financiers | `schema.prisma`, `billing.ts` | ⚠️ Atténué (`roundCents` sûr) · migration Int/Decimal = roadmap |
| H12 | Pas de garde `will-navigate` → origine hostile garde le pont IPC | `main.js` | ✅ Corrigé |
| H13 | Secret admin maître transmis dans l'URL du flux SSE (logs) | `garagesite3 admin/stream` | ⚠️ Documenté (ticket HMAC court — non implémenté, voir §5) |
| H14 | `withAuth`/stats/email renvoyaient le message d'erreur interne brut | `api-helpers.ts` +3 | ✅ Corrigé |

**Note H6** : le serveur Next reste lié à `0.0.0.0` pour préserver le partage du portail
client sur le réseau local (QR / IP locale). Le risque critique venait du secret forgeable
(corrigé) ; l'exposition LAN restante est adossée à l'authentification. Recommandation :
rendre le binding configurable et le passer à `127.0.0.1` si le partage LAN n'est pas utilisé.

---

## 4. Constats MOYENS (29) — statut condensé

**Corrigés dans ce commit :**
- Photos `[...path]` : `..` rejeté + garde `path.sep` (traversal). ✅
- `invoices/[id]` : édition/suppression d'une facture émise bloquée ; remplacement de lignes en transaction. ✅
- `jobsOverlap` ignorait `delayMinutes`. ✅
- CT-alerts : off-by-one (`startOfDay`). ✅
- `roundCents` : arrondi demi-centime sûr (float). ✅
- Suppression de `Part` référencée → l'erreur Prisma brute n'est plus renvoyée (message générique). ✅
- `plate-ocr`/`plate-lookup` : appel IA sans try/catch → 500 + fuite ; ajout timeout/retry + dégradation. ✅
- `plate-lookup` : sans `requireSession` ni cap de coût par garage. ✅
- Numéro de facture : année dérivée de `issueDate` (convert). ✅ (route invoices : voir remaining)
- Clé de rate-limit basée sur `x-forwarded-for` falsifiable — **atténué** (générique documenté ; contexte desktop mono-poste).

**Restants (documentés, à traiter) :**
- **`purchase-orders/[id]/receive`** : garde « déjà reçu » hors transaction → double incrément de stock (TOCTOU). *Fix : `updateMany({where:{status:{not:'received'}}})` dans la transaction.*
- **Numérotation factures/devis** (`invoices/route.ts`) : compteur consommé avant `create` (trous de séquence) ; année basée sur l'horloge serveur. *Fix : allouer le compteur dans la même transaction ; dériver l'année d'`issueDate`.*
- **Login sans rate-limit** : `withLoginRateLimit` est du code mort (jamais branché). *Fix : limiter `authorize()` par email.*
- **HWID 75 %** : tolérance de correspondance sur un hash SHA-256 (sans effet) + HWID vide accepté. *Fix : comparer les composants bruts, pas le hash.*
- **Ingestion crash publique** (`garagesite3 /api/crash`) : limiteur par-instance, une ligne par événement. *Fix : store partagé (Redis) + agrégation par empreinte + caps par licence.*
- **`admin/stream`** (H13) : clé maître en query-string. *Fix : ticket SSE HMAC court signé après auth par en-tête.*
- Money côté control-plane (`store.ts`) : totaux en flottant, `amount_ttc` client non validé.

---

## 5. Constats FAIBLES (31) — thèmes

Regroupés (détails file:line dans l'annexe machine, cf. journal d'audit) :
- **Pagination manquante** : `work-orders`, `reminders`, `parts`, `purchase-orders`, `warranties`, `labor-operations` GET renvoient des lignes non bornées. *Fix : réutiliser le motif page/limit déjà présent sur clients/jobs/vehicles/invoices.*
- **Index manquants** : Reminder, Part, JobPart, Inspection, InspectionItem, RepairTypePart → **✅ ajoutés au schéma** (migration §8).
- **Code mort / backdoors latents** : `scripts/generate-license-key.js` (MASTER_SECRET committé, format GF-XXXX mort) ; token `GF2.DEV.DEV.DEV` (bypass admin dev). *Fix : supprimer.*
- **Transport** : MAJ/telemetry acceptent du HTTP en repli. *Fix : imposer HTTPS (partiellement fait sur install-update).*
- **Injection HTML e-mail** (`reminders/send`) → **✅ échappement ajouté**.
- **Divers info-disclosure** (stats/email) → **✅ génériques**.
- **Control-plane** : `openapi.json` ne décrit pas l'enveloppe `{data}`/pagination ; endpoints `license/check|status` et `notifications/ack` acceptent un `licenseId` sans preuve de possession (IDOR borné par UUID) ; binaires de MAJ publiés sans vérification serveur du hash/signature.

---

## 6. Vérification fonctionnelle & couverture de tests

- **Tests unitaires** : app 79 ✅ (dont nouvelles régressions `roundCents`, `jobsOverlap` avec délai) ; control-plane 48 ✅.
- **Typecheck** : `tsc --noEmit` propre sur le code modifié (1 erreur pré-existante non liée : import `./brand/logo-mark.png`).
- **Schéma Prisma** : `prisma validate` OK, client généré.
- **Manquent (roadmap)** : tests d'intégration API (routes réelles + DB), E2E (Playwright, déjà disponible dans l'env), tests de charge, tests de sécurité automatisés (rejeu de jetons, IDOR).

---

## 7. Variables d'environnement

`.env.example` (app + control-plane) a été **entièrement réécrit** : chaque variable est
documentée (rôle, génération, obligatoire/optionnel, où la configurer). Variables injectées
par Electron (`GF_DB_MAC_SECRET`, `GF_INTERNAL_EXPORT_KEY`, `GF_PHOTOS_DIR`, …) documentées
pour référence. **Aucune vraie valeur** n'y figure désormais.

---

## 8. Checklist de mise en production

**Bloquants (à faire avant tout déploiement) :**
- [ ] **Rotation des secrets §0** (Neon, `LICENSE_ADMIN_API_KEY`, les deux `NEXTAUTH_SECRET`, `GARAGEFLOW_API_KEY`) + purge historique.
- [ ] **Appliquer la migration de schéma** : `npm run db:push` (ou `prisma migrate deploy`) pour créer les index + `@@unique`. ⚠️ Si des numéros de facture/devis dupliqués existent déjà, les dédupliquer d'abord (le `@@unique([garageId, number])` échouera sinon). Régénérer `prisma/garageflow-template.db` pour les nouveaux installs.
- [ ] Définir `NEXTAUTH_SECRET` (web) ou laisser Electron le générer (desktop) ; vérifier `/api/health`.

**Recommandés (constats restants) :**
- [ ] Traiter H3 (liaison garageId des jetons portail/signature), PO receive TOCTOU, numérotation factures, login rate-limit, ticket SSE (H13).
- [ ] Supprimer le code mort (keygen legacy, dev-bypass token).
- [ ] Pagination des listes restantes ; store partagé (Redis) pour rate-limit/crash du control-plane.
- [ ] Certificats/domaines/DNS, SMTP/SMS/WhatsApp, monitoring/alertes, sauvegardes vérifiées.
- [ ] Signature du code Windows (Authenticode) et signature hors-ligne du manifeste de MAJ (défense en profondeur au-delà du SHA).

---

## 9. Feuille de route des modules « Premium » & AI Copilot

**Constat clé : GarageFlow est déjà une plateforme mature.** Beaucoup des modules demandés
existent sous forme partielle. Voici la cartographie honnête (existant → à construire). Ces
constructions sont des chantiers pluri-semaines et **ne sont pas livrées dans ce commit**
(dédié à l'audit et à la remédiation).

| Module demandé | Existant aujourd'hui | À construire |
|---|---|---|
| Décodage VIN intelligent | `car-database.ts`, `plate-lookup` (IA) | Moteur multi-fournisseurs, cache, offline, historique |
| Catalogue pièces (type TecDoc) | Stock `Part`, `RepairTypePart`, bons de commande | Connecteurs fournisseurs, équivalences/OEM, fiches techniques, couples de serrage |
| Commande fournisseurs auto | `PurchaseOrder` + réception | Comparaison prix, connecteurs API, suivi/retours, reprise |
| Signature électronique | `WorkOrder.signatureData` + `sign` + jetons | Horodatage/IP/empreinte crypto, invalidation sur modification, PDF signé |
| Notifications multi-canal | `Reminder` + SMTP + relances | SMS/WhatsApp/push, modèles/variables, planification, stats |
| IA génération de devis | `estimate` (historique + temps moyens) | Justification pièces/risques, validation guidée |
| IA pièces oubliées | `suggestions`, `client-memory` | Règles constructeur + niveau de confiance + impact € |
| OCR automobile | `plate-ocr` (carte grise/plaque) | Factures/CT/docs constructeur, pré-remplissage validé |
| Dashboard décisionnel | `stats`, `finance`, `FinancialDashboard` | Temps réel, filtres avancés, export PDF/Excel |
| Prévisions IA | — | Modèles prédictifs (CA, trésorerie, stock, charge) |
| Rentabilité | `finance` (marge, désormais correcte) | Marge par mécano/véhicule/client, détection anomalies |
| Rapports personnalisables | Exports CSV/FEC, export desktop | Générateur colonnes/graphes, planification e-mail |
| **AI Copilot** (conversationnel, diagnostic, CRM, planning, stock prédictif, mémoire, gamification, proactif) | Briques : `ai-engine.ts`, `client-memory.ts`, entitlements, RAG-able data | Orchestration LLM multi-fournisseur, mémoire conversationnelle, exécution d'actions validées, journalisation/traçabilité, RGPD |

**Recommandation de séquencement** : (1) finaliser la remédiation sécurité (H3, PO, numérotation,
migration Decimal) ; (2) socle « données pour l'IA » (RAG sur données garage + garde-fous
permissions) ; (3) modules à plus forte valeur immédiate déjà amorcés (VIN multi-fournisseur,
notifications multi-canal, dashboard temps réel) ; (4) Copilot par capacités, chaque action
sensible passant par une validation utilisateur et une journalisation.

---

## 10. Verdict

GarageFlow est un logiciel **de qualité entreprise dans sa conception** (Electron durci,
licences ECDSA, backups multi-niveaux, i18n, control-plane séparé, tests). L'audit a néanmoins
révélé des failles **critiques de gestion des secrets et d'intégrité des mises à jour**,
ainsi que des bugs comptables réels (marge, double-facture, stock). **Ce commit corrige les
4 critiques et la majorité des élevés/moyens**, avec tests et typecheck au vert.

**Production Ready : NON, conditionnelle.** À débloquer par la **rotation des secrets (§0)**
et l'**application de la migration (§8)**, puis le traitement des points restants listés en §4.
