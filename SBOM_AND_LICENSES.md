---
doc-numbers: journal
---

# SBOM et licences tierces — MASTER 2

**Verdict : BLOQUÉ — inventaires source reproduits, réconciliation avec le paquet Windows impossible sans artefact.**

## 1. Mesures actuelles

Commandes réussies : `license-checker` **25.0.1** `--production --json` via `npx` et npm **11.16.0** `sbom --omit=dev --sbom-format cyclonedx`.

| Mesure | Résultat |
|---|---:|
| entrées license-checker, racine comprise | 132 |
| noms tiers uniques, racine `garageflow` exclue | 131 |
| composants CycloneDX depuis l’arbre courant | 96 |
| composants déclarés par la notice existante | 98 |
| noms tiers non retrouvés dans la notice par correspondance directe | 33 |

Répartition des 132 entrées : 94 MIT, 15 Apache-2.0, 13 ISC, 2 LGPL-3.0-or-later, 1 CC-BY-4.0, 1 MPL-2.0/Apache-2.0, 1 UNLICENSED (racine), et autres licences permissives. Les deux LGPL sont les variantes Linux de `sharp-libvips` ; CC-BY concerne `caniuse-lite`.

## 2. Pourquoi la notice n’est pas régénérée

La SBOM npm omet notamment des dépendances optionnelles/natives visibles dans l’inventaire installé. Régénérer aveuglément depuis ses 96 composants réduirait la couverture et ne prouverait pas le contenu Windows. Les 33 noms non appariés incluent notamment Sharp/libvips, Playwright, caniuse-lite, postcss et undici-types.

L’inventaire Linux n’est pas la nomenclature du futur paquet Windows : les moteurs Prisma, binaires Electron et dépendances optionnelles de la cible peuvent différer.

## 3. Travail de clôture obligatoire

1. Produire le vrai `win-unpacked` et `GarageFlows-Setup.exe`.
2. Extraire la liste réelle des paquets/binaires distribués, y compris contenu unpack et natif.
3. Associer nom, version, licence et texte d’attribution à chaque composant.
4. Réconcilier paquet ↔ SBOM ↔ `THIRD_PARTY_NOTICES.md`, sans diminuer le périmètre.
5. Faire relire les obligations LGPL/CC-BY et les textes effectifs de la cible.
6. Archiver les trois inventaires, leurs empreintes et la revue humaine.

Aucune notice n’a été régénérée et aucune conformité de l’artefact n’est revendiquée. Preuves : `27-license-sbom-inventory.txt` conserve les erreurs d’invocation de l’opérateur ; `28-license-sbom-corrected.txt` et `32-sbom-notice-delta.txt` contiennent les mesures corrigées.
