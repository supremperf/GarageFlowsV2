---
doc-numbers: journal
---

# MASTER 4 — SBOM et notices tierces

**Date : 22 octobre 2026 (Europe/Paris).**  
**Statut global : BLOCKED pour la distribution — source Linux corrigée, artefact Windows absent et deux textes de licence incomplets.**

## 1. Cause et correction

`npm sbom --omit=dev` omet 35 paquets `devOptional` qui figurent pourtant dans `npm ls --omit=dev`. Le générateur ajouté interroge npm pour les métadonnées complètes, puis filtre sur la fermeture de production `npm ls --long`. Il conserve les licences/npm hashes, ajoute les chemins physiques exacts et émonde le graphe CycloneDX. Il refuse les identités manquantes, chemins multiples, versions divergentes et graphes incomplets.

Fichiers : `scripts/gen-production-sbom.mjs`, `scripts/lib/production-sbom.mjs`, tests `tests/production-sbom.test.cjs` et `tests/notices-completeness.test.cjs`, commandes `sbom:generate`, `sbom:verify`, `test:sbom`.

## 2. Contrôles

| Contrôle | Commande/preuve | Résultat | Statut |
|---|---|---|---|
| Ancien défaut reproduit | `logs/09-sbom-production-reconciliation.txt`, `logs/11-pinned-npm-sbom.txt` | 133 production, 98 SBOM, 35 omissions ; npm 10.9.8 et 11.16.0 identiques | FAIL initial démontré |
| Métadonnées complètes | `logs/12-full-sbom-filter-feasibility.txt` | 734 composants sources ; 133/133 production couverts | PASS |
| Tests du correctif | `npm run test:sbom` | 11/11, aucun skip | PASS — `logs/35-final-license-and-node-regression.txt` |
| Génération | `npm run sbom:generate` | 133 composants et 133 notices | PASS — `logs/14-sbom-path-reconciliation-and-generation.txt` |
| Revérification | `npm run sbom:verify` | Identités installées, chemins, graphe et notices concordent | PASS — `logs/35-final-license-and-node-regression.txt` |
| 35 absents | `sbom-final-reconciliation.json` | 35/35 présents, aucun restant | PASS |
| 3 anciens extras | Même preuve | Tous confirmés production ; c’étaient des omissions de `license-checker`, pas des paquets à supprimer | PASS |
| 3 versions Next | Même preuve | `next`, `@next/env`, SWC GNU en 15.5.28 | PASS |
| Textes avec provenance | `logs/17-notices-final-pass.txt` | Deux README libvips + trois paquets Next sourcés depuis `next@15.5.28/license.md` | PASS |
| Textes encore absents | Même preuve | `client-only@0.0.1` MIT déclaré et `next-auth@4.24.15` ISC déclaré, sans texte local complet | FAIL |
| Inventaire Windows | `logs/08-windows-nsis-attempt.txt` | Aucun paquet à extraire/comparer | NOT RUN / BLOCKED |

## 3. Revue des licences

Répartition : 95 MIT, 15 Apache-2.0, 13 ISC, 2 LGPL-3.0-or-later, 1 Apache-2.0 AND LGPL-3.0-or-later AND MIT, 1 CC-BY-4.0, 1 MPL-2.0 OR Apache-2.0, 1 MIT-0, 1 MIT AND Zlib, 1 BSD-3-Clause, 1 0BSD et 1 métadonnée absente.

Les deux libvips Linux, sharp-wasm32, caniuse-lite et dompurify exigent une revue de distribution. Les obligations LGPL/CC-BY et les notices du contenu réellement embarqué ne sont **pas déclarées conformes** sans binaire et revue appropriée. `rgbcolor` reste sans expression SPDX dans la SBOM malgré son texte MIT local ; aucune métadonnée n’est inventée.

Action restante : obtenir les textes amont exacts des deux paquets encore incomplets, produire le paquet Windows, inventorier Electron/Chromium/codecs/moteurs et notices embarqués, puis réconcilier artefact ↔ SBOM ↔ notices et faire revoir les obligations applicables.
