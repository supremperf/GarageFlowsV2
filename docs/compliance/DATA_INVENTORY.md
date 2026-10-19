# Inventaire technique des données (base : schémas Prisma, audit V13)

Cartographie factuelle des données à caractère personnel manipulées par
GarageFlows. Finalités indiquées comme **probables** (qualification juridique =
DPO, validation externe). Localisation : SQLite locale (desktop) OU PostgreSQL
serveur selon le déploiement ; chiffrement au repos = celui du support
(BitLocker/fournisseur PG) sauf mention contraire.

| Donnée | Modèle (champ) | Finalité probable | Conservation | Accès | Export | Suppression |
|---|---|---|---|---|---|---|
| Identité client (nom, tél., email, adresse) | `Client` | gestion clientèle, devis/factures | vie du dossier client | staff du garage (scopé `garageId`) | exports garage | suppression client SAUF documents comptables (voir anonymisation) |
| Véhicule (plaque, VIN, km) | `Vehicle` | suivi atelier, CT | vie du dossier | staff | oui | avec le client (cascade contrôlée) |
| Comptes staff (email, hash bcrypt) | `User` | authentification | vie du compte | admin garage | — | suppression de compte |
| Mécaniciens (nom) | `Mechanic` | planning | vie du contrat | staff | — | oui |
| Documents (devis/factures : nom, adresse client) | `Quote`/`Invoice` (snapshots) | **obligation comptable** | durée LÉGALE (≥ 10 ans) | staff | FEC, PDF | **INTERDITE pendant la durée légale** → anonymisation du dossier client, documents conservés |
| Photos d'intervention | `JobPhoto` (+ fichiers `GF_PHOTOS_DIR`) | preuve d'intervention | vie du dossier | staff | oui | oui (fichier + ligne) |
| Signatures (image, nom signataire, **IP, user-agent**, horodatage) | `Signature` | preuve d'intégrité du consentement | durée du document signé | staff | — | suit le document ; IP/UA = minimisation à réévaluer par le DPO |
| Portail client (email, appareils) | `PortalUser`, `PortalDevice` | accès client final | vie du compte portail | client + staff | — | oui |
| RDV (nom, plaque, motif) | `Appointment` | prise de rendez-vous | glissante | staff | — | oui |
| Journal d'audit (acteur, action, cible) | `AuditLog` | traçabilité sécurité | glissante (rétention à fixer) | admin | — | purge par rétention |
| Notifications (destinataire) | `NotificationLog` | relances/alertes | glissante | staff | — | purge |
| Logs applicatifs | stdout/stderr | diagnostic | selon collecteur | ops | — | rotation collecteur |

## Minimisation constatée

- Logs **redactés systématiquement** (aucun secret/token/donnée sensible —
  `logger.ts` + `redact.ts`, testé).
- Le portail fonctionne par **lien de capacité signé** (pas de compte requis
  pour la consultation simple).
- IP/user-agent collectés UNIQUEMENT sur l'acte de signature (valeur probante) —
  point à arbitrer juridiquement (proportionnalité).
- Aucune donnée envoyée à des tiers analytiques (CSP `connect-src 'self'`).

## Trous connus (à combler, voir RGPD_TECHNICAL_MEASURES)

- Durées de rétention `AuditLog`/`NotificationLog` non paramétrées.
- Procédure d'anonymisation client (droit à l'effacement compatible avec la
  conservation comptable) : conception documentée, implémentation à livrer.
