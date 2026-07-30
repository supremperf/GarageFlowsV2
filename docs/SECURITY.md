# Sécurité — GarageFlow (client desktop Electron + app web/PWA)

Mesures en place (détails dans les docs dédiées du dossier `docs/`).

## Secrets
- Aucun secret réel dans le dépôt ; `.env.example` en placeholders vides ;
  `keys/*.json` retirés du suivi git. Rotation : `SECRETS_ROTATION.md`.
- **Aucun repli de secret codé en dur** : `src/lib/auth-secret.ts` lève si le
  secret est absent/faible (fail-closed). `setup-dev.js` génère un
  `NEXTAUTH_SECRET` aléatoire par installation (`scripts/secrets.js`).
- **Electron — secret unique par installation** (`electron/secret.js`) : 256 bits
  (`crypto.randomBytes(32)`) stockés dans `app.getPath('userData')/gf_secret.key`
  (écriture atomique, permissions 0600), réutilisés au redémarrage, régénérés
  seulement si absents/corrompus, jamais journalisés ni exposés au renderer.
  Fail-closed : la partie authentifiée refuse de démarrer sans secret sûr.
- Validation d'environnement fail-fast en production (`src/lib/env.ts`), incluant
  le refus de SQLite/stockage local en **production PWA** (PostgreSQL exigé).
- Analyse de secrets Gitleaks en CI + contrôle de cohérence de version SemVer.

## Multi-tenant (IDOR)
- Toute route filtrée par le `garageId` de session (jamais depuis le client).
- Écritures atomiques `{id, garageId}` (anti-TOCTOU) ; FK vérifiées avant
  association (`src/lib/tenant.ts`). Test d'isolation 2 garages.
- Routes non authentifiées corrigées (`photos`, `plate-lookup`) ; dump
  inter-tenant neutralisé (`internal/export` : clé forte + loopback-only).

## Licences & appareils
- Le client obtient un **jeton d'appareil** signé à l'activation et le présente
  (avec le HWID) à chaque heartbeat. Stockage chiffré (AES-256-GCM lié au HWID).
- **Liaison HWID stricte** : dès qu'une licence est liée à un matériel, l'activation
  exige un HWID valide et IDENTIQUE (absent/vide/mal formé/différent = refus, 403).
  Comparaison normalisée à temps constant, **sans tolérance partielle** (un digest
  SHA-256 change entièrement au moindre changement matériel).

## Serveur local Electron
- Le serveur Next.js interne écoute **exclusivement sur `127.0.0.1`** (jamais
  `0.0.0.0`/LAN). Cookie de session `gf_session` **HttpOnly + SameSite=Strict**.

## Stock & documents
- Opérations de stock **transactionnelles** avec décrément conditionnel atomique
  (jamais négatif, anti-course). Numérotation des documents (facture/devis/OR/BC)
  **atomique** (numéro réservé + document créés dans la même transaction) et
  **unique** par garage (`@@unique([garageId, number])`).

## PWA
- Production PWA : PostgreSQL obligatoire, refus de démarrer sur SQLite/disque
  local. Service Worker : jamais de cache `/api/*`, respect de
  `Cache-Control: no-store`, purge des pages privées à la déconnexion.

## Mises à jour
- Vérification **Ed25519** du manifeste avant installation (`electron/update-verify.js`) :
  signature, keyId, produit/plateforme/arch/canal, anti-downgrade, domaine autorisé,
  puis SHA-256 + taille **signés**. Flux non signé bloqué. Voir `UPDATE-SIGNING.md`.

## Durcissement Electron
- `sandbox:true`, `contextIsolation:true`, `nodeIntegration:false`, `webSecurity:true`.
- Navigation hors app locale bloquée ; `window.open` en liste blanche HTTPS ;
  webview refusée ; preload minimal ; CSP stricte (`object-src 'none'`…).

## Confidentialité (crash)
- Opt-in (désactivé par défaut) + écran de consentement + redaction centralisée
  (jamais de secret/chemin utilisateur/HWID brut). Voir `PRIVACY-CRASH-REPORTING.md`.

## Monnaie
- Calculs en centimes entiers (`src/lib/money.ts`), invariant TTC=HT+TVA.

## Journalisation
- Aucun secret/DATABASE_URL/mot de passe journalisé ; réponses HTTP génériques.
- **Redaction centralisée** côté serveur (`src/lib/redact.ts`) appliquée à chaque
  appel du logger : secrets, tokens, cookies, Authorization, URLs de base avec
  identifiants, tokens GF2/JWT masqués ; HWID/SHA-256 tronqués (empreinte courte).

## Limitations connues (résiduelles)
- Rate limiting en mémoire (par instance) — pour une PWA multi-instance, prévoir
  un store partagé (Redis/KV). Détails et classement : voir le rapport de sécurité.
- Montants stockés en `Float` (schéma) : calculs métier exacts en centimes, mais
  migration `Float → Decimal/entier` recommandée (`docs/MIGRATION-MONEY.md`).
- `npm audit` : résiduels de haut niveau limités à la chaîne de build
  (electron-builder) et au postcss embarqué de Next — hors chemin d'exécution PWA.
