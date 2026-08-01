# Actions externes requises (hors périmètre IA)

_Ce qu'une IA de codage ne peut PAS réaliser dans cet environnement. Chaque ligne :
objectif · responsable · prérequis · procédure · preuve attendue · critère
PASS/FAIL. Aucune de ces actions n'a été effectuée — elles sont **BLOCKED_EXTERNAL**
(tiers/contrat) ou **BLOCKED_ENVIRONMENT** (Windows/infra indisponible)._

## 1. Certificat de signature Windows — BLOCKED_EXTERNAL
- **Objectif** : signer l'installateur/exe pour supprimer « éditeur inconnu ».
- **Responsable** : dirigeant / responsable juridique (entité vérifiable).
- **Prérequis** : société immatriculée, justificatifs d'identité.
- **Procédure** : acheter un certificat OV/EV (DigiCert, Sectigo…) → configurer
  `WIN_CSC_LINK` + `WIN_CSC_KEY_PASSWORD` (secrets CI) → release taguée.
- **Preuve** : `scripts/verify-windows-signature.ps1 -Strict` = « Valid ».
- **PASS/FAIL** : PASS si tous les binaires signés « Valid » ; FAIL sinon.

## 2. Réputation SmartScreen — BLOCKED_EXTERNAL
- **Objectif** : plus d'avertissement Defender au téléchargement.
- **Responsable** : marketing/ops. **Prérequis** : action 1.
- **Procédure** : distribuer des binaires signés ; volume (immédiat en EV).
- **Preuve** : installation sans avertissement sur postes tiers.
- **PASS/FAIL** : PASS si pas d'avertissement bloquant.

## 3. Build/installeur Windows réel — BLOCKED_ENVIRONMENT
- **Objectif** : produire et tester l'installateur NSIS.
- **Responsable** : ingénieur release. **Prérequis** : Windows / runner windows-latest.
- **Procédure** : `.github/workflows/windows-build.yml` (ou `docs/WINDOWS_RELEASE_CHECKLIST.md`).
- **Preuve** : artefact `dist/*.exe` + `scripts/test-windows-installation.ps1` OK.
- **PASS/FAIL** : PASS si install/désinstall silencieux réussis.

## 4. Contrat plateforme de dématérialisation (PDP) — BLOCKED_EXTERNAL
- **Objectif** : transmission réelle des factures électroniques (Chorus Pro/PDP/PPF).
- **Responsable** : direction. **Prérequis** : entité + adhésion PDP + accès OAuth2.
- **Procédure** : implémenter un adaptateur `ElectronicInvoiceProvider` réel
  (interface fournie) + variables `EINVOICE_*` (voir `ELECTRONIC_INVOICING_PROVIDER.md`).
- **Preuve** : transmission acceptée en sandbox PDP puis production.
- **PASS/FAIL** : PASS si un statut « accepté » réel est obtenu.

## 5. Validation Factur-X / EN 16931 officielle — BLOCKED_EXTERNAL
- **Objectif** : conformité prouvée (Schematron officiel, PDF/A-3).
- **Responsable** : expert conformité. **Prérequis** : outil de validation officiel.
- **Preuve** : rapport de validation Schematron/PDF-A conforme.
- **PASS/FAIL** : PASS si 0 erreur bloquante sur le validateur officiel.

## 6. Pentest / audit de sécurité externe — BLOCKED_EXTERNAL
- **Objectif** : audit indépendant. **Responsable** : RSSI/prestataire.
- **Prérequis** : périmètre (`docs/PENTEST_SCOPE.md` si présent) + comptes de test.
- **Preuve** : rapport de pentest + registre de remédiation.
- **PASS/FAIL** : PASS si aucune vuln critique ouverte non traitée.

## 7. Validation juridique & fiscale — BLOCKED_EXTERNAL
- **Objectif** : conformité RGPD/facturation confirmée par un juriste/expert-comptable.
- **Preuve** : avis écrit signé. **PASS/FAIL** : PASS si avis favorable documenté.

## 8. Clients pilotes / LOI / témoignages — BLOCKED_EXTERNAL
- **Objectif** : preuve de marché réelle (voir `docs/pilot/`).
- **Responsable** : commercial. **Prérequis** : garages réels contactés.
- **Procédure** : exécuter `docs/pilot/PILOT_PROGRAM.md` ; utiliser
  `docs/pilot/LOI_TEMPLATE.md` (modèle NON signé).
- **Preuve** : LOI **réellement signées**, comptes rendus de pilotes réels.
- **PASS/FAIL** : PASS uniquement avec des documents signés vérifiables.
- **Note d'intégrité** : aucun client, pilote, signature ou témoignage n'est
  inventé dans ce dépôt.

## 9. Transfert d'actifs (domaines, comptes, PI) — BLOCKED_EXTERNAL
- **Objectif** : cession effective à l'acquéreur.
- **Responsable** : cédant + acquéreur + avocat.
- **Procédure** : transfert `garageflows.fr` (DNS/registrar), comptes fournisseurs
  (Vercel/Neon/Upstash/Blob/e-mail/SMS), **clés privées de signature** (licence
  ECC + MàJ Ed25519), assignation écrite de PI.
- **Preuve** : accès transférés + contrat d'assignation signé + démonstration que
  l'acquéreur peut émettre une licence et signer une MàJ.
- **PASS/FAIL** : PASS si opérabilité end-to-end démontrée sans le vendeur.

## 10. Tests physiques multi-machines — BLOCKED_ENVIRONMENT
- **Objectif** : valider HWID/offline/antivirus sur du matériel réel varié.
- **Responsable** : QA. **Preuve** : matrice de tests renseignée.
- **PASS/FAIL** : PASS si les parcours passent sur ≥2 configurations réelles.

_Voir aussi : `docs/WINDOWS_CODE_SIGNING.md`, `docs/ELECTRONIC_INVOICING_LIMITATIONS.md`,
`docs/KNOWN_LIMITATIONS.md`, `docs/FINAL_IMPLEMENTATION_REPORT.md`._
