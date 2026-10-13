# Inventaire des licences open source — data room PI

> Synthèse générée à partir des SBOM CycloneDX (dépendances de PRODUCTION) des
> deux dépôts. Objet : due diligence de propriété intellectuelle — s'assurer
> qu'aucune licence copyleft forte (GPL/AGPL) n'impose d'obligation de
> divulgation du code propriétaire, et que les notices d'attribution requises
> sont reproduites.
>
> Sources : `docs/sbom/sbom-garageflowsv2.cdx.json`,
> `docs/sbom/sbom-garagesite3.cdx.json`. Notices : `THIRD_PARTY_NOTICES.md`
> (chaque dépôt). Régénérable : `npm sbom --sbom-format cyclonedx --omit dev`
> puis `node scripts/gen-third-party-notices.mjs`.

## GarageFlowsV2 (application) — 106 composants de production

| Licence | Composants | Nature |
|---|---|---|
| MIT | 82 (+3 déclarés « legacy », résolus MIT : busboy, rgbcolor, streamsearch) | permissive |
| Apache-2.0 | 9 | permissive (clause de brevet) |
| ISC | 9 | permissive |
| MPL-2.0 OR Apache-2.0 | 1 | permissive (choix) |
| MIT-0 | 1 | permissive (sans attribution) |
| MIT AND Zlib | 1 | permissive |

**Aucune licence copyleft (GPL/LGPL/AGPL/SSPL) dans l'application.** Le produit
étant distribué en binaire Electron, l'obligation restante est la **reproduction
des notices** (MIT/Apache/ISC) — satisfaite par `THIRD_PARTY_NOTICES.md` (à
embarquer dans l'installeur, cf. `electron/license.html`).

## garagesite3 (vitrine + control-plane) — 51 composants de production

| Licence | Composants | Nature |
|---|---|---|
| MIT | 36 | permissive |
| Apache-2.0 | 11 | permissive |
| **LGPL-3.0-or-later** | **2** (`@img/sharp-libvips-linux-x64`, `@img/sharp-libvips-linuxmusl-x64`) | **copyleft faible** |
| MIT-0 | 1 | permissive |
| ISC | 1 | permissive |

### Point d'attention : LGPL-3.0 (sharp / libvips)

Les deux composants LGPL sont la bibliothèque native **libvips** utilisée par
`sharp` (traitement d'images). Analyse :

- **Usage serveur uniquement** (Vercel), en **liaison dynamique** — la LGPL
  n'impose PAS de divulguer le code propriétaire de la vitrine : l'obligation
  copyleft de la LGPL porte sur la bibliothèque elle-même et sur la possibilité,
  pour un destinataire d'un binaire *lié*, de la remplacer. Un service web
  n'étant pas « distribué » au sens de la LGPL, le risque est **faible**.
- **Obligations à respecter tout de même** : mention de l'usage de libvips (LGPL)
  et de sa version, et — si un jour un binaire liant sharp était distribué —
  fournir le moyen de relier une version modifiée de libvips.
- **Alternative de dérisquage** (optionnelle) : `sharp` sans binaire libvips
  pré-compilé, ou un service d'images tiers, si l'acquéreur exige zéro copyleft.

**Verdict PI** : aucune licence copyleft forte (GPL/AGPL/SSPL) détectée dans les
deux dépôts. Une seule catégorie (LGPL server-side, sharp/libvips) à mentionner
dans le dossier PI, à faible risque et documentée ici. Reproduction des notices
= obligation à satisfaire à la distribution.

## À faire (hors périmètre technique — conseil PI / éditeur)

- Décision de licence produit (CLUF/EULA) et cession de droits des contributeurs
  (voir `docs/PROVENANCE.md`, `LICENSE`).
- Embarquer `THIRD_PARTY_NOTICES.md` dans l'installeur distribué.
- Confirmer la position LGPL/libvips avec le conseil si l'acquéreur l'exige.
