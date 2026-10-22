---
doc-numbers: journal
---

# MASTER 3 — SBOM et notices du paquet Windows

**Verdict : BLOQUÉ — les inventaires source sont reproduits après le patch Next, mais le paquet Windows à réconcilier n’existe pas.**

## 1. Inventaires de l’arbre final

| Outil/commande | Code | Résultat | Preuve |
|---|---:|---|---|
| `license-checker@25.0.1 --production --json` | 0 | 131 entrées racine comprise ; 130 noms tiers uniques | `39-sbom-after-next-patch.txt`, `licenses-production-final.json` |
| `npm@11.16.0 sbom --omit=dev --sbom-format cyclonedx` | 0 | 97 composants dans l’arbre Linux courant | `39-sbom-after-next-patch.txt`, `sbom-final-linux.cdx.json` |
| Notice existante | — | 98 noms dans la table d’inventaire | `THIRD_PARTY_NOTICES.md` |
| Réconciliation exacte par noms et versions | 0 pour l’outil de mesure ; phase bloquée | 35 absents, 3 extras, 3 divergences de version | `sbom-reconciliation-final.json` |

L’inventaire initial antérieur au patch de sécurité reste conservé dans `24-sbom-inventory.txt` : 132 entrées, 131 noms, 96 composants, 35 absents et 2 extras. Les chiffres du présent rapport final sont ceux de l’arbre **Next 15.5.28**.

## 2. Delta exact de l’arbre final

- **35 noms installés absents de la notice** ; leurs 35 fichiers de licence sont présents localement. La liste exhaustive figure dans `39-sbom-after-next-patch.txt` et `sbom-reconciliation-final.json`.
- **3 entrées supplémentaires** par rapport à l’arbre courant : `@emnapi/runtime`, `@img/sharp-wasm32` et `@next/swc-linux-x64-musl`.
- **3 versions à réconcilier** : la notice déclare `@next/env`, `@next/swc-linux-x64-gnu` et `next` en 15.5.27, alors que l’arbre installé est en 15.5.28.

Le contrôle exact distingue les deux sens du delta et les versions ; il ne se limite pas au décompte net/heuristique de 33 consigné dans MASTER 2. Il ne prouve pas quels composants seront présents dans le paquet Windows.

## 3. Décision de non-régénération

La notice n’a pas été régénérée depuis l’arbre Linux : cela pourrait ajouter des composants absents de Windows, omettre les binaires Windows et créer une fausse apparence de conformité. La disponibilité des 35 textes est une donnée de préparation, pas une réconciliation finale. Le correctif Next est nécessaire pour la sécurité, mais il rend aussi la mise à jour de la notice cible indispensable lors du vrai packaging.

## 4. Clôture requise

1. Produire le vrai `win-unpacked` et `GarageFlows-Setup.exe`.
2. Extraire la nomenclature réellement distribuée, y compris binaires natifs, Electron et moteurs Prisma.
3. Associer nom, version, licence et texte à chaque composant de cette cible.
4. Réconcilier paquet ↔ SBOM ↔ notices sans réduire le périmètre, puis faire relire les obligations LGPL/CC-BY.
5. Archiver les inventaires et empreintes du fichier Windows exact.

Aucune conformité de licence du paquet Windows n’est revendiquée.
