# Runbook — Incident Response (GarageFlows)

Cadre commun : **détecter → contenir → éradiquer → récupérer → prouver →
post-mortem**. Journaux applicatifs déjà **redactés** (aucun secret/token en
clair — `src/lib/logger.ts` + `redact.ts`) : ils sont exploitables comme preuve
sans sur-exposition.

## Scénarios

### 1. Fuite de secret
- Détection : gitleaks CI, alerte fournisseur, comportement anormal.
- Containment : rotation IMMÉDIATE du secret concerné (voir
  `docs/security/SECRET_ROTATION_REGISTER.md`), invalidation des sessions si
  secret de session.
- Preuve : `npm run verify:rotation` → OK archivé ; scan gitleaks.
- Post-mortem : origine, fenêtre d'exposition, données atteignables.

### 2. Compte admin compromis
- Containment : rotation `NEXTAUTH_SECRET` (invalide TOUTES les sessions),
  réinitialisation du mot de passe, revue `AuditLog` (acteur/cible/horodatage).
- Vérifier : créations de comptes, exports, modifications de licences.

### 3. Base de données inaccessible
- Symptômes : `/api/health` 503 ; `statuses.database=critical`.
- Voir `OBSERVABILITY.md §5.1` ; si corruption → `DISASTER_RECOVERY.md §3`.

### 4. Redis/Upstash indisponible
- Comportement ATTENDU : rate-limit **fail-closed** (requêtes publiques
  refusées, pas de passoire) ; `/api/health` reste vivant (limiteur mémoire).
- Action : rétablir le service ; aucune donnée à restaurer.

### 5. Plateforme e-invoicing indisponible
- Comportement : aucun envoi simulé (registre d'adaptateurs fail-closed) ;
  les factures restent émises localement, transmission différée.
- Action : file d'attente/reprise côté adaptateur (idempotencyKey prévu dans
  le contrat `SubmitInvoiceContext`).

### 6. Corruption de factures suspectée
- Vérifier l'immuabilité (machine à états — retour brouillon impossible) et
  les sceaux de signature (`GET /api/signatures` → `document_modified` /
  `seal_tampered`).
- Croiser avec `AuditLog` ; restaurer depuis sauvegarde si besoin (§DR) ;
  la numérotation transactionnelle rend les trous détectables.

### 7. Mise à jour Windows compromise
- La chaîne de MàJ est fail-closed (signature/hash/anti-downgrade testés) : un
  paquet altéré est REFUSÉ (tests `update-verify`).
- Si compromission de la SOURCE de publication : révoquer les artefacts,
  republier signé, forcer la vérification côté clients, communication.

### 8. Attaque sur les licences
- Révocation côté control-plane (irréversible, testée) ; plafond d'appareils
  atomique (prouvé sous concurrence PG) ; HWID haché.
- Vérifier `LicenseDeviceEvent` pour l'historique d'activations.

### 9. Incident multi-tenant (suspicion de fuite inter-garages)
- Geler l'accès concerné ; rejouer la matrice d'isolation
  (`tenant-isolation-matrix.test.ts`, 63 tests) sur la version déployée ;
  auditer `AuditLog` par `garageId` ; notifier selon RGPD si des données
  personnelles ont fui (voir DPO — validation externe).

## Communication & preuves

- Chronologie horodatée (UTC) dès la détection.
- Preuves conservées : logs redactés, sorties d'outils (`verify:rotation`,
  gitleaks), dumps AVANT éradication.
- Notification RGPD (72 h) : décision JURIDIQUE — préparer le dossier
  technique, la qualification revient au DPO/conseil (validation externe).
