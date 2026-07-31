# Architecture de facturation électronique — PROPOSITION DE CONCEPTION

> **STATUT : DESIGN / PROPOSITION — NON CONSTRUIT.**
> Ce document décrit une architecture *cible* pour rendre GarageFlow compatible
> avec la facturation électronique française (réforme 2026-2027). **Aucune** de
> ces couches n'existe aujourd'hui dans le code. La capacité e-invoicing actuelle
> du produit est **nulle** : aucun code Factur-X / UBL / CII / Chorus Pro / PDP
> n'est présent dans les dépôts (vérifié par recherche exhaustive, audit domaine
> `data-model-einvoicing`, risque **HIGH**). Ce fichier sert de plan d'ingénierie
> pour un acquéreur, pas de description d'une fonctionnalité livrée.

---

## 1. Objet et périmètre

La réforme française de la facturation électronique impose, selon un calendrier
échelonné 2026-2027, l'émission et la réception de factures B2B dans un **format
structuré** (Factur-X, UBL ou CII, conformes à la norme européenne EN 16931),
transmises via une **Plateforme de Dématérialisation Partenaire (PDP)** ou le
portail public (Chorus Pro pour le secteur public), assorties d'un **e-reporting**
du cycle de vie et des données de paiement/transaction.

Cette proposition définit :

1. une **interface fournisseur agnostique** (provider-agnostic) découplant le
   métier de tout PDP particulier ;
2. des **adaptateurs** (adapters) par fournisseur, dont un **fournisseur de démonstration simulé** ;
3. une **couche de format documentaire** (Factur-X / UBL / CII) ;
4. un modèle de **statuts de cycle de vie** et d'**e-reporting** ;
5. une politique d'**archivage** légal.

Le but est d'isoler le socle métier existant (modèle `Invoice`, numérotation
séquentielle, calcul TVA en centimes entiers — voir §2) derrière des frontières
stables, afin qu'un branchement PDP réel (voir `E_INVOICING_PROVIDER_INTEGRATION.md`)
soit une extension et non une réécriture.

---

## 2. Point de départ : le modèle de facture actuel et ses lacunes

L'architecture proposée doit s'appuyer sur — et corriger — le modèle existant.
Références réelles :

- Modèle `Invoice` : `prisma/schema.prisma:337-372`
- Modèle `InvoiceLine` : `prisma/schema.prisma:374-384`
- Calcul monétaire : `src/lib/billing.ts` (délègue à `src/lib/money.ts`, centimes entiers)
- Identifiants légaux vendeur : `Garage.siret` / `Garage.vatNumber` (`prisma/schema.prisma:42`)

### Ce qui est solide (à conserver)

| Élément | État | Preuve |
|---|---|---|
| Numérotation séquentielle sans trou (transactionnelle) | opérationnel | `src/app/api/invoices/route.ts:71-116`, contrainte `@@unique([garageId, number])` |
| Immuabilité de la facture émise (édition bloquée hors `draft`) | opérationnel | `src/app/api/invoices/[id]/route.ts:32-38, 88-92` |
| Arithmétique TVA en centimes entiers (TTC = HT + TVA exact) | opérationnel | `src/lib/billing.ts:39-46`, `src/lib/money.ts` |
| Snapshot identité client/véhicule sur le document | opérationnel | `prisma/schema.prisma:350-356` |

### Lacunes bloquantes pour l'e-invoicing (à combler par cette conception)

| Lacune | Détail | Référence |
|---|---|---|
| **TVA mono-taux en en-tête** | `Invoice.taxRate Float @default(20)` unique ; `InvoiceLine` n'a **aucun** champ `vatRate`/`vatCategory`. La ventilation TVA par taux exigée par EN 16931 est impossible. | `prisma/schema.prisma:362, 374-384` |
| **Aucun total figé stocké** | `totalHT`/`totalTTC`/`taxAmount` sont recalculés à la volée (`withTotals`), jamais gelés à l'émission. | `src/lib/billing.ts:39-46` |
| **Dates en chaîne** | `issueDate`/`dueDate` sont des `String` `'YYYY-MM-DD'`, inadaptées à la sérialisation structurée. | `prisma/schema.prisma:359-360` |
| **Aucun identifiant légal acheteur** | Pas de SIRET/SIREN/TVA intra acheteur ; le SIRET vendeur (`Garage.siret`) n'est jamais recopié sur la facture. | `prisma/schema.prisma:42` |
| **Cycle de vie pauvre** | Statuts libres `draft/sent/paid/overdue`, aucun statut e-reporting normalisé. | `prisma/schema.prisma:358` |
| **Aucun modèle Avoir / Paiement** | L'API renvoie « Créez un avoir » mais aucun modèle `CreditNote`/`Payment` n'existe. | `src/app/api/invoices/[id]/route.ts:37` |

---

## 3. Vue d'ensemble de l'architecture cible (proposée)

```
┌──────────────────────────────────────────────────────────────────┐
│  Domaine métier (existant)                                        │
│  Invoice / InvoiceLine / numérotation / billing.ts (centimes)     │
└───────────────┬──────────────────────────────────────────────────┘
                │  (1) Modèle enrichi (§4)  — À CONSTRUIRE
                ▼
┌──────────────────────────────────────────────────────────────────┐
│  Couche de format documentaire (§5)  — À CONSTRUIRE               │
│  InvoiceDocumentBuilder → Factur-X (PDF/A-3 + XML CII) | UBL | CII│
└───────────────┬──────────────────────────────────────────────────┘
                │  DTO normalisé EN 16931
                ▼
┌──────────────────────────────────────────────────────────────────┐
│  Interface fournisseur agnostique  EInvoiceProvider (§6)          │
│      submit() · fetchStatus() · fetchInbound() · lifecycle()      │
└───────┬───────────────────────┬──────────────────────┬───────────┘
        ▼                       ▼                      ▼
  SimulatedProvider     PdpProvider (réel)      ChorusProProvider
   (démo, §7)           (voir doc intégration)   (secteur public)
        │
        ▼
┌──────────────────────────────────────────────────────────────────┐
│  Cycle de vie + e-reporting (§8)  ·  Archivage légal (§9)         │
└──────────────────────────────────────────────────────────────────┘
```

Toutes les cases marquées « À CONSTRUIRE » sont **inexistantes aujourd'hui**.

---

## 4. Modèle de données enrichi (proposé)

Extension Prisma *proposée* — à ajouter aux schémas desktop **et** serveur
(`prisma/schema.prisma` et `prisma/server/schema.prisma`, qui sont en parité
structurelle stricte selon l'audit). Exemple illustratif, non implémenté :

```prisma
// PROPOSÉ — n'existe pas dans le dépôt.
model Invoice {
  // ... champs existants ...
  // --- Ajouts e-invoicing ---
  issueDateTime   DateTime?     // remplace/complète issueDate String
  dueDateTime     DateTime?
  totalHT         Int?          // centimes — figé à l'émission
  totalVAT        Int?          // centimes
  totalTTC        Int?          // centimes
  sellerSiret     String?       // snapshot vendeur à l'émission
  sellerVatNumber String?
  buyerSiret      String?       // identifiant légal acheteur (B2B)
  buyerVatNumber  String?
  documentType    String  @default("380") // 380=facture, 381=avoir (UNCL1001)
  lifecycleState  String  @default("draft") // voir §8
  einvoice        EInvoiceDocument?
}

model InvoiceLine {
  // ... champs existants ...
  vatRate     Float   @default(20)   // TVA par ligne
  vatCategory String  @default("S")  // S=standard, Z=zéro, E=exonéré (UNCL5305)
}

model EInvoiceDocument {          // artefact structuré généré
  id            String   @id @default(cuid())
  invoiceId     String   @unique
  format        String   // "facturx" | "ubl" | "cii"
  profile       String   // "EN16931" | "BASIC" | "EXTENDED"
  xml           String   // charge utile structurée
  pdfPath       String?  // PDF/A-3 porteur (Factur-X)
  hash          String   // SHA-256 pour archivage/intégrité
  providerRef   String?  // identifiant retourné par le PDP
  createdAt     DateTime @default(now())
}

model CreditNote { /* Avoir — à modéliser, voir E_INVOICING_LIMITATIONS.md */ }
model Payment    { /* e-reporting paiement — à modéliser */ }
```

Ces ajouts adressent directement les six lacunes du §2.

---

## 5. Couche de format documentaire (proposée)

Un `InvoiceDocumentBuilder` transformerait une facture enrichie en un DTO
normalisé EN 16931, puis en sortie sérialisée :

- **Factur-X** : PDF/A-3 lisible avec **XML CII** embarqué (profil `EN16931` par défaut, `BASIC`/`EXTENDED` selon besoin) — format hybride recommandé pour le B2B français.
- **UBL 2.1** : facture purement structurée (Universal Business Language).
- **CII** (UN/CEFACT Cross Industry Invoice) : XML structuré, cœur de Factur-X.

Contrat proposé (interface, non implémentée) :

```ts
// PROPOSÉ.
interface InvoiceDocumentBuilder {
  build(invoice: EnrichedInvoice, format: 'facturx' | 'ubl' | 'cii'): Promise<{
    xml: string
    pdf?: Buffer        // uniquement Factur-X
    profile: string
    hash: string        // SHA-256
  }>
}
```

Points de conformité à respecter par l'implémentation : ventilation TVA par taux
(BG-23), identifiants BT-31/BT-47 (SIRET vendeur/acheteur), dates BT-2/BT-9,
totaux BT-109/BT-110/BT-112. Voir `E_INVOICING_LIMITATIONS.md` §EN 16931 pour la
cartographie des champs manquants.

---

## 6. Interface fournisseur agnostique (proposée)

Frontière stable isolant le métier de tout PDP. Détaillée côté branchement réel
dans `E_INVOICING_PROVIDER_INTEGRATION.md`.

```ts
// PROPOSÉ — contrat de référence.
interface EInvoiceProvider {
  readonly name: string
  submit(doc: EInvoiceDocument): Promise<{ providerRef: string; state: LifecycleState }>
  fetchStatus(providerRef: string): Promise<LifecycleState>
  fetchInbound(): Promise<EInvoiceDocument[]>        // factures reçues
  reportPayment(ref: string, payment: PaymentReport): Promise<void> // e-reporting
}
```

L'injection du provider se ferait par configuration (variable d'environnement),
permettant de basculer démo → PDP réel sans toucher au métier.

---

## 7. Fournisseur de démonstration simulé (proposé)

Un `SimulatedProvider` implémenterait `EInvoiceProvider` **en local**, sans réseau :

- génère un `providerRef` factice ;
- fait transiter le document par la machine à états du §8 (dépôt → reçu →
  approuvé) via un minuteur ou une action manuelle d'administration ;
- permet de démontrer le flux e-invoicing **de bout en bout sans contrat PDP**.

Analogie assumée avec l'API publique `/api/v1` actuelle, qui est elle-même un
**bac à sable en mémoire non persistant** (`src/lib/api/store.ts`, audit
`cloud-control-plane`, risque HIGH). Le `SimulatedProvider` serait un dispositif
de démonstration, **jamais** un canal de transmission réel.

---

## 8. Statuts de cycle de vie et e-reporting (proposés)

Machine à états normalisée remplaçant les statuts libres actuels :

```
draft → issued → submitted → deposited → received
                                   ├─→ approved  → paid
                                   └─→ refused   → corrected (avoir)
```

Statuts e-reporting cibles (alignés sur le référentiel de la réforme) :
`deposited`, `received`, `approved`, `refused/rejected`, `payment_reported`.
Chaque transition serait horodatée et journalisée (le socle d'audit
`AuditLog` existe déjà côté control-plane) pour la traçabilité exigée.

L'e-reporting couvrirait également les **données de paiement** (statut,
date d'encaissement) via `reportPayment()` — d'où le modèle `Payment` proposé au §4.

---

## 9. Archivage légal (proposé)

- Conservation du **PDF/A-3 Factur-X** et de son **XML** pendant la durée légale
  (10 ans), avec empreinte **SHA-256** stockée (`EInvoiceDocument.hash`) pour
  garantir l'intégrité.
- Le desktop dispose déjà d'un socle de sauvegardes (horaire/quotidien/hebdo,
  `electron/main.js:837-892`) et d'un manifeste d'intégrité HMAC ; l'archivage
  e-invoicing réutiliserait ces mécanismes, avec stockage externe (Blob) côté cloud.

---

## 10. Ce que cette conception NE fait PAS

- Elle **ne fournit aucun code fonctionnel** : tout est au stade plan.
- Elle **ne connecte aucun PDP ni Chorus Pro** (nécessite contrat + accès externes).
- Elle **ne remplace pas** l'analyse d'écart : voir `E_INVOICING_LIMITATIONS.md`
  pour le chiffrage honnête du reste-à-faire (build pluri-mensuel).

---

*Référence croisée : voir [`docs/ACQUISITION_READINESS_AUDIT.md`](./ACQUISITION_READINESS_AUDIT.md) pour l'audit complet et le classement des risques.*
