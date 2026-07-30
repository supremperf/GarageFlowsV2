# Sécurité — GarageFlow (client desktop Electron + app web/PWA)

Mesures en place (détails dans les docs dédiées du dossier `docs/`).

## Secrets
- Aucun secret réel dans le dépôt ; `.env.example` en placeholders vides ;
  `keys/*.json` retirés du suivi git. Rotation : `SECRETS_ROTATION.md`.
- **Aucun repli de secret codé en dur** : `src/lib/auth-secret.ts` lève si le
  secret est absent/faible (fail-closed). `setup-dev.js` génère un
  `NEXTAUTH_SECRET` aléatoire par installation (`scripts/secrets.js`).
- Validation d'environnement fail-fast en production (`src/lib/env.ts`).
- Analyse de secrets Gitleaks en CI.

## Multi-tenant (IDOR)
- Toute route filtrée par le `garageId` de session (jamais depuis le client).
- Écritures atomiques `{id, garageId}` (anti-TOCTOU) ; FK vérifiées avant
  association (`src/lib/tenant.ts`). Test d'isolation 2 garages.
- Routes non authentifiées corrigées (`photos`, `plate-lookup`) ; dump
  inter-tenant neutralisé (`internal/export` : clé forte + loopback-only).

## Licences & appareils
- Le client obtient un **jeton d'appareil** signé à l'activation et le présente
  (avec le HWID) à chaque heartbeat. Stockage chiffré (AES-256-GCM lié au HWID).

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
