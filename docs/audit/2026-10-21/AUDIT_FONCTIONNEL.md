# AUDIT_FONCTIONNEL — 2026-10-21

Chaque ligne renvoie à des tests **exécutés et verts dans cette session**
(suite complète : 4 376 réussis, 0 échec, avec PostgreSQL et Redis réels).
Les tests d'intégration s'exécutent sur une base SQLite réelle, à travers les
vrais gestionnaires de route. Le parcours dans un navigateur authentifié reste
BLOQUÉ (licence signée requise).

| Fonctionnalité | Fichiers principaux | Preuves exécutées | Statut |
|---|---|---|---|
| Parcours atelier complet : client et véhicule → pièce posée → devis → facture → stock engagé une fois → portail → statistiques → suppression qui rend le stock → isolement des garages | `src/app/api/{jobs,quotes,invoices}`, `src/lib/stock` | `scenario-maitre`, `business-workflow-e2e` | VALIDÉ (API, base réelle) |
| Clients | `src/app/api/clients`, `ClientsPanel.tsx` | `intervention-rattache-client-vehicule`, `client-email-garage-portail`, `tenant-isolation-matrix` | VALIDÉ |
| Véhicules, historique, prêt de véhicule | `src/app/api/{vehicles,loaner-*}` | `loaner-availability`, suites `vehicles` | VALIDÉ |
| Interventions, planning, mécaniciens | `src/app/api/{jobs,mechanics}`, `ScheduleBoard.tsx` | `planning-journee-complete`, `mechanic-scope-realtime`, `mechanic-avatar-*`, `synchro-voie-de-retour` ; E2E `planning-mechanics` : ignoré | VALIDÉ (API), BLOQUÉ (navigateur authentifié) |
| Stock : mouvements, inventaire, suppression, concurrence | `src/lib/stock` | `invoice-stock-sync`, `stock-*`, `part-*`, `stock-double-deduction` (**corrigé**, GF-1021-01), `stock-concurrency.postgres` | VALIDÉ |
| Devis : génération, signature, preuve d'acceptation | `src/app/api/quotes`, `src/lib/quote-gen` | `quotes-generate`, `quote-acceptance-proof`, `devis-signature-depuis-un-poste` | VALIDÉ |
| Facturation : montants au centime, TVA, immutabilité, intégrité documentaire, numérotation | `src/lib/money*.ts`, `src/app/api/invoices` | `statistiques-au-centime`, `document-integrity-v15`, `invoice-document-integrity-p3`, `document-numbering.postgres` (50 en parallèle), `check:money*` | VALIDÉ |
| Paiements | statut `paid` de `Invoice` | — | **Hors périmètre du produit actuel** : aucun modèle de paiement, ni paiement partiel, ni rapprochement, ni prestataire de paiement. Ne pas présenter comme une fonctionnalité. |
| Export FEC | `src/app/api/export/fec` | `fec-injection-v15` | VALIDÉ |
| Fournisseurs, commandes d'achat | `src/app/api/{suppliers,purchase-orders}` | `suppliers`, `supplier-linkage`, `purchase-order-receive-returned` | VALIDÉ |
| Portail client : comptes, 2FA, liens, messagerie, rendez-vous | `src/app/api/portal`, `src/lib/portal` | `portail-*`, `portal-*`, `messagerie-client-garage`, `rendez-vous-client-garage` | VALIDÉ |
| Réglages appliqués | `src/lib/settings` | `reglages-*` | VALIDÉ |
| Copilote | `src/lib/copilot*` | `copilot*` (6 fichiers) | VALIDÉ (logique, sans modèle distant) |
| OCR plaques et documents | `src/lib/ocr` | `ocr` | VALIDÉ |
| Licences : activation, plafond de sièges, révocation, session licenciée | `src/lib/license`, `src/app/api/license` | `license-devices.postgres` (concurrence réelle), `licensed-session.postgres`, `licence-admin-durcissement` | VALIDÉ ; licence signée par l'autorité de production : BLOQUÉ |
| Keygen (10 sections, PREMIUM / ADMIN) | `scripts/keygen*.py` | 20 + 10 + 88 tests Python ; interface rendue sous Xvfb, 14 tests de cycle de vie | VALIDÉ |
| Mises à jour signées | `electron/update-verify.js`, `scripts/gf_sign_update.js` | `update-signing-cli`, `update-verify`, `release-signing-chain`, `publication-mise-a-jour` | VALIDÉ (clés de test) |
| Détection de secrets dans les captures | `scripts/secret_scan.py`, `patterns.toml` | 36 tests dont OCR réel (**corrigé**, GF-1021-02) | VALIDÉ |
| Facturation électronique | `src/lib/einvoicing` | `formats`, `queue`, `submit-chain`, webhook signé | Fonctionnalité développée et formats générés ; **aucune interconnexion réelle** (PDP, Chorus Pro) ; conformité réglementaire **non vérifiée** |
| PWA : fenêtre, photos, installation | `public/`, `PwaRegister.tsx` | `pwa-fenetre-et-photos`, `check:pwa` ; E2E publics responsive : 18 réussis | VALIDÉ (hors session authentifiée) |

## Facturation électronique : niveau atteint

| Niveau | État |
|---|---|
| 1. Fonctionnalité développée | oui |
| 2. Format techniquement valide | contrôles internes verts ; validation XSD / Schematron officielle sur fichiers réels non rejouée ici |
| 3. Tests de conformité réussis | NON TESTÉ |
| 4. Interconnexion externe opérationnelle | BLOQUÉ (aucun compte de plateforme) |
| 5. Conformité réglementaire vérifiée | NON TESTÉ : à confier à un spécialiste |
