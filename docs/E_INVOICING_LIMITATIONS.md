# Facturation électronique — ANALYSE D'ÉCART (contrepartie honnête)

> **STATUT : ÉTAT DES LIEUX FACTUEL.**
> Ce document est le **contrepoids honnête** des deux documents de conception
> (`E_INVOICING_ARCHITECTURE.md`, `E_INVOICING_PROVIDER_INTEGRATION.md`). Ceux-ci
> décrivent une architecture *proposée* ; celui-ci mesure ce qui **existe
> réellement** face à la réglementation. **Verdict : la capacité de facturation
> électronique de GarageFlow est aujourd'hui quasi nulle.** Il ne faut revendiquer
> **aucune** compatibilité Factur-X / UBL / CII / Chorus Pro / PDP. Source : audit
> domaine `data-model-einvoicing`, risque **HIGH**.

---

## 1. Constat de base

Recherche exhaustive sur les dépôts (`factur-x|facturx|zugferd|ubl|cii|chorus|pdp|e-reporting`) :
**aucune correspondance réelle** — toutes les occurrences de « invoice » étaient
des faux positifs de sous-chaîne. Il n'existe :

- **aucun** code de génération de format structuré (Factur-X / UBL / CII) ;
- **aucun** connecteur PDP ni Chorus Pro ;
- **aucun** modèle de cycle de vie e-reporting ;
- **aucun** modèle Avoir (`CreditNote`) ni Paiement (`Payment`) — pourtant l'API
  invite à « Créez un avoir » (`src/app/api/invoices/[id]/route.ts:37`).

Ce qui existe est une **facturation interne basique** correcte (numérotation
sans trou, immuabilité de la facture émise, calcul TVA exact en centimes), mais
**non conforme** aux exigences structurées de la réforme.

---

## 2. Écart détaillé vs le mandat français 2026-2027

| Exigence du mandat | État actuel | Verdict |
|---|---|---|
| Émission en format structuré (Factur-X/UBL/CII) | Aucun générateur | **MANQUANT** |
| Transmission via PDP / Chorus Pro | Aucun connecteur | **MANQUANT** |
| Réception de factures fournisseurs (entrant) | Aucun canal | **MANQUANT** |
| E-reporting (statuts cycle de vie + paiement) | Statuts libres `draft/sent/paid/overdue` | **MANQUANT** |
| Ventilation TVA par taux | `Invoice.taxRate` unique en en-tête ; ligne sans TVA | **MANQUANT** |
| SIRET/TVA acheteur (routage B2B) | Non capturé | **MANQUANT** |
| SIRET vendeur figé sur la facture | Présent sur `Garage` mais jamais recopié | **MANQUANT** |
| Avoir (facture rectificative) | Aucun modèle | **MANQUANT** |
| Archivage légal du document structuré | Sauvegardes génériques uniquement | **PARTIEL / MANQUANT** |

---

## 3. Écart vs la norme EN 16931

La norme européenne EN 16931 impose un modèle sémantique de facture. Cartographie
des champs obligatoires face au modèle actuel (`prisma/schema.prisma:337-384`) :

| Terme EN 16931 | Champ requis | Présent aujourd'hui ? |
|---|---|---|
| BT-2 Date d'émission | date structurée | Non — `issueDate` est une `String` |
| BT-9 Date d'échéance | date structurée | Non — `dueDate` est une `String` |
| BT-31 Identifiant TVA vendeur | SIRET/TVA vendeur sur la facture | Non — jamais snapshoté |
| BT-47/BT-48 Identifiant acheteur | SIRET/TVA acheteur | Non — absent |
| BG-23 Ventilation TVA par taux | TVA par catégorie/taux | Non — taux unique en en-tête |
| BT-109/110/112 Totaux HT/TVA/TTC | totaux figés | Non — recalculés à la volée, non stockés |
| BT-3 Type de document (facture/avoir) | code type | Non — pas de `documentType` |

**Conclusion : le modèle de données actuel ne peut pas produire une facture
EN 16931 valide.** Une refonte du modèle (voir §4 de l'architecture proposée) est
un préalable non négociable.

---

## 4. Chiffrage indicatif du reste-à-faire

Estimation d'ingénierie (indicative, à confirmer par l'acquéreur) pour atteindre
une conformité opérationnelle. **Il s'agit d'un build pluri-mensuel**, pas d'un
ajustement.

| Chantier | Effort indicatif |
|---|---|
| Refonte modèle de données (TVA par ligne, totaux figés, dates DateTime, identifiants légaux, types de document) + migrations desktop **et** serveur | ~3-5 semaines |
| Modèles Avoir (`CreditNote`) et Paiement (`Payment`) + workflows | ~2-3 semaines |
| Couche format Factur-X (PDF/A-3 + XML CII) / UBL / CII conforme EN 16931 | ~4-6 semaines |
| Interface `EInvoiceProvider` + `SimulatedProvider` (démo) | ~1-2 semaines |
| Adaptateur PDP réel + webhooks + gestion d'erreurs fail-closed | ~3-4 semaines |
| E-reporting (cycle de vie + paiement) + archivage légal | ~2-3 semaines |
| Recette de conformité sur sandbox PDP + certification | dépend du PDP (externe) |

**Total ordre de grandeur : plusieurs mois-homme**, hors délais et coûts des
prérequis externes (contrat PDP, immatriculation, identifiants API — voir
`E_INVOICING_PROVIDER_INTEGRATION.md` §1).

---

## 5. Implication pour l'acquéreur

- La facturation électronique est un **risque HIGH** et un **chantier à construire**,
  pas une fonctionnalité livrée. Aucune revendication commerciale de conformité
  Factur-X/UBL/CII/Chorus Pro/PDP ne doit être faite en l'état.
- Pour le marché cible (garages français indépendants), cette conformité sera
  **légalement requise** selon le calendrier 2026-2027 : c'est donc un
  investissement **obligatoire** post-acquisition, à intégrer à la valorisation
  et au plan produit.
- Les documents de conception associés fournissent un plan d'exécution crédible
  et des frontières d'architecture propres, mais restent des **propositions**.

---

*Référence croisée : voir [`docs/ACQUISITION_READINESS_AUDIT.md`](./ACQUISITION_READINESS_AUDIT.md) pour l'audit complet et le classement des risques.*
