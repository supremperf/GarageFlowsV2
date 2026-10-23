---
doc-numbers: journal
---

# RELEASE — rapport MASTER 6

**Verdict : artefact produit, vérifié et rattachable à un commit exact.** Une seule réserve : il n'est **pas signé**.

---

## 1. L'artefact de livraison

| Propriété | Valeur |
|---|---|
| chemin | `release/GarageFlows-Setup.exe` (copie unique de livraison) |
| nom | `GarageFlows-Setup.exe` — contrat de livraison en un seul fichier |
| version | **1.1.0** (source : `package.json`) |
| taille | **251 220 180 octets — 239,6 Mo** |
| date de production | 2026-10-23 14:36:50 (heure locale du poste de build) |
| **SHA-256** | **`a9c9f46a6e46a32ee652855f6eb892359c8f41d04fd70bcda51019f0d0d8e01d`** |
| commit de build | **`e735ba8541ab76703406f271156517396705a2ec`** |
| branche de build | `master6-integration` |
| **`buildId`** | **`1.1.0+e735ba854`** — **sans** suffixe `.dirty` |
| arbre au build | **propre avant ET après**, relevé dans le journal |
| plateforme / architecture | win32 / x64 |
| en-tête de fichier | **`MZ`** — exécutable Windows |
| fichiers de charge utile NSIS | **3 073**, charge vérifiée |
| mode d'extraction | `embedded-7z-sfx`, charge hors-ligne embarquée |
| `authenticodeVerified` | **false** |
| cible NSIS | `oneClick: false`, `perMachine: false`, `allowElevation: false`, `asInvoker` |

Reçu de livraison complet (`WINDOWS_DELIVERY_RECEIPT`) dans `MASTER6_EVIDENCE/logs/22-windows-dist-livraison.txt`.

## 2. Un `buildId` rattachable, obtenu proprement

`scripts/generate-release-manifest.mjs` dérive son indicateur `dirty` de `git status --porcelain`, qui compte **aussi les fichiers non suivis**. Le premier build MASTER 6 portait donc `.dirty` — à juste titre : j'écrivais un journal de preuves dans le dépôt pendant son exécution.

Le build de livraison a été lancé avec son journal **hors du dépôt** et sans aucune écriture concurrente. L'état de l'arbre est relevé avant et après :

```
arbre avant build: PROPRE
commit: e735ba8541ab76703406f271156517396705a2ec
✅ release-manifest.json généré : 1.1.0+e735ba854
arbre apres build: PROPRE
```

**Note de traçabilité honnête** : le commit publié sur `main` est **postérieur** à `e735ba854`, puisqu'il contient ce rapport et les documents de publication — un rapport qui décrit un build ne peut pas être inclus dans ce build. Le code source, lui, est identique : les commits postérieurs n'ajoutent que de la documentation et des preuves. La correspondance exacte est établie dans `MASTER6_GITHUB_PUBLICATION.md`.

## 3. Chaîne de build exécutée

```
npm run dist
  → npm run preflight:release          ✅ Node 22.23.2 — win32/x64 ; Windows x64 (NSIS) ;
                                          installeur utilisateur, sans droits administrateur ; 1.1.0
  → GF_PACKAGE_DESKTOP=1 npm run build ✅ prisma generate ×2 + next build + post-build
  → npm run verify:standalone          ✅ sortie autonome complète
  → electron-builder --win --x64       ✅ @electron/rebuild, Electron 44.9.3, NSIS
  → npm run check:artifact-secrets     ✅
  → npm run check:artifact-fuses       ✅
  → npm run verify:installer           ✅
EXIT=0
```

### Clé publique de licence — matérialisée, jamais inventée

`preflight:release` reconstruit `keys/public.pem` **depuis les ancrages présents dans les sources** et vérifie son empreinte contre `REFERENCE_FP` : **`b16d2e1bf6b9662f…`**, l'autorité de production. Aucune paire générée, `keys:sync` jamais exécuté. C'est une ressource **publique**, sûre à distribuer, et c'est elle qui permet au poste de vérifier les signatures hors ligne.

## 4. Contrôles de sécurité de l'artefact

| Contrôle | Résultat |
|---|---|
| `check:artifact-secrets` | **aucune clé privée, aucune valeur de secret** |
| `check:artifact-fuses` | **9/9 fusibles conformes** — `RunAsNode=false`, `EnableCookieEncryption=true`, `EnableNodeOptionsEnvironmentVariable=false`, `EnableNodeCliInspectArguments=false`, `EnableEmbeddedAsarIntegrityValidation=true`, `OnlyLoadAppFromAsar=true`, `LoadBrowserProcessSpecificV8Snapshot=false`, `GrantFileProtocolExtraPrivileges=true`, `WasmTrapHandlers=true` |
| manifeste d'intégrité | **540 fichiers critiques** signés → `integrity.manifest.json` |
| `verify:installer` | **OK** — taille, version, type d'exécutable, charge utile vérifiée |
| `post-build.js` | `.env` retiré du paquet ; **0 clé privée** dans `standalone` |
| **signature Authenticode** | **`NotSigned`** |

## 5. Portes de validation passées avant ce build

| Porte | Résultat |
|---|---|
| `release:gate` | **16 / 16**, code 0 |
| TypeScript | 0 erreur |
| ESLint | 0 |
| `check:consistency` | OK |
| `test:release-safety` | 190 / 0 / 3 |
| Vitest | 4 390 / 0 / 34 |
| Playwright authentifié | 135 / 0 / 9 |
| budget de performance | 3,49 Mio pour 3,65 Mio |

## 6. Ce qui n'est pas prouvé par ce rapport

- **La signature** : absente, aucun certificat disponible. SmartScreen avertira chaque client.
- **L'installation réelle** : l'installeur NSIS n'a pas été exécuté — voir `MASTER6_WINDOWS_INSTALL_REPORT.md §2`.
- **La signature du manifeste de mise à jour** : `release:sign` attend une URL HTTPS publique de distribution, non fournie.

## 7. Historique des builds de cette mission

Toutes les empreintes sont conservées, aucune n'est dissimulée :

| Build | Commit | `dirty` | SHA-256 | Statut |
|---|---|---|---|---|
| MASTER 5 — livraison | `d96835570` | false | `5bb005c8…99f3a` | artefact MASTER 5 |
| MASTER 6 — intermédiaire | `9b667ef69` | true | `0eb7abc6…2876` | journal écrit pendant le build |
| **MASTER 6 — livraison** | **`e735ba854`** | **false** | **`a9c9f46a…e01d`** | **artefact livré** |

Le contenu de ces builds est équivalent au niveau du code source ; seuls la documentation versionnée et l'identité de build diffèrent.
