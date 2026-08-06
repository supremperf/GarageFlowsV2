# Changelog

## [Non publié] — 2026-08-06 — Monnaie déterministe · docs · marque

### Monnaie (fin du Float dangereux pour l'argent)
- **Stockage des totaux en centimes entiers** (additif, non destructif) : colonnes
  `WorkOrder.totalHtCents/totalTtcCents`, `PurchaseOrder.totalHtCents`,
  `LoanerReservation.depositAmountCents` — source de vérité en écriture, colonnes
  Float conservées en **miroir dérivé** (aucune régression lecture/PDF/export/signature).
- **Ordres de réparation** : calcul des totaux rerouté sur `lib/money.ts` (centimes
  exacts) — fin de l'arithmétique flottante native dans ce chemin.
- `lib/money.ts` : ajout `marginCents` / `computeMarginCents` (marge = produit − coût, exacte).
- Migration additive PostgreSQL `20260806100000_money_cents` (+ backfill/vérif/rollback
  documentés) ; runner SQLite `158–161` ; convergence reset synchronisée.
  Voir `docs/MIGRATION-MONEY.md`.

### Documentation
- **`docs/PRODUCTION-READINESS.md`** : source de vérité UNIQUE de l'état de production
  (verdict honnête « préparé, non déployé, sous conditions » + checklist de bloqueurs).
- 12 rapports-instantanés marqués **HISTORIQUE** ; `PRODUCTION_DEPLOYMENT.md` corrigé.
- Garde-fou CI `scripts/check-docs-consistency.mjs`.

### Marque
- Harmonisation **« GarageFlows »** partout dans le visible (i18n, pages, dialogues
  Electron, e-mails, manifestes) ; identifiants techniques/artefacts/sels crypto conservés.
- `public/site.webmanifest` réparé (nom pluriel + icônes réelles). `config/app.ts` réaligné 1.1.0.
- Garde-fou CI `scripts/check-branding.mjs`.

## [1.1.0] — 2026-07-30 — Finalisation sécurité production

### Sécurité (correctifs réellement implémentés + testés)
- **Electron / secret** : suppression des 3 replis codés en dur
  (`gf-electron-local-secret-2026-xK9mP3qR`) ; secret UNIQUE PAR INSTALLATION
  (256 bits) généré et stocké dans `userData` (écriture atomique, permissions
  0600), fail-closed si indisponible (`electron/secret.js`).
- **Electron / réseau** : serveur interne lié à `127.0.0.1` (au lieu de
  `0.0.0.0`) ; cookie `gf_session` HttpOnly + SameSite=Strict.
- **Licence / HWID** : contournement corrigé (une licence liée exige un HWID
  valide et identique — absent/vide/mal formé/différent = refus) ; fin de la
  « tolérance » 75 % (comparaison stricte, normalisée, à temps constant).
- **Stock** : opérations `jobs/[id]/parts` transactionnelles ; décrément
  conditionnel atomique (jamais négatif, anti-course) ; supplément déduit à
  l'augmentation d'une ligne ; validation des quantités.
- **Numérotation** : réservation du numéro + création du document dans une
  seule transaction (pas de trou de séquence) ; `@@unique([garageId, number])`
  sur factures/devis/OR/BC (migrations 076-079).
- **Monétaire** : PDF/UI (InvoiceModal, QuoteInvoiceModal) calculés via la
  couche centimes exacte (`lib/money`) — cohérence PDF ↔ API ↔ base ; total HT
  des bons de commande en centimes exacts.
- **PWA** : refus de démarrage si production PWA + SQLite/stockage local ;
  Service Worker respectant `Cache-Control: no-store` et purge des pages
  privées à la déconnexion.
- **API** : clé admin `revoke-by-key` comparée à temps constant ; arrêt des
  fuites de logs/erreurs ; redaction centralisée des logs serveur (`lib/redact`).
- **Dépendances** : Next.js 14.2.5 → 14.2.35 (contournement middleware
  critique CVE-2025-29927), next-auth 4.24.7 → 4.24.15 (bypass e-mail critique).
- **Versionnage** : 1.0.0 → 1.1.0 (SemVer) + contrôle de cohérence en CI.
- **CI** : ajout de `prisma validate`, `npm run build` et du contrôle de version.

### Tests
- 204 tests (137 → 204) : secret Electron, loopback, HWID (table de vérité),
  stock transactionnel/concurrence, numérotation, cohérence monétaire,
  isolation tenant, garde-fous PWA, redaction.

## [Sécurisation production] — 2026-07-30 (branche claude/garageflow-security-production-4caktd)

### Sécurité
- **Secrets** : suppression de tous les replis codés en dur (`auth-secret.ts`
  centralisé, fail-closed) ; `.env.example` en placeholders ; `keys/*.json`
  retirés du suivi git ; génération aléatoire par installation ; validation
  d'environnement fail-fast ; Gitleaks en CI ; retrait des logs de secrets
  (DATABASE_URL, mot de passe/hash).
- **Multi-tenant / IDOR** : filtrage `garageId` systématique, écritures atomiques
  `{id, garageId}`, vérification des FK (`lib/tenant.ts`), correction IDOR-WRITE
  (inspections), routes non authentifiées (photos, plate-lookup), dump inter-tenant
  (internal/export). Test d'isolation 2 garages.
- **Device auth** : stockage/présentation du jeton d'appareil ; ré-activation auto.
- **Mises à jour signées Ed25519** : `electron/update-verify.js` (signature, keyId,
  plateforme, anti-downgrade, domaine) ; valeurs signées font autorité.
- **Crash reporting** : opt-in par défaut + écran de consentement + redaction RGPD.
- **Electron durci** : sandbox, webSecurity, navigation en liste blanche, CSP renforcée.

### Correctness
- **Monnaie** : calculs en centimes entiers (`lib/money.ts`), invariant TTC=HT+TVA.
- **SemVer** : comparaison correcte (fin du `>` lexicographique) côté client.

### PWA (app.garageflows.fr)
- Manifeste complet, Service Worker (jamais de cache API authentifié), page
  hors-ligne, icônes, enregistrement web-only.

### Validation
137 tests verts, `tsc`/`next lint`/`next build` OK, `prisma validate` OK,
`python -m compileall scripts` OK.
