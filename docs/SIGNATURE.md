# Module Premium — Signature électronique renforcée

Signature électronique **scellée par un sceau d'intégrité cryptographique**
(HMAC-SHA256 avec clé d'installation) : toute modification du document **après**
signature invalide le sceau de façon détectable.

> **Qualification honnête (AUD-043)** : ce mécanisme est un **sceau d'intégrité
> local** (HMAC symétrique), PAS une signature électronique qualifiée au sens
> eIDAS ni un dispositif à clé asymétrique horodaté par un tiers de confiance. Il
> détecte toute altération post-signature ; il ne confère pas à lui seul une
> valeur probante « qualifiée ». Le terme « inviolable » est **interdit** dans la
> documentation active : aucune protection logicielle locale ne l'est.

## Principe

Une signature scelle un **instantané canonique** du document (les champs qui ne
doivent pas changer), l'**image** de la signature et des **métadonnées de preuve**
(signataire, horodatage, IP, user-agent) :

1. **Empreinte de contenu** = SHA-256 de la sérialisation canonique du document.
2. **Empreinte d'image** = SHA-256 des octets de l'image de signature.
3. **Sceau d'intégrité** = HMAC-SHA256(clé_installation, empreintes + métadonnées).

À la vérification, on recalcule l'empreinte de contenu depuis l'**état actuel** du
document :
- si elle diffère de l'empreinte scellée → `document_modified` (auto-invalidation) ;
- si le sceau ne se recalcule pas → `seal_tampered` (l'enregistrement a été altéré).

La clé HMAC est **propre à l'installation** (dérivée du secret de session
fail-closed, ou `GF_SIGNATURE_SECRET` dédié) — jamais une constante committée.

## Architecture

```
src/lib/signature/
├── types.ts         # SignatureCertificate, VerificationResult, SignableEntityType
├── canonicalize.ts  # sérialisation déterministe (tri des clés, normalisation)
├── seal.ts          # sha256, computeSeal, createCertificate, verifyCertificate (purs)
├── document.ts      # buildSignableDocument(type, entity) — whitelist des champs
├── key.ts           # resolveSignatureKey() — clé HMAC par-installation (fail-closed)
└── index.ts
```

Les fonctions de `seal.ts` sont **pures** (la clé est passée en paramètre) → 100 %
testables et déterministes. Comparaisons en temps constant (`timingSafeEqual`).

## Documents supportés

`quote` (devis), `invoice` (facture), `work_order` (ordre de réparation) — via
leurs modèles Prisma. `contract` et `handover` (bon de restitution) sont prévus
dans le type et le modèle, à activer dès que leurs entités existent.

Le **whitelist** (`buildSignableDocument`) ne scelle que les champs significatifs
(numéro, client, véhicule, lignes, taux, totaux, dates) : un changement de
`updatedAt`/`status` n'invalide pas la signature, un changement de montant/ligne oui.

## API

- `POST /api/signatures` `{ entityType, entityId, signatureData, signerName, signerRole? }`
  → authentifié, rate-limité (20/min/garage), vérifie la propriété du document,
  scelle et stocke ; renvoie `{ id, algorithm, contentHash, seal, signedAt, valid }`.
  IP et user-agent capturés côté serveur.
- `GET /api/signatures?entityType=&entityId=` → dernière signature + **vérification
  en direct** contre l'état actuel : `{ signed, signature, verification: { valid, reasons } }`.

## Persistance / migration

Ajoute le modèle Prisma **`Signature`** (+ relation `Garage.signatures`, index
`[garageId, entityType, entityId]`). Appliquer via `npm run db:push` avant prod.

## Tests

`src/lib/signature/__tests__/signature.test.ts` — 11 tests : canonisation stable
(indépendance de l'ordre des clés, dates), empreinte d'image (data URL == base64),
aller-retour certificat, **auto-invalidation sur modification**, détection de sceau
altéré, échec sous mauvaise clé, whitelist (champ non scellé ignoré / champ scellé
détecté).

## À venir (hors périmètre de ce commit)
- Génération du **PDF signé** (empreinte + certificat en pied de page).
- Branchement des captures tactile/souris/stylet côté renderer (déjà supportées
  par le champ `signatureData` base64).
