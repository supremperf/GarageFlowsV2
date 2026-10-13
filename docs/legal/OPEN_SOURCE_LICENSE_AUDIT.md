# Audit des licences open source — classification OK / REVIEW / BLOCKER

Source de données : SBOM CycloneDX générés depuis les lockfiles
(`docs/sbom/*.cdx.json` — 106 composants de production V2, 51 site3) et
l'inventaire détaillé `docs/sbom/LICENSE_INVENTORY.md` (comptages par licence).
Attributions : `THIRD_PARTY_NOTICES.md` (générées). Audit du 2026-08-07.

## 1. Classification

| Classe | Contenu | Verdict |
|---|---|---|
| **OK** | MIT (majorité), ISC, Apache-2.0, BSD-2/3-Clause, 0BSD, MIT-0, Zlib, CC0, Unlicense, Python-2.0 (argparse), BlueOak | permissives — obligation d'attribution satisfaite par `THIRD_PARTY_NOTICES.md` |
| **REVIEW** | **LGPL-3.0-or-later : `sharp`** (liaison dynamique libvips) | usage inchangé conforme (liaison dynamique, pas de modification) — documenté dans `LICENSE_INVENTORY.md` ; à faire confirmer par le conseil PI lors de la cession |
| **BLOCKER** | — | **aucun** : 0 GPL, 0 AGPL, 0 SSPL, 0 Commons Clause, 0 dépendance sans licence détectée dans les dépendances de PRODUCTION |

Vérification adverse : recherche explicite GPL/AGPL/SSPL/Commons dans les deux
SBOM → 0 correspondance en production (les paquets `dev` restent hors
distribution).

## 2. Actifs non-npm

| Actif | Origine | Statut |
|---|---|---|
| Icônes/logo GarageFlows | générés pour le produit (`npm run icons`) | propriété produit — cession à formaliser (conseil) |
| Polices | système / next/font (licences OFL le cas échéant, embarquées par Next) | OK |
| Images vitrine | à inventorier côté site3 avant cession | REVIEW (opérateur) |
| Extraits de code tiers | aucun bloc copié identifié portant licence contraire ; provenance globale documentée (`docs/PROVENANCE.md`) | OK / attestation vendeur requise |

## 3. Checklist d'attestation (à faire signer côté cédant — hors code)

- [ ] Tous les contributeurs (salariés/prestataires/indépendants) ont cédé
      leurs droits par écrit (le dépôt trace un développement assisté par IA —
      `docs/PROVENANCE.md`).
- [ ] Aucune inclusion de code sous licence incompatible non déclarée.
- [ ] Droits sur le nom/logo « GarageFlows », les domaines, les comptes SaaS,
      les certificats et les comptes de stores transférés (voir
      `docs/audit/DATA_ROOM.md §5`).

## 4. Reproduction

```bash
npm sbom --sbom-format cyclonedx --omit dev   # régénérer le SBOM
node scripts/gen-third-party-notices.mjs # régénérer les notices
```
