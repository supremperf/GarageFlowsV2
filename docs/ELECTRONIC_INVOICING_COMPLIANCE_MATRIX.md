# Facturation électronique — Matrice de conformité (honnête)

_Couverture réelle du cœur EN 16931 par l'implémentation `src/lib/einvoicing/`.
✅ couvert & testé · ⚠️ partiel · ❌ non réalisé. Date : 2026-08-01._

> **Avertissement.** Cette matrice décrit la couverture **technique** du modèle et
> des formats. Elle ne constitue **pas** une attestation de conformité officielle
> ni un agrément PDP. La conformité légale finale dépend d'une PDP agréée et d'une
> validation par un schéma/Schematron officiel (non exécutée ici).

## Champs / règles EN 16931 (cœur)

| Élément | BT/BR | Statut | Note |
|---|---|---|---|
| Numéro de facture | BT-1 | ✅ | `id` obligatoire (validé) |
| Date d'émission | BT-2 | ✅ | ISO `YYYY-MM-DD`, format 102 en CII |
| Type (facture/avoir) | BT-3 | ✅ | 380 / 381 |
| Devise | BT-5 | ✅ | depuis `garage.currency` |
| Date d'échéance | BT-9 | ⚠️ | présente si renseignée |
| Nom vendeur | BT-27 | ✅ | |
| **SIRET vendeur** | BT-30 | ✅ | `garage.siret`, format 14 chiffres validé (Luhn en avertissement) |
| N° TVA vendeur | BT-31 | ✅ | `garage.vatNumber` |
| Nom acheteur | BT-44 | ✅ | snapshot `invoice.clientName` |
| **SIRET acheteur** | BT-47 | ❌ | **le schéma `Client` ne stocke pas de SIRET** — avertissement B2B (fournissable via option) |
| Lignes (désignation, quantité, PU) | BG-25 | ✅ | par ligne |
| Montant net de ligne | BT-131 | ✅ | `round(quantité × PU)` en cents, cohérence validée |
| Ventilation TVA par taux | BG-23 | ⚠️ | **un seul taux d'en-tête** (`invoice.taxRate`) : une entrée de ventilation. Pas de TVA par ligne (limite du schéma) |
| Total HT | BT-109 | ✅ | cents entiers |
| Total TVA | BT-110 | ✅ | `round(HT × taux/100)` |
| Total TTC | BT-112 | ✅ | invariant `TTC = HT + TVA` vérifié |
| Net à payer | BT-115 | ✅ | = TTC (pas d'acompte modélisé) |
| Moyens de paiement (IBAN/BIC) | BG-16 | ✅ | depuis le garage |
| Conditions de paiement | BT-20 | ✅ | `garage.paymentTerms` |
| Référence facture d'origine (avoir) | BT-25 | ⚠️ | portée en UBL ; simplifiée en CII |
| Remises/charges document | BG-20/21 | ❌ | non modélisées |
| Acomptes | BT-113 | ❌ | pas de modèle Paiement (voir audit) |

## Formats

| Format | Statut | Note |
|---|---|---|
| UBL 2.1 (Invoice) | ✅ | profil EN 16931 ; testé |
| CII (factur-x.xml) | ✅ | XML seul ; **PDF/A-3 non généré/embarqué** |
| Factur-X (PDF/A-3 + XML) | ❌ | l'incorporation du XML dans un PDF/A-3 nécessite une lib PDF (non ajoutée) |
| UBL CreditNote (syntaxe dédiée) | ⚠️ | avoir porté via `InvoiceTypeCode=381` sur la syntaxe Invoice |
| Validation Schematron officielle | ❌ | validateur interne uniquement (BR-xx essentiels) |

## Cycle de vie & transmission

| Élément | Statut | Note |
|---|---|---|
| Statuts (DRAFT→…→PAID, REJECTED/REFUSED/CANCELLED) | ✅ | machine à états + transitions contrôlées |
| Dépôt (submit) + idempotence | ✅ | adaptateur **sandbox** |
| Webhooks de statut (signature HMAC, anti-rejeu) | ✅ | `verifyWebhook` testé |
| **Transmission réelle Chorus Pro / PDP** | ❌ | **contrat + accès requis** — non connecté |
| e-reporting | ❌ | non implémenté |
| Archivage à valeur probante | ❌ | non implémenté (XML conservé en démo) |

Voir `ELECTRONIC_INVOICING_LIMITATIONS.md` pour la liste bloquante et
`docs/ACQUISITION_READINESS_AUDIT.md`.
