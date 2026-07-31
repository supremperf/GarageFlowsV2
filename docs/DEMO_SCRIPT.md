# Script de démonstration guidée — GarageFlow

> Document destiné à la data room d'acquisition. Objectif : permettre à un acquéreur
> de dérouler une démonstration **factuelle** du produit, en distinguant clairement ce
> qui est **opérationnel** (câblé + fonctionnel), **partiel**, **codé sans UI**, ou
> **NON CONSTRUÉ (roadmap / DESIGN)**. Chaque scénario est ancré sur des routes/pages/
> composants réels du dépôt. Ne présentez jamais comme fonctionnelle une capacité
> marquée NON CONSTRUÉ.

## Préalables

- Environnement de démo lancé selon `docs/DEMO_ENVIRONMENT.md` (seed `prisma/seed.ts` :
  garage « Garage Demo », **5 mécaniciens, 13 interventions** du jour — chiffres vérifiés).
- Identifiant de démo (libellé démo, pas un secret du dépôt) :
  `admingarageflow@admin.fr` / `AdminMDPgarageFlow2026..Flow` (voir `prisma/seed.ts:35`).
- Deux surfaces à distinguer pendant la démo :
  - **Application poste de travail** (Electron / PWA, dépôt `GarageFlowsV2`) — l'atelier.
  - **Plan de contrôle cloud** (dépôt `garagesite3`, back-office `/admin/*`) — licences,
    modules, releases, audit réseau.

### Légende des statuts

| Statut | Signification |
|---|---|
| ✅ Opérationnel | Câblé de l'UI à la base, fonctionne dans la démo |
| 🟡 Partiel | Fonctionne mais avec limites documentées |
| 🟠 Codé sans UI | Service/route existent, aucune interface ne l'invoque |
| 🔴 NON CONSTRUÉ / DESIGN | Absent du produit — proposition ou contournement manuel |

---

## Scénario 1 — Réception véhicule ✅ Opérationnel

**But :** enregistrer l'arrivée d'un véhicule et le suivi de son statut atelier.

1. Depuis l'en-tête (`src/components/Header.tsx:442`, bouton *Réception*), ouvrir le
   **tableau de réception** (`src/components/ReceptionBoard.tsx`).
2. Le tableau affiche les interventions du jour groupées par statut
   (`scheduled` / `in_progress` / `completed`) — données issues de `GET /api/jobs`.
3. Créer une intervention via le bouton *Créer* (`Header.tsx:419` → `JobModal`,
   `src/components/JobModal.tsx`) : client, modèle véhicule, immatriculation, type de
   réparation, mécanicien, durée estimée. Enregistrement via `POST /api/jobs`
   (`src/app/api/jobs/route.ts`).

**Ancrage :** `src/components/ReceptionBoard.tsx`, `src/app/api/jobs/route.ts`,
`src/components/JobModal.tsx`.
**À montrer honnêtement :** la saisie de plaque peut appeler l'OCR/reconnaissance
plaque (scénario 3) — cette brique dépend d'une clé `ANTHROPIC_API_KEY` **optionnelle** ;
sans clé, le champ reste en saisie manuelle (dégradation silencieuse).

---

## Scénario 2 — Ordre de réparation (OR) ✅ Opérationnel

**But :** formaliser un ordre de réparation à partir d'une intervention.

1. Ouvrir une intervention et lancer le **WorkOrderModal**
   (`src/components/WorkOrderModal.tsx`).
2. Ajouter lignes de main-d'œuvre et pièces ; enregistrement via `/api/work-orders`
   (`src/app/api/work-orders/route.ts`).
3. Le modèle `WorkOrder` stocke des totaux HT/TTC/TVA figés (contrairement à `Invoice`
   qui les recalcule — voir scénario 7).

**Ancrage :** `src/components/WorkOrderModal.tsx`, `src/app/api/work-orders/`.

---

## Scénario 3 — Photos d'intervention ✅ Opérationnel (OCR plaque optionnel)

**But :** documenter l'état du véhicule par photos.

1. Depuis l'intervention, ouvrir **JobPhotos** (`src/components/JobPhotos.tsx`).
2. Ajouter des photos — persistées via `POST /api/jobs/[id]/photos`
   (`src/app/api/jobs/[id]/photos/route.ts`).
3. (Optionnel) Reconnaissance de plaque par photo : `OcrPanel`
   (`src/components/OcrPanel.tsx`) → `POST /api/plate-ocr`.
   **Dépendance :** clé `ANTHROPIC_API_KEY` (optionnelle). Sans clé, la route renvoie
   **503** et l'OCR est indisponible — démontrer alors la saisie manuelle.

**Ancrage :** `src/components/JobPhotos.tsx`, `src/app/api/jobs/[id]/photos/route.ts`,
`src/app/api/plate-ocr/route.ts`.

---

## Scénario 4 — Devis 🟡 Partiel (TVA mono-taux)

**But :** produire un devis client.

1. Ouvrir **QuoteInvoiceModal** (`src/components/QuoteInvoiceModal.tsx`) ou le panneau
   de facturation (`src/components/BillingPanel.tsx`).
2. Créer un devis : `POST /api/quotes` (`src/app/api/quotes/route.ts`), numérotation
   séquentielle transactionnelle sans trou (compteur incrémenté dans la même transaction).
3. Assistance de génération : `POST /api/quotes/generate`
   (`src/app/api/quotes/generate/route.ts`).

**À montrer honnêtement :** la TVA est **mono-taux au niveau en-tête** (`Quote.taxRate`,
`prisma/schema.prisma`). Il n'existe **pas** de ventilation TVA par ligne (exigence
EN16931 / Factur-X). Ne pas présenter le devis comme prêt pour la facturation
électronique.

**Ancrage :** `src/app/api/quotes/route.ts`, `src/app/api/quotes/generate/route.ts`,
`src/components/QuoteInvoiceModal.tsx`.

---

## Scénario 5 — Validation / signature client 🟡 Partiel

**But :** faire valider/signer un devis par le client.

1. Générer un lien de signature : `POST /api/quotes/[id]/signature-token`
   (`src/app/api/quotes/[id]/signature-token/route.ts`).
2. Le client ouvre le portail public `src/app/portal/quote/[token]/page.tsx` et signe
   (capture via `src/app/api/signatures/route.ts`).

**À montrer honnêtement :** le portail client fonctionne pour la signature de devis. Ce
n'est pas une signature électronique qualifiée (eIDAS) — c'est une capture de signature
+ jeton. Ne pas la présenter comme signature réglementaire.

**Ancrage :** `src/app/api/quotes/[id]/signature-token/route.ts`,
`src/app/portal/quote/[token]/page.tsx`, `src/app/api/signatures/route.ts`.

---

## Scénario 6 — Suivi des travaux (pointage / timer) ✅ Opérationnel

**But :** suivre l'avancement réel des interventions.

1. Dans le tableau de réception, démarrer/arrêter le **chronomètre** d'une intervention
   (boutons Play/Square, `ReceptionBoard.tsx`) → `POST /api/jobs/[id]/timer`
   (`src/app/api/jobs/[id]/timer/route.ts`).
2. Faire passer le statut `scheduled → in_progress → completed` ; la durée réelle
   (`actualDuration`) est comparée à l'estimée.
3. Consommation de pièces sur l'intervention : `/api/jobs/[id]/parts`
   (`src/app/api/jobs/[id]/parts/route.ts`).

**Ancrage :** `src/app/api/jobs/[id]/timer/route.ts`, `src/app/api/jobs/[id]/parts/route.ts`.

---

## Scénario 7 — Facturation 🟡 Partiel (pas de e-invoicing)

**But :** émettre une facture, éventuellement depuis un devis.

1. Convertir un devis en facture : `POST /api/quotes/[id]/convert`
   (`src/app/api/quotes/[id]/convert/route.ts`).
2. Émettre/consulter les factures via **BillingPanel** (`src/components/BillingPanel.tsx`)
   → `/api/invoices` (`src/app/api/invoices/route.ts`).
3. Montrer la **numérotation séquentielle sans trou** (compteur + facture créés dans une
   seule transaction, `route.ts:71-116`) et l'**immuabilité** d'une facture émise
   (édition financière bloquée dès `status != draft`, `src/app/api/invoices/[id]/route.ts`).

**À montrer honnêtement (gaps majeurs) :**
- 🔴 **Aucune facturation électronique** : pas de Factur-X / UBL / CII / ZUGFeRD, pas de
  transmission Chorus Pro / PDP, pas de statuts e-reporting. Le produit **n'est pas prêt**
  pour la réforme française B2B 2026-2027.
- 🔴 **Pas de modèle Avoir (note de crédit)** ni de modèle Paiement, alors que l'API
  renvoie « Créez un avoir » (`src/app/api/invoices/[id]/route.ts:37`).
- TVA mono-taux en-tête ; totaux **recalculés** à la lecture (pas de snapshot figé à
  l'émission, `src/lib/billing.ts`) ; dates stockées en chaîne `YYYY-MM-DD`.
- Un export **FEC** existe (`src/app/api/export/fec/route.ts`) — utile comptablement, à ne
  pas confondre avec la facturation électronique.

**Ancrage :** `src/app/api/invoices/route.ts`, `src/app/api/invoices/[id]/route.ts`,
`src/app/api/quotes/[id]/convert/route.ts`, `src/lib/billing.ts`,
`src/app/api/export/fec/route.ts`.

---

## Scénario 8 — Restitution véhicule / inspection 🟡 Partiel

**But :** contrôle de sortie et restitution au client.

1. Réaliser une inspection de sortie via **InspectionModal**
   (`src/components/InspectionModal.tsx`) → `/api/inspections`
   (`src/app/api/inspections/route.ts`).
2. Consulter l'historique du véhicule : **VehicleHistoryModal**
   (`src/components/VehicleHistoryModal.tsx`).
3. Le client peut consulter ses documents via le portail
   (`src/app/portal/[token]/page.tsx`, `src/app/portal/account/page.tsx`).

**À montrer honnêtement :** il n'existe pas de « bon de restitution » réglementaire dédié ;
la restitution s'appuie sur l'inspection + l'historique + le portail client.

**Ancrage :** `src/app/api/inspections/route.ts`, `src/components/InspectionModal.tsx`,
`src/components/VehicleHistoryModal.tsx`.

---

## Scénario 9 — Relances / suivi client ✅ Opérationnel

**But :** relancer les clients (entretien, garanties).

1. Ouvrir **ReminderPanel** (`src/components/ReminderPanel.tsx`, bouton *Relances*
   `Header.tsx:488`).
2. Suggestions de relances : `/api/reminders/suggestions` ; envoi : `/api/reminders/send`
   (`src/app/api/reminders/`).
3. Alertes de garantie : **WarrantyPanel** (`src/components/WarrantyPanel.tsx`) →
   `/api/warranties/alerts` (`src/app/api/warranties/`).

**À montrer honnêtement :** l'envoi d'e-mails dépend d'une configuration SMTP
(`/api/email`, réglages *EmailTab*) ; sans SMTP configuré, la relance est préparée mais
non expédiée.

**Ancrage :** `src/app/api/reminders/`, `src/app/api/warranties/`,
`src/components/ReminderPanel.tsx`, `src/components/WarrantyPanel.tsx`.

---

## Scénario 10 — Rentabilité / pilotage financier 🟡 Partiel

**But :** analyser la rentabilité de l'atelier.

1. Ouvrir **FinancialDashboard** (`src/components/FinancialDashboard.tsx`, bouton
   *Finance* `Header.tsx:519`) → `/api/finance` (`src/app/api/finance/route.ts`).
2. Tableau de bord opérationnel : **Dashboard** (`src/components/Dashboard.tsx`) →
   `/api/stats`, `/api/reports` (`src/app/api/reports/route.ts`).
3. Prévisions : `/api/forecast`, `/api/forecast`… (module prévision de stock/CA).

**À montrer honnêtement :** indicateurs calculés sur les données locales du garage
(mono-garage). Il n'y a **pas** de consolidation multi-garage (voir scénario 11).

**Ancrage :** `src/app/api/finance/route.ts`, `src/app/api/reports/route.ts`,
`src/components/FinancialDashboard.tsx`, `src/components/Dashboard.tsx`.

---

## Scénario 11 — Administration réseau 🟡 Partiel (contrôle-plan, pas hiérarchie org)

**But :** montrer la supervision d'un parc d'installations.

1. Sur le **plan de contrôle cloud** (`garagesite3`), ouvrir le back-office
   `src/app/admin/dashboard/page.tsx` (tableau de bord licences/appareils, SSE temps réel
   avec repli polling).
2. Modules/entitlements : `src/app/admin/modules/page.tsx` ;
   notifications ciblées : `src/app/admin/notifications/page.tsx` ;
   crashes : `src/app/admin/crashes/page.tsx`.

**À montrer honnêtement (limitation structurelle) :**
- 🔴 Il n'existe **aucune entité Organisation/Réseau au-dessus de `Garage`** dans le
  schéma opérationnel. Le « réseau » = un ensemble d'installations mono-garage
  supervisées par le contrôle-plan de licences, **pas** une hiérarchie multi-garage avec
  reporting consolidé.
- L'accès admin repose sur **une seule clé maître partagée** (pas de comptes par
  opérateur, pas de RBAC, pas de MFA).

**Ancrage :** `garagesite3/src/app/admin/dashboard/page.tsx`,
`garagesite3/src/app/admin/modules/page.tsx`, `prisma/schema.prisma` (Garage = tenant racine).

---

## Scénario 12 — Activation / révocation de licence ✅ Opérationnel

**But :** activer une licence sur un poste, puis la révoquer côté serveur.

**Activation (poste de travail) :**
1. Ouvrir `src/app/license/page.tsx`, coller un jeton `GF2.xxx…`.
2. `POST /api/license/activate` (`src/app/api/license/activate/route.ts`) — toute la
   crypto est côté serveur (vérif ECDSA P-256), pose de cookies, redirection.

**Révocation (contrôle-plan cloud) :**
3. Dans `garagesite3` back-office, révoquer par clé :
   `POST /api/admin/licenses/revoke-by-key`
   (`garagesite3/src/app/api/admin/licenses/revoke-by-key/route.ts`), ou révoquer un
   appareil précis (`…/licenses/[id]/devices/[deviceId]`).
4. Au heartbeat suivant, le poste bascule (overlay `LicenseRevokedOverlay.tsx`).

**À montrer honnêtement (bloquant P0 pour l'acquéreur) :** l'**émission** de licences
nécessite la **clé privée ECC P-256**, absente du dépôt (`keys/private.pem` gitignoré) et
détenue côté serveur uniquement. Sans transfert de cette clé + du backend, l'acquéreur ne
peut émettre aucune licence. La démo d'activation utilise un jeton **pré-généré**.

**Ancrage :** `src/app/license/page.tsx`, `src/app/api/license/activate/route.ts`,
`garagesite3/src/app/api/admin/licenses/revoke-by-key/route.ts`.

---

## Scénario 13 — White-label / marque 🟠 Partiel — DESIGN largement non câblé

**But :** montrer la capacité de re-marquage (rebrand-and-resell).

1. Montrer la config typée **`src/config/brand.ts`** (validation Zod, 3 couches :
   défauts ← `brand.config.json` ← variables `GF_BRAND_*`) et côté cloud
   `NEXT_PUBLIC_PRODUCT_NAME` (`garagesite3/src/lib/site.ts`).
2. Modifier `GF_BRAND_*` puis observer les rares consommateurs réels
   (`src/config/app.ts` → `APP_CONFIG.name`).

**À montrer honnêtement (facade-deep) :** la config est bien conçue mais **quasi non
câblée** : ~2 usages `BRAND.*` hors du fichier de config, alors que le nom « GarageFlow »
est **codé en dur ~146 fois** et 8 couleurs hex de marque codées en dur
(`src/app/layout.tsx:7`, `src/components/GarageFlowLogo.tsx:45`,
`src/components/Dashboard.tsx`). Présenter ceci comme une **fondation / proposition
(DESIGN)**, pas comme un white-label opérationnel : re-marquer réellement demande de
modifier des dizaines de fichiers.

**Ancrage :** `src/config/brand.ts`, `src/config/app.ts`, `src/app/layout.tsx`,
`docs/WHITE_LABEL_GUIDE.md`.

---

## Scénario 14 — Import CSV 🔴 NON CONSTRUÉ (DESIGN) — démontrer le chemin manuel

**But :** importer un portefeuille clients/véhicules existant.

**Réalité :** il n'existe **aucun assistant d'import CSV/Excel** : pas de dépendance de
parsing (papaparse/exceljs/xlsx/csv-parse absents), pas d'UI ni de route d'import
générique, pas de mapping de champs ni de dry-run. Le seul CSV présent est en **export**
de rapports (`src/lib/reports/csv.ts`). Une brique voisine existe pour l'atelier :
`/api/labor-operations/bulk-import` (import d'opérations de main-d'œuvre uniquement).

**Comment démontrer sans mentir :**
1. Annoncer clairement : « l'import de données est une **proposition (DESIGN)**, pas une
   fonctionnalité livrée ».
2. Démontrer le **chemin manuel réel** : création client/véhicule via `JobModal` /
   `VehicleModal` (`src/components/VehicleModal.tsx`) → `/api/clients`, `/api/jobs`.
3. Éventuellement montrer `/api/labor-operations/bulk-import` comme brique existante
   proche, en précisant sa portée limitée (opérations de main-d'œuvre).

**Ancrage :** `src/lib/reports/csv.ts` (export uniquement),
`src/app/api/labor-operations/bulk-import/route.ts`, `src/components/VehicleModal.tsx`.

---

## Scénario 15 — Journal d'audit ✅ Opérationnel (côté contrôle-plan)

**But :** montrer la traçabilité des actions administratives.

1. Sur le contrôle-plan cloud, ouvrir `garagesite3/src/app/admin/audit/page.tsx` :
   recherche/filtre + export CSV du journal d'audit (`AuditLog`, `server/audit.ts`).
2. Côté poste de travail, une brique d'audit existe aussi
   (migration `add_audit_log_and_indexes`, `prisma/migrations/`).

**À montrer honnêtement :** l'audit du contrôle-plan **n'est pas attribuable à un
opérateur nominatif** (clé maître unique partagée — pas de comptes par personne). C'est un
journal d'actions, pas un audit multi-utilisateur avec imputabilité.

**Ancrage :** `garagesite3/src/app/admin/audit/page.tsx`,
`garagesite3/src/lib/server/audit.ts`.

---

## Récapitulatif honnêteté (à garder en tête pendant la démo)

| Capacité | Statut réel |
|---|---|
| Réception, OR, photos, timer, jobs | ✅ Opérationnel |
| Devis / factures (numérotation, immuabilité) | 🟡 Partiel (TVA mono-taux, totaux recalculés) |
| Facturation électronique (Factur-X/PDP/Chorus) | 🔴 NON CONSTRUÉ |
| Avoir / paiements | 🔴 NON CONSTRUÉ |
| Signature devis (portail) | 🟡 Partiel (non eIDAS) |
| Relances / garanties | ✅ Opérationnel (SMTP requis pour l'envoi) |
| Rentabilité / finance | 🟡 Partiel (mono-garage) |
| Administration réseau | 🟡 Partiel (pas de hiérarchie org, clé maître unique) |
| Activation / révocation licence | ✅ Opérationnel (émission = clé privée hors dépôt, P0) |
| White-label | 🟠 DESIGN largement non câblé |
| Import CSV/Excel | 🔴 NON CONSTRUÉ (démontrer le manuel) |
| Journal d'audit | ✅ Opérationnel (non nominatif) |
| API publique v1 (intégrations tierces) | 🔴 Démo mémoire non persistante (ne pas démontrer comme prod) |
| Backups chiffrés | 🟠 Codé sans UI (routes admin only) |
| Tests E2E / UI | 🔴 Aucun (validation manuelle uniquement) |

---

*Réf. croisée : voir `docs/ACQUISITION_READINESS_AUDIT.md` pour l'audit complet, les risques classés et les bloquants P0.*
