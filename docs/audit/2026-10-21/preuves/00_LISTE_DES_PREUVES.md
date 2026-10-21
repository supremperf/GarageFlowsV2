# Liste des preuves nécessaires — établie AVANT toute conclusion

Source des exigences : le brief initial en deux parties (« Mission globale
d'audit, de sécurisation… Axe A / Axe B » et « Mission master engineering »),
plus la consigne finale « une fois terminé, mets à jour sur GitHub ».

Chaque exigence est ramenée à un résultat **observable**, puis à la preuve qui
permettrait de le constater. La colonne « Faisabilité » dit, avant toute
capture, si la preuve peut être produite depuis l'environnement d'exécution
(conteneur Linux sans Windows ni accès aux comptes de production).

Règles appliquées :

- Une capture terminal montre une commande **réellement exécutée** dans un
  `xterm` sur affichage virtuel, avec date, branche et commit en en-tête.
- Une capture d'interface montre l'application **réelle** (keygen Tk,
  application Next.js, pages GitHub), jamais une maquette.
- Une démonstration de licence n'utilise qu'une **autorité de test jetable**
  dans une copie isolée, jamais l'autorité de production (`b16d2e1b…`).
- Une exigence sans capture possible est déclarée « Non vérifiable » ou « Non
  réalisée », avec la manipulation qui permettrait d'obtenir la preuve.

| N° | Exigence (référence du brief) | Preuve nécessaire | Faisabilité |
|---|---|---|---|
| D01 | Audit intégral et cartographie avant modification (M1 §1.1, M2 §4) | Rapport d'audit et état initial des tests (échecs constatés avant correction) | Oui (document + terminal) |
| D02 | Mettre à jour sur GitHub une fois terminé | Branche poussée, PR ouverte et à jour | Oui (terminal + page GitHub) |
| D03 | Livrables documentaires (M2 §22 : 9 documents ; M1 §20 : rapport final) | Dossier `docs/audit/2026-10-21/` | Oui (terminal) |
| D04 | Inventaire et classification de toutes les variables (M1 §3.2) | Manifeste des variables et contrôle de cohérence | Oui (terminal) |
| D05 | Renouvellement des secrets internes (M1 §3.3) | Valeurs renouvelées sur Vercel, consommateurs validés | **Non** : aucun accès Vercel |
| D06 | Connexions Neon et Upstash réelles (M1 §3.4) | Connexion vérifiée sur les vrais comptes | **Non** : aucun jeton |
| D07 | Conserver les variables externes et SMTP (M1 §3.5) | Aucune modification des variables externes dans la session | Oui (terminal) |
| D08 | Migration `GF_SMTP_CIPHER_KEY` (M1 §3.6) | Rechiffrement vérifié en base | **Non** : aucune base de production |
| D09 | Autorité ECC préservée, aucune paire régénérée en cachette (M1 §3.7) | Ancrages publics alignés ; keygen refusant d'inventer une autorité | Oui (terminal + keygen) |
| D10 | Synchronisation Vercel Development / Preview / Production (M1 §4) | Variables par environnement | **Non** : aucun accès |
| D11 | Secrets hors de Git, `.gitignore` complété (M1 §4.4, §13) | Règles d'exclusion actives, scan Gitleaks à 0 | Oui (terminal) |
| D12 | Keygen Python : sections obligatoires, en français (M1 §6.2) | Capture de chaque section du keygen réel | Oui (Xvfb) |
| D13 | Gestion ECC P-256, PEM, emplacements `%APPDATA%` et `GF_LICENSE_*_KEY_FILE` (M1 §6.3) | Page « Clés ECC » ; prise en charge des emplacements demandés | Partielle (à vérifier) |
| D14 | Offres PREMIUM et ADMIN uniquement (M1 §6.4) | Écran de génération | Oui (keygen) |
| D15 | Créer, consulter, suspendre, réactiver, révoquer une licence (M1 §6.4) | Parcours réel avec une autorité de test | À tenter (copie isolée) |
| D16 | Format signé canonique, vecteurs Python / Node (M1 §6.5) | Tests de compatibilité croisée | Oui (terminal) |
| D17 | HWID V1 officiel, vecteurs identiques (M1 §7.1-7.2) | Tests de vecteurs Node ↔ Python | Oui (terminal) |
| D18 | Première activation atomique, refus d'un appareil en trop (M1 §7.4) | Tests de concurrence sur PostgreSQL réel ; activation réelle | Oui (terminal) ; activation à tenter |
| D19 | Compatibilité HWID V0 / V1 (M1 §7.3) | Tests de coexistence | Oui (terminal) |
| D20 | PostgreSQL : migrations sans perte (M1 §8.1, M2 §9) | Migrations rejouées sur base vierge | Oui (terminal) |
| D21 | SQLite poste : transactions et concurrence (M1 §8.2) | Avant / après du correctif d'interblocage | Oui (terminal) |
| D22 | API authentifiées et autorisées (M1 §8.3, M2 §8) | Balayage des routes sans session ; suites RBAC | Oui (terminal) |
| D23 | Electron : IPC, preload, démarrage du serveur local (M1 §8.4) | Tests preload ; lancement réel de l'application | Partielle : Electron non exécutable ici, lancement prouvé par la CI Windows |
| D24 | `npm run sign-update`, message exact sans clé (M1 §9.2-9.3) | Exécution réelle sans clé ; onglet « Mises à jour » | Oui (terminal + keygen) |
| D25 | Vérification client des mises à jour (M1 §9.4, §14.6) | Refus d'un binaire modifié, d'une clé étrangère | Oui (terminal) |
| D26 | Détection des secrets sur captures, masquage, blocage (M1 §10) | Avant / après sur de vraies captures ; service local | Oui (terminal + keygen) |
| D27 | Interfaces en français, messages d'état (M1 §11) | Écrans du keygen et de l'application | Oui |
| D28 | `npm install` puis `npm run dist` produisant l'installateur (M1 §12, M2 §12.3) | Job Windows de la CI | Oui (page GitHub) ; impossible en local |
| D29 | Installation, lancement, réinstallation, désinstallation, mise à jour (M2 §12.4-12.5) | Étape d'installation de la CI ; mise à jour Vn → Vn+1 | Partielle |
| D30 | Lint et typage sans erreur (M1 §15) | `tsc`, ESLint | Oui (terminal) |
| D31 | Aucune vulnérabilité de dépendance (M1 §15.1, M2 §12.2) | `npm audit` | Oui (terminal) |
| D32 | Suite de tests complète sans échec (M2 §16) | Vitest avec PostgreSQL et Redis ; suites Python et Node | Oui (terminal) |
| D33 | Tests de bout en bout dans un navigateur (M2 §13) | Playwright | Oui (terminal) |
| D34 | Parcours métier client → véhicule → intervention → devis → facture (M2 §7.1) | Tests d'intégration ; écrans de l'application | Oui (terminal) ; écrans à tenter |
| D35 | Stock : pas de double déduction, concurrence (M2 §7.2) | Avant / après | Oui (terminal) |
| D36 | Paiements : partiel, multiple, remboursement, webhooks (M2 §6.7) | Module de paiement en fonctionnement | À constater |
| D37 | Facturation électronique et conformité (M2 §11) | Tests des formats ; interconnexion réelle | Partielle |
| D38 | Aucun secret dans les bundles et artefacts (M2 §15) | Recherche dans la sortie de build ; Gitleaks | Oui (terminal) |
| D39 | Logiciel prêt pour la production (M2 §25) | Verdict argumenté | Oui (document) |
