# Mapping GarageFlows → EN 16931 → CII (profil Factur-X MINIMUM)

Table de correspondance du modèle implémenté (`src/lib/einvoicing/`). Preuve :
XML généré validé contre le **XSD officiel Factur-X 1.09 MINIMUM** (xmllint,
2026-08-07). Les BT non listés en §1 ne sont **pas supportés** (voir §3).

## 1. Champs mappés

| Champ GarageFlows | BT EN 16931 | Élément CII |
|---|---|---|
| `Invoice.number` | BT-1 (numéro) | `rsm:ExchangedDocument/ram:ID` |
| `Invoice.issueDate` | BT-2 (date d'émission) | `ram:IssueDateTime/udt:DateTimeString @format=102` |
| type figé `380` | BT-3 (type) | `ram:TypeCode` |
| `EUR` (fixe) | BT-5 (devise) | `ram:InvoiceCurrencyCode` |
| `Invoice.dueDate` | BT-9 | modèle canonique (sérialisation aux profils supérieurs) |
| `Garage.name` | BT-27 (vendeur) | `ram:SellerTradeParty/ram:Name` |
| SIREN (dérivé du SIRET) | BT-30 (id légal) | `ram:SpecifiedLegalOrganization/ram:ID @schemeID=0002` (UN seul ID — cardinalité XSD 0..1 ; repli SIRET `@schemeID=0009`) |
| `Garage.vatNumber` | BT-31 (TVA vendeur) | `ram:SpecifiedTaxRegistration/ram:ID @schemeID=VA` |
| pays vendeur `FR` | BT-40 | `ram:PostalTradeAddress/ram:CountryID` |
| `Invoice.clientName` | BT-44 (acheteur) | `ram:BuyerTradeParty/ram:Name` |
| `taxRate` (unique/document) | BT-119 (taux TVA) | modèle canonique (`ratePercentToString`, ventilation aux profils supérieurs) |
| Σ lignes (centimes exacts) | BT-109 (assiette) | `ram:TaxBasisTotalAmount` |
| `taxCentsFromBasis(assiette, taux)` | BT-110 (TVA) | `ram:TaxTotalAmount @currencyID=EUR` |
| assiette + TVA (identité entière) | BT-112 (TTC) | `ram:GrandTotalAmount` |
| = BT-112 (aucun acompte modélisé) | BT-115 (à payer) | `ram:DuePayableAmount` |
| lignes (`InvoiceLine`) | BG-25 / BT-129/131/146/153 | modèle canonique (`CanonicalLine`) — sérialisées aux profils BASIC+ |

Chaque montant provient de la couche financière centrale (entiers exacts,
formule de TVA unique du dépôt) — cohérence affichage/facture/e-invoicing par
construction.

## 2. Contrôles appliqués avant sérialisation (fail-closed)

SIREN/SIRET Luhn (tout-zéros rejeté), clé TVA FR vérifiée, cohérences
SIREN↔SIRET↔TVA, dates calendaires réelles, codes pays, caractères XML 1.0
interdits, bornes du domaine entier, **recalcul intégral** lignes/assiette/
TVA/TTC (règles `GF-EI-0xx`, `validate.ts`). Document invalide → exception,
jamais de XML émis.

## 3. Volontairement non supporté à ce stade (documenté)

| Élément | Raison |
|---|---|
| BT-10 (BuyerReference), BT-13 (bon de commande), références | non modélisés en base |
| BT-47/BT-48 (id légal / TVA acheteur) | champs présents au modèle canonique, non alimentés (la base ne stocke pas le SIREN client) — requis pour le circuit B2B : évolution de schéma à prévoir |
| Multi-taux de TVA par document | `Invoice.taxRate` unique — ventilation BG-23 multiple aux profils BASIC+ après évolution du modèle |
| Avoirs (381) | non modélisés en base (types de document à introduire) |
| Remises/charges document (BG-20/21) | remises gérées en amont du document |
| PDF/A-3 (Factur-X complet), Schematron, transmission PA | voir `docs/EINVOICING_FORMATS.md §2-3` |
