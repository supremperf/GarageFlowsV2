# Inventaire des licences — GarageFlows, revalidation du 17 octobre 2026

Périmètre : arbre npm **installé dans cet environnement Linux**, SBOM de production
régénérée par `npm sbom --omit=dev --sbom-format cyclonedx` puis
`node scripts/gen-third-party-notices.mjs`. Ce n’est pas une attestation des fichiers
réellement distribués dans chaque installateur ni un avis juridique. Le second
produit garagesite3 n’est pas présent dans ce dépôt et n’est pas audité ici.

## Arbre npm courant : 98 composants

| Expression de licence SBOM | Nombre |
|---|---|
| MIT | 77 |
| Apache-2.0 AND LGPL-3.0-or-later AND MIT | 1 |
| Apache-2.0 | 8 |
| (MPL-2.0 OR Apache-2.0) | 1 |
| ISC | 8 |
| MIT-0 | 1 |
| (MIT AND Zlib) | 1 |
| Métadonnée absente | 1 |

`rgbcolor@1.0.1` ne fournit pas une expression SPDX prise en charge par npm SBOM,
mais son `LICENSE.md` propose explicitement MIT (texte intégral dans les notices).
La métadonnée absente n’est pas comblée par une licence inventée dans la SBOM.

## Copyleft et distribution — point ouvert, pas affirmation d’absence

La SBOM courante inclut **@img/sharp-wasm32@0.35.5** avec l’expression
`Apache-2.0 AND LGPL-3.0-or-later AND MIT`. L’arbre complet (outillage inclus)
contient aussi `@img/sharp-libvips-linux-x64` et `linuxmusl-x64`, annoncés
LGPL-3.0-or-later. L’ancienne affirmation d’absence de copyleft était périmée et
est retirée. Une présence dans l’arbre npm n’atteste pas que le composant est
chargé ou distribué dans chaque cible.

Avant distribution, inventorier les composants **du binaire final** (Electron,
Chromium, codecs, bibliothèques natives Sharp/libvips et WASM compris), conserver
les avis/textes obligatoires et déterminer les obligations de source/relinking
applicables aux bibliothèques LGPL. La licence du paquet racine n’est pas à elle
seule la liste des licences de ses bibliothèques embarquées. Faire valider le
mode de distribution et les obligations par le propriétaire juridique ; aucun
retrait aveugle d’une dépendance ni conclusion de violation en production n’est
déduit de cet inventaire local.

## Corrections techniques de génération

- Notices régénérées depuis les versions installées/verrouillées courantes.
- Plus aucune troncature des textes à 8 000 caractères (Apache Prisma dépasse 11 000).
- Le chemin `cdx:npm:package:path` distingue les versions imbriquées ; nom/version
  sont vérifiés contre le package installé et un chemin hors node_modules est refusé.
- Tests : `tests/notices-completeness.test.cjs` (texte long complet, version
  imbriquée, erreur de version, refus d’un chemin extérieur).
- Les notices sont un **artefact de documentation source**, pas une preuve que
  l’installateur les embarque. Recette et inventaire d’artefact toujours ouverts.

Sources locales : `docs/sbom/sbom-garageflowsv2.cdx.json`, `THIRD_PARTY_NOTICES.md`,
les LICENSE et package.json installés. Détails de validation :
`docs/audit/2026-10-17/05-RESOLUTION-BLOCAGES.md` et `phase6/03-GRILLE-A-K.md`.
