# Limites connues (état honnête)

_Liste franche des limites au 2026-08-01, après les travaux de cette session.
Statuts : ❌ non construit · ⚠️ partiel · 🔒 dépend d'un tiers · 🪟 dépend de
Windows/infra. Voir `docs/EXTERNAL_ACTIONS_REQUIRED.md` pour les actions._

## Fonctionnalités non construites
- **Multi-organisation / multi-garage opérationnel** ❌ — le modèle métier reste
  **mono-garage** (isolation par `garageId`). Aucune entité Organisation/Réseau
  au-dessus de `Garage`. Une thèse de roll-up exige une refonte schéma + RBAC.
  Design : `docs/MULTI_GARAGE_ARCHITECTURE.md`. **Non implémenté** (risque élevé
  sur le schéma desktop ; à faire dans un chantier dédié).
- **Import CSV/XLSX** ❌ — aucun assistant d'import (seul un bulk-import JSON
  étroit existe). Design : `docs/DATA_MIGRATION_GUIDE.md`.
- **E2E Playwright** ❌ — aucun test navigateur ; couverture = unitaire +
  intégration SQLite (750 tests). Plan : `docs/TEST_STRATEGY.md`.
- **API publique persistante** ⚠️ — `garagesite3` `/api/v1` est une démo en
  mémoire (dépôt séparé).

## Facturation électronique
- **Transmission PDP réelle** 🔒 — aujourd'hui : dépôt vers un **sandbox**. La
  persistance des transmissions est **réelle** (modèles + store + API + tests) ;
  la connexion à une PDP agréée nécessite un contrat. `ELECTRONIC_INVOICING_LIMITATIONS.md`.
- **Factur-X PDF/A-3** ❌ — le XML CII est généré ; l'incorporation dans un
  PDF/A-3 (lib PDF) n'est pas faite.
- **Validation officielle** 🔒 — validateur interne (BR-xx cœur) ; pas de
  Schematron officiel.
- **Modèle de données facture** ⚠️ — un seul taux de TVA d'en-tête (pas par
  ligne) ; pas de SIRET acheteur dans `Client` ; pas de modèle Avoir/Paiement
  persistant ; dates en chaînes.

## Windows / desktop
- **Build & installeur Windows** 🪟 — non exécutables ici (Linux). Workflow +
  scripts fournis, prêts à l'emploi. `docs/WINDOWS_RELEASE_CHECKLIST.md`.
- **Signature de code** 🔒 — pipeline prêt, aucun certificat. `docs/WINDOWS_CODE_SIGNING.md`.
- **Migrations desktop non baselinées** ⚠️ — 2 patchs incrémentaux, pas de
  baseline ; repose sur `db push` + template DB committée. **Pas de migration à
  l'exécution pour les installations existantes** : une nouvelle table (ex. la
  persistance e-invoicing) atteint les **nouvelles** installations (template
  régénéré) mais PAS les bases déjà déployées sans étape de mise à niveau.

## Sécurité (réserves restantes)
- **IAM admin** ⚠️ — le control-plane cloud authentifie via une **clé admin
  unique** ; pas de comptes nominatifs/MFA/RBAC. `docs/ADMIN_SECURITY.md`.
- **Anti-tamper local** ⚠️ — vérification d'intégrité JS-only (contournable) ;
  énforcement licence *fail-open* hors-ligne.
- **Avis de dépendances** ⚠️ — avis transitifs (`sharp`/libvips, `postcss`…) ;
  suivi `docs/VULNERABILITY_MANAGEMENT.md` ; gate CI à rendre bloquant après
  remédiation.
- **Résolu cette session** : secrets TOTP **chiffrés au repos** ; verrou 2FA
  par compte ; validations e-invoicing durcies.

## Sauvegarde / restauration
- **UI de sauvegarde/restauration** ❌ — service chiffré complet en code, sans
  écran utilisateur. `docs/BACKUP_AND_RESTORE.md`.
- **Restauration cloud réelle** 🪟 — non exécutée (pas d'infra Postgres ici).

## Preuves externes (jamais fabriquées)
- **Aucun** client payant, pilote, LOI, témoignage, audit externe, certificat ou
  validation juridique. Outils préparés dans `docs/pilot/` (modèles NON signés).

_Voir aussi : `docs/ACQUISITION_READINESS_AUDIT.md`, `docs/IMPLEMENTATION_BASELINE.md`._
