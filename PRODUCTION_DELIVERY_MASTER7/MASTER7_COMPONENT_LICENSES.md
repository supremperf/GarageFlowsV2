---
doc-numbers: journal
---

# LICENCES DES COMPOSANTS REDISTRIBUÉS — MASTER 7

Preuve : `MASTER7_EVIDENCE/logs/06-licences-composants.txt`. **Aucune licence ni autorisation de redistribution n'est inventée.**

---

## 1. Méthode, et deux affirmations écartées

Chaque composant a été vérifié, puis sa fiche soumise à un **contrôle indépendant chargé de la contester**. 5 fiches sur 6 ont été contestées — à juste titre pour l'essentiel. Mais deux affirmations des contrôles étaient **elles-mêmes fausses**, et je les ai écartées après vérification directe :

| Affirmation du contrôle | Réalité mesurée |
|---|---|
| « aucun document de notices n'est expédié » | **FAUX** — `THIRD_PARTY_NOTICES.md` est livré à la racine de `app.asar`, 350 Ko, 133 sections |
| « les paquets ne portent aucune licence, donc rien n'est attribué » | **incomplet** — `app.asar` contient **238** fichiers de licence |

Les chiffres ci-dessous sont les miens, mesurés sur `dist/win-unpacked`.

## 2. Le livrable contient deux charges de nature différente

| Charge | Licences présentes |
|---|---|
| `resources/app.asar` (+ `app.asar.unpacked`) — bundle Electron | **238 fichiers** LICENSE/NOTICE, **plus** `THIRD_PARTY_NOTICES.md` (133 sections) |
| `resources/standalone/` — sortie autonome de Next.js, copiée par `extraResources` | **24 paquets, 0 fichier de licence. Aucun.** |

**Le défaut porte sur la charge `standalone`, pas sur tout le livrable.** C'est la distinction que MASTER 6 n'avait pas faite.

## 3. État des 24 paquets de la charge standalone

```
sans texte de licence dans le livrable ....... 24 / 24
sans section dans les notices livrées ........  5 / 24
absents du SBOM Windows ......................  4 / 24
```

Les **19 autres sont couverts** par `THIRD_PARTY_NOTICES.md`, qui est livré : l'obligation d'attribution est satisfaite pour eux par cette voie.

## 4. Les composants réellement sans aucune attribution

Un composant est « attribué » s'il porte un texte de licence **quelque part** dans le livrable, **ou** s'il a une section dans les notices livrées.

| Paquet | Version | Licence | Licence dans l'asar | Section notice | Verdict |
|---|---|---|:---:|:---:|---|
| `@img/sharp-win32-x64` | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later | **OUI** | non | attribué |
| `source-map` | 0.6.1 | BSD-3-Clause | **OUI** | non | attribué |
| `@next/swc-win32-x64-msvc` | 15.5.28 | MIT | non | non | 🔴 **AUCUNE ATTRIBUTION** |
| `buffer-from` | 1.1.2 | MIT | non | non | 🔴 **AUCUNE ATTRIBUTION** |
| `source-map-support` | 0.5.21 | MIT | non | non | 🔴 **AUCUNE ATTRIBUTION** |
| `typescript` | 5.9.3 | Apache-2.0 | non | non | 🔴 **AUCUNE ATTRIBUTION** |

**Ce sont quatre composants, pas six.** Deux des six que MASTER 6 listait sont en réalité attribués, par un fichier de licence présent dans l'`asar` (`/node_modules/@img/sharp-win32-x64/LICENSE` et `/node_modules/next/dist/compiled/source-map/LICENSE`).

**Gravité relative.** `@next/swc-win32-x64-msvc` représente environ **148 Mo d'un installateur de 251 Mo** — la plus grosse charge expédiée — et part sans texte de licence ni section de notice. `typescript` expédie 9,1 Mo (`lib/typescript.js`) dans la même situation : sa copie livrée ne contient que deux fichiers, `lib/typescript.js` et `package.json`.

## 5. Les deux causes racines, mesurées

### 5.1 Les notices sont générées depuis le mauvais inventaire

`scripts/gen-third-party-notices.mjs` prend par défaut `docs/sbom/sbom-garageflowsv2.cdx.json` — l'inventaire du **serveur**. Les binaires propres à Windows n'y figurent pas, donc pas de section. Symétriquement, les notices livrées **attribuent des composants qui ne sont pas expédiés** sous Windows :

```
@img/sharp-linux-x64@0.35.5           notices=1   installé=0
@img/sharp-libvips-linux-x64@1.3.4    notices=2   installé=0
@img/sharp-linuxmusl-x64@0.35.5       notices=1   installé=0
```

### 5.2 La sortie autonome de Next expédie des dépendances de développement

Vérifié dans `package-lock.json` :

```
typescript           dev=true
buffer-from          dev=true
source-map           dev=true
source-map-support   dev=true
```

Aucun inventaire de **production** ne peut donc les contenir, alors que le traçage autonome de Next les embarque. **Le défaut est structurel, ce n'est pas un oubli de rédaction.**

## 6. Un blocage préalable, trouvé et réparé

En voulant vérifier le remède, j'ai découvert que le générateur de notices **ne pouvait plus s'exécuter du tout** :

```
$ node scripts/gen-third-party-notices.mjs --check
Error: Magasin de licences : empreinte invalide pour next-auth@4.24.15
```

Cause : les deux textes de licence amont verrouillés par SHA-256 avaient été convertis en CRLF à l'extraction — la même classe de défaut que celle corrigée en MASTER 6 pour les dossiers de preuves, mais `docs/licenses/upstream/` n'était pas protégé.

**Réparé** : `.gitattributes` déclare `docs/licenses/upstream/** -text`, et les deux fichiers sont rétablis dans leurs octets d'origine, chacun **vérifié contre le verrou SHA-256 que le projet avait lui-même enregistré** :

```
next-auth@4.24.15    807 → 791 octets   cf5c8f6c5d858d6b… = verrou OK
client-only@0.0.1   1087 → 1078 octets  b85dcd3e453d0598… = verrou OK

$ node scripts/gen-third-party-notices.mjs --check
[notices] 133 composants → THIRD_PARTY_NOTICES.md      code 0
```

Le verrou n'a pas été assoupli : **c'est lui qui atteste la restauration.**

## 7. Le remède, chiffré en deux parties

Essai mené vers un fichier temporaire, sans toucher au livrable :

```
node scripts/gen-third-party-notices.mjs \
     --sbom docs/sbom/sbom-garageflows-windows.cdx.json \
     --out <temporaire> --product "GarageFlows Windows"
[notices] 129 composants
```

| Composant | Notices livrées | Essai SBOM Windows |
|---|:---:|:---:|
| `@next/swc-win32-x64-msvc@15.5.28` | 0 | **1 ✅** |
| `@img/sharp-win32-x64@0.35.5` | 0 | **1 ✅** |
| `typescript@5.9.3` | 0 | 0 |
| `buffer-from@1.1.2` | 0 | 0 |
| `source-map-support@0.5.21` | 0 | 0 |

**Partie 1** — générer les notices Windows depuis l'inventaire **Windows**. Ferme **2 des 4** manques. Le script accepte déjà `--sbom`.

**Partie 2** — faire déclarer par l'inventaire Windows ce que le traçage autonome expédie réellement, **y compris les dépendances marquées `dev`**. Ferme les **3 derniers**.

**À ne pas faire** : régénérer `THIRD_PARTY_NOTICES.md` sur ce poste. Mesuré : la régénération y **retire 536 lignes** (6 insertions, 536 suppressions), parce que les paquets Linux n'y sont pas installés et que leur texte ne peut donc pas être lu. **Les notices doivent être produites par plateforme**, chacune sur l'arbre correspondant. Le fichier a été restauré à son état versionné après cette mesure.

## 8. Ce qui relève du conseil juridique, pas d'un script

**`@img/sharp-win32-x64@0.35.5`** déclare `Apache-2.0 AND LGPL-3.0-or-later`. Seul le texte Apache-2.0 est expédié ; la moitié LGPL n'est portée que par le `README.md`, **absent des copies livrées**. Par ailleurs la bibliothèque native liée statiquement embarque, d'après la documentation amont, du matériel sous **MPL-1.1** (cairo — qui impose une mise à disposition des sources), une **licence de brevet** (aom), et une dizaine d'autres régimes. Aucun inventaire du projet ne décrit ces sous-composants : `libvips 8.18.7`, la version réellement livrée, ne figure nulle part dans le SBOM Windows.

**`typescript`** embarque `ThirdPartyNoticeText.txt` (193 lignes) incorporant du matériel MIT, **Unicode Inc.**, **W3C** et **CC-BY-4.0** — un régime qui impose la mention des modifications. Ce fichier n'est présent dans aucun livrable.

Ces deux points demandent une **relecture juridique**, pas une correction de script. Je ne me prononce pas sur une autorisation de redistribution : les licences lues l'autorisent sous conditions, et les conditions constatées dans le livrable ne sont pas remplies à ce jour.
