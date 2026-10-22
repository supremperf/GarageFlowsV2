# Inventaire des licences — GarageFlows, revalidation du 22 octobre 2026

Périmètre : arbre npm **installé dans cet environnement Linux**, fermeture de production mesurée par `npm ls --omit=dev --all --json --long`, métadonnées issues de `npm sbom --include=dev --include=optional --sbom-format cyclonedx --sbom-type application`, puis filtrage reproductible par `scripts/gen-production-sbom.mjs`. Ce n’est ni l’inventaire du futur binaire Windows ni un avis juridique.

## Arbre npm courant : 133 composants de production

| Expression de licence SBOM | Nombre |
|---|---:|
| MIT | 95 |
| Apache-2.0 | 15 |
| ISC | 13 |
| LGPL-3.0-or-later | 2 |
| Apache-2.0 AND LGPL-3.0-or-later AND MIT | 1 |
| CC-BY-4.0 | 1 |
| (MPL-2.0 OR Apache-2.0) | 1 |
| MIT-0 | 1 |
| (MIT AND Zlib) | 1 |
| BSD-3-Clause | 1 |
| 0BSD | 1 |
| Métadonnée absente | 1 |

`rgbcolor@1.0.1` ne fournit pas d’expression SPDX prise en charge par npm SBOM, mais son `LICENSE.md` propose explicitement MIT. La métadonnée absente n’est pas remplacée par une licence inventée dans la SBOM.

## Corrections MASTER 4

- Les **35 paquets `devOptional`** omis par `npm sbom --omit=dev` sont réintégrés à partir des métadonnages npm complets, sans saisie manuelle de nom, version ou licence.
- Les chemins physiques de `npm ls --long` empêchent d’attribuer le texte d’une autre version ; les chemins ambigus, identités divergentes et graphes incomplets sont refusés.
- Les trois anciens « extras » (`@emnapi/runtime`, `@img/sharp-wasm32`, `@next/swc-linux-x64-musl`) sont confirmés dans la fermeture de production ; `license-checker` omet les deux premiers et n’est pas utilisé seul comme source de vérité.
- `next`, `@next/env` et les SWC installés sont en 15.5.28 ; les anciennes notices 15.5.27 sont remplacées.
- Cinq textes sont complétés avec provenance : sections `Licensing` des deux libvips et `next@15.5.28/license.md` pour les trois paquets Next de même dépôt/version/licence.
- **Avertissements ouverts :** `client-only@0.0.1` et `next-auth@4.24.15` déclarent respectivement MIT et ISC, mais aucun texte de licence local complet n’a été trouvé. Aucun copyright ou texte n’est inventé.

Commandes : `npm run sbom:generate`, `npm run sbom:verify`, `npm run test:sbom` — 11/11 tests et vérification 133/133 vertes dans MASTER 4.

## Copyleft et distribution — point ouvert

L’inventaire comprend deux variantes Linux de `sharp-libvips` en LGPL-3.0-or-later, `@img/sharp-wasm32` avec une expression Apache-2.0 AND LGPL-3.0-or-later AND MIT, `caniuse-lite` en CC-BY-4.0 et `dompurify` avec le choix MPL-2.0 OR Apache-2.0. Les README libvips énumèrent aussi les licences de leurs bibliothèques tierces.

Avant distribution, inventorier les composants **du binaire final** (Electron, Chromium, codecs, bibliothèques natives/WASM et moteurs Prisma), conserver les avis/textes obligatoires et faire déterminer les obligations de source/relinking et d’attribution par le responsable juridique. La présence dans cet arbre Linux ne prouve ni l’inclusion ni le chargement dans chaque cible.

Sources : `docs/sbom/sbom-garageflowsv2.cdx.json`, `THIRD_PARTY_NOTICES.md`, paquets installés et preuves `MASTER4_EVIDENCE/logs/09` à `17`. La conformité de l’artefact Windows reste bloquée tant que cet artefact n’existe pas.
