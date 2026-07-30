# Changelog

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
