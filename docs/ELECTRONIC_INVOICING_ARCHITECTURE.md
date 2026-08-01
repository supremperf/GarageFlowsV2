# Facturation électronique — Architecture (implémentation réelle)

_État : **implémenté et testé** (bibliothèque + route API + 30 tests verts). Ce
n'est PAS une plateforme agréée (PDP) et aucune transmission officielle n'a lieu.
Voir `ELECTRONIC_INVOICING_LIMITATIONS.md`. Date : 2026-08-01._

## 1. Ce qui est réellement construit

Bibliothèque `src/lib/einvoicing/` (aucune dépendance externe — propreté PI/SBOM) :

| Fichier | Rôle | Statut |
|---|---|---|
| `types.ts` | Modèle pivot normalisé (EN 16931), montants en **centimes entiers**, statuts de cycle de vie | ✅ |
| `map.ts` | Cartographie `Invoice`+`Garage` (Prisma) → document pivot, via `money.ts` (cents exacts) | ✅ |
| `validate.ts` | Validateur cœur EN 16931 (champs obligatoires, SIRET, **cohérence des totaux/TVA**) | ✅ |
| `ubl.ts` | Sérialisation **UBL 2.1** (profil EN 16931) | ✅ |
| `cii.ts` | Sérialisation **CII** (le XML `factur-x.xml` de Factur-X) | ✅ (XML ; PDF/A-3 non embarqué) |
| `xml.ts` | Échappement XML + formatage monétaire exact (sans flottant) + date 102 | ✅ |
| `provider.ts` | Interface fournisseur agnostique + machine à états du cycle de vie | ✅ |
| `providers/sandbox.ts` | Adaptateur **sandbox fonctionnel** (dépôt, idempotence, transitions) | ✅ |
| `webhook.ts` | Vérification de webhook (HMAC temps constant, anti-rejeu) | ✅ |
| `src/app/api/invoices/[id]/einvoice/route.ts` | **Route API** : génère + valide + télécharge (UBL/CII), scoping garage | ✅ |

Tests : `src/lib/einvoicing/__tests__/` — **30 tests** (mapping/cents, validation,
UBL, CII, sandbox lifecycle, webhook). `npx vitest run src/lib/einvoicing`.

## 2. Chaîne de traitement

```
Invoice + Garage (Prisma)
   │  mapInvoiceToDocument()          ← money.ts : centimes entiers, invariant TTC = HT + TVA
   ▼
EInvoiceDocument (pivot, EN 16931)
   │  validateDocument()              ← erreurs bloquantes + avertissements (BR-xx, GF-*)
   ├─► toUBL()  → UBL 2.1  Invoice XML
   └─► toCII()  → CII (factur-x.xml)
   │  provider.submit(doc, {format})  ← SandboxEInvoiceProvider (démo) | PDP réelle (à venir)
   ▼
Transmission { id, status, xml }  →  cycle de vie  →  webhook de statut (vérifié HMAC)
```

## 3. Accès (route API)

`GET /api/invoices/{id}/einvoice?format=CII|UBL[&download=1]`
- Authentifié + **scopé par garage** (facture et garage chargés par `garageId` de session).
- JSON : `{ document, validation, format, xml }` ; `download=1` : XML brut en pièce jointe.

## 4. Modèle de statuts (cycle de vie)

`DRAFT → SUBMITTED → RECEIVED → ACCEPTED → PAID` (+ `REJECTED`, `REFUSED`,
`CANCELLED`). Transitions contrôlées par `canTransition()` ; le sandbox refuse les
sauts invalides. Aligné sur le flux d'émission → dépôt → décision → paiement.

## 5. Décisions d'ingénierie

- **Centimes entiers partout** (réutilise `money.ts`) : l'invariant `TTC = HT + TVA`
  est exact ; le validateur le vérifie.
- **Sans dépendance XML** : génération par gabarits + échappement maison → aucune
  nouvelle licence tierce, SBOM inchangé.
- **Fournisseur agnostique** : la logique ne dépend jamais d'une PDP concrète ; le
  sandbox sert de double de test et de référence pour un futur adaptateur réel.

Voir aussi `ELECTRONIC_INVOICING_COMPLIANCE_MATRIX.md`,
`ELECTRONIC_INVOICING_PROVIDER.md`, `ELECTRONIC_INVOICING_LIMITATIONS.md`, et
`docs/ACQUISITION_READINESS_AUDIT.md`.
