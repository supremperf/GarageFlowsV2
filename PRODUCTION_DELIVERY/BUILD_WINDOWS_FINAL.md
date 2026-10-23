---
doc-numbers: journal
---

# BUILD WINDOWS ET GarageFlows-Setup.exe — état final MASTER 5

**Verdict : INSTALLATEUR PRODUIT ET VÉRIFIÉ.** Deux limites subsistent et sont nommées : **aucune signature Authenticode** (pas de certificat), et **aucun test d'installation/désinstallation** (ce poste héberge une installation et des données réelles).

## 1. État MASTER 4

`FAIL/BLOCKED` : `npm run dist:win` s'arrêtait code 1 avant Electron Builder ; aucun `GarageFlows-Setup.exe`, aucun `win-unpacked`, aucune métadonnée de release. L'hôte était Linux sans Wine : installation, lancement, persistance, migration, mise à jour, signature et désinstallation `NOT RUN`.

## 2. Chaîne complète exécutée

```
npm run dist
  → npm run preflight:release          ✅ Node 22.23.2 — win32/x64 ; cible Windows x64 (NSIS) ;
                                          installeur utilisateur, sans droits administrateur ; version 1.1.0
  → GF_PACKAGE_DESKTOP=1 npm run build ✅ prisma generate ×2 + next build + post-build
  → npm run verify:standalone          ✅ sortie autonome complète (4 éléments)
  → electron-builder --win --x64       ✅ @electron/rebuild, Electron 44.9.3, NSIS
  → npm run check:artifact-secrets     ✅
  → npm run check:artifact-fuses       ✅
  → npm run verify:installer           ✅
EXIT=0
```

Preuve de l'artefact LIVRÉ : `MASTER5_EVIDENCE/logs/44-windows-dist-livraison.txt`.
Les builds antérieurs restent dans les journaux 15, 24, 38 et 42.

### La clé publique de licence, matérialisée et non inventée

`preflight:release` appelle `materializePublicKey()` qui reconstruit `keys/public.pem` **depuis les ancrages présents dans les sources**, puis vérifie son empreinte contre `REFERENCE_FP`. Résultat : `b16d2e1bf6b9662f9748e009c0cf88770ab602233ee546895ac352f808bc3d9d`, soit l'autorité de production. Aucune paire n'a été générée, `keys:sync` n'a pas été exécuté. C'est une ressource **publique** : sûre à distribuer, et c'est elle qui permet au poste de vérifier les signatures hors ligne.

## 3. L'artefact

| Propriété | Valeur |
|---|---|
| chemin | `dist/GarageFlows-Setup.exe`, recopié seul dans `release/GarageFlows-Setup.exe` |
| nom | `GarageFlows-Setup.exe` (contrat de livraison en un seul fichier) |
| version | 1.1.0 (source : `package.json`) |
| taille | **251 179 425 octets — 239,5 Mo** |
| **SHA-256** | **`5bb005c89354ccecfe4493543f5d152a5a8c1875706188fb58cbb3b4c1499f3a`** |
| date de production | 2026-10-23 09:31:03 (heure locale du poste de build) |
| commit de build | **`d968355709425e311344f44bda3c0d5bc19aa6b1`** |
| `buildId` | **`1.1.0+d96835570`** — **sans** suffixe `.dirty` |
| arbre de travail au build | **propre** (`dirty: false`), vérifié avant ET après le build |
| plateforme / architecture | win32 / x64 |
| en-tête de fichier | `MZ` — exécutable Windows |
| fichiers de charge utile NSIS | **3 069**, charge vérifiée |
| mode d'extraction | `embedded-7z-sfx`, charge hors-ligne embarquée |
| `authenticodeVerified` | **false** |
| cible NSIS | `oneClick: false`, `perMachine: false`, `allowElevation: false`, `requestedExecutionLevel: asInvoker` |

Reçu de livraison complet (`WINDOWS_DELIVERY_RECEIPT`) conservé dans le journal 44, avec vérification indépendante de la taille, de l'empreinte et de l'en-tête PE.

### Le `buildId` sans `.dirty` : comment il a été obtenu

`scripts/generate-release-manifest.mjs` dérive son indicateur `dirty` de
`git status --porcelain`, qui compte **aussi les fichiers non suivis**. Trois
builds successifs ont donc porté le suffixe `.dirty` — à juste titre : chacun
avait été lancé en redirigeant son propre journal **dans** le dépôt, ou pendant
qu'un document y était écrit. Le quatrième build a été exécuté avec son journal
**hors** du dépôt et sans aucune écriture concurrente ; l'état de l'arbre a été
relevé avant et après :

```
arbre avant build : PROPRE
release-manifest.json généré : 1.1.0+d96835570
arbre apres build : PROPRE
```

L'artefact livré est donc rattachable à un commit exact. Les trois empreintes
intermédiaires restent dans les journaux 15, 24, 38 et 42 — elles ne sont pas
dissimulées, et aucune n'est présentée comme l'artefact de livraison.

## 4. Contenu de l'artefact

```
dist/win-unpacked/
  GarageFlows.exe                 246 840 832 octets
  LICENSE.electron.txt            1 096 octets
  LICENSES.chromium.html          20 477 229 octets
  ffmpeg.dll, icudtl.dat, resources.pak, snapshot_blob.bin, vk_swiftshader.dll, locales/ …
  resources/
    app.asar                      140 681 819 octets
    app.asar.unpacked/node_modules/  @img/sharp-win32-x64, @next/swc-win32-x64-msvc,
                                     @prisma/engines, prisma
    standalone/                   serveur Next.js autonome + node_modules tracés
    prisma/                       schema.prisma + modèle de base
    keys/                         public.pem (clé PUBLIQUE uniquement)
    integrity.manifest.json       108 663 octets
    icon.ico, elevate.exe
```

## 5. Contrôles de sécurité de l'artefact

### Secrets

```
🔎 check:artifact-secrets — valeur(s) secrète(s) traquée(s)
  ✓ dossier inspecté : win-unpacked (2 885 fichiers)
  ✓ installateur inspecté : GarageFlows-Setup.exe
✅ aucune clé privée, aucune valeur de secret dans l'artefact.
```

`scripts/post-build.js` confirme en amont : « secrets retirés du package : .env (jamais distribués) » et « aucune clé privée dans standalone (0 purgée(s)) ».

### Fusibles Electron

```
✅ 9 fusible(s) conformes au plan :
   RunAsNode=false
   EnableCookieEncryption=true
   EnableNodeOptionsEnvironmentVariable=false
   EnableNodeCliInspectArguments=false
   EnableEmbeddedAsarIntegrityValidation=true
   OnlyLoadAppFromAsar=true
   LoadBrowserProcessSpecificV8Snapshot=false
   GrantFileProtocolExtraPrivileges=true
   WasmTrapHandlers=true
```

### Manifeste d'intégrité

`540 fichiers critiques signés` → `integrity.manifest.json`, et la validation est **observée à l'exécution** dans le journal applicatif : `[integrity] OK — 540 fichiers critiques vérifiés | paquet: 2bc9e8cc7aeb`.

## 6. Démarrage RÉEL de l'application empaquetée

Deux démarrages successifs de `dist/win-unpacked/GarageFlows.exe` — l'arborescence exacte que NSIS recopie — avec **PATH réduit à `%SystemRoot%\System32;%SystemRoot%`** (ni Node, ni npm, ni Python disponibles) et un **répertoire courant vide**.

| Contrôle | Résultat |
|---|---|
| fenêtre ouverte, titre après stabilisation | **`GarageFlows — Activation`** |
| processus de l'application | 5 (principal + utilitaires Chromium) |
| arrêt sur fermeture de la fenêtre, 1er démarrage | **propre, 0 processus résiduel** |
| arrêt sur fermeture de la fenêtre, 2e démarrage | **propre, 0 processus résiduel** |
| base métier de l'utilisateur avant/après | **inchangée** — 1 241 088 octets, SHA-256 `7CAF2ADB…B76E4DCF` identique |

Journal applicatif réel :

```
userData: %APPDATA%\GarageFlow
IS_DEV: false
Platform: win32 x64
Secret local prêt (source: install)
Clé de chiffrement SMTP prête (source: install)
[integrity] OK — 540 fichiers critiques vérifiés | paquet: 2bc9e8cc7aeb
Existing database: %APPDATA%\GarageFlow\garageflow.db
Sauvegarde pré-migration OK: …\backups\pre-migration\garageflows-pre-migration-20261023-041108.db
No valid license — showing activation window
Activation cancelled — quitting
```

Ce journal prouve, sur le binaire réellement distribué : l'épinglage du userData, la validation d'intégrité ASAR, la disponibilité du secret d'installation et de la clé de chiffrement SMTP, la détection de la base existante, la **sauvegarde pré-migration automatique**, la porte de licence *fail-closed*, et l'arrêt propre.

Preuve : `MASTER5_EVIDENCE/logs/32-packaged-app-launch.txt`.

## 7. LIMITE 1 — aucune signature Authenticode

```powershell
PS> Get-AuthenticodeSignature dist\GarageFlows-Setup.exe
Status      : NotSigned
SignerCertificate : <aucun>
```

Idem pour `dist\win-unpacked\GarageFlows.exe`. Les lignes « signing with signtool.exe » du journal electron-builder correspondent à des **tentatives** : aucun certificat n'est configuré dans le bloc `build` de `package.json`, et aucun n'est présent sur ce poste. Le reçu de livraison l'enregistre honnêtement : `authenticodeVerified: false`.

Conséquence pour l'utilisateur final : SmartScreen affichera un avertissement « éditeur inconnu » à l'installation. Lever cette limite exige un **certificat de signature de code OV ou EV** (achat + validation d'identité, clé en HSM pour EV). Consigné dans `ACTIONS_MANUELLES_RESTANTES.md`.

## 8. LIMITE 2 — installation, désinstallation et mise à niveau non jouées

`scripts/test-windows-setup.ps1` est la procédure complète du projet. Elle **refuse de s'exécuter** hors d'un runner Windows jetable approuvé, et refuse également si un profil utilisateur existe déjà :

```powershell
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows' -or $env:GF_WINDOWS_SMOKE_ISOLATED -ne '1') {
  throw 'Refused: an explicitly approved disposable Windows CI runner is required.' }
if (Test-Path $UserData) {
  throw 'Refused: userData already exists; no existing profile may be modified by this test.' }
```

Ce poste réunit les deux motifs de refus :

| Constat | Mesure |
|---|---|
| installation existante | `%LOCALAPPDATA%\Programs\GarageFlows` + entrée de désinstallation HKCU « GarageFlows 1.1.0 » |
| profil de données réel | `%APPDATA%\GarageFlow` — **410 fichiers, 285 469 858 octets**, `garageflow.db` du 17/10/2026 |

Installer ici écraserait l'installation de l'utilisateur avec un build **non signé** issu d'un arbre modifié, et l'entrée de désinstallation étant partagée (même `appId` `com.garageflow.app`), son installation actuelle risquerait de ne plus se désinstaller proprement. **Refusé.**

Isolation du userData : impossible sur ce poste. `electron/user-data-path.js` épingle userData sur `app.getPath('appData') + '\GarageFlow'`, et Electron résout `appData` par le **dossier connu Windows**, pas par la variable `APPDATA` — rediriger `APPDATA` n'a eu aucun effet (mesuré : seuls des caches Chromium ont été créés dans le dossier jetable, et le profil réel a été utilisé). Seuls des artefacts d'exécution Chromium y ont changé (caches GPU/shader, `Session Storage`, `Preferences`, `garageflow.log`, `gf_clock.json`) ; la base métier est restée identique au bit près.

Restent donc **NON EXÉCUTÉS** : exécution de l'installeur NSIS, raccourcis bureau et menu Démarrer, entrée de désinstallation, mise à niveau d'une installation précédente, désinstallation avec conservation des données (`deleteAppDataOnUninstall: false` est une **configuration vérifiée**, pas une preuve de comportement), et parcours métier licencié sur poste vierge.

## 9. Réconciliation paquet ↔ SBOM ↔ notices

Clôture de la demande de MASTER 3/4 (`SBOM_WINDOWS_FINAL.md §4`). Un script dédié a été ajouté : `scripts/reconcile-windows-artifact-sbom.mjs`. Il lit l'artefact fichier par fichier, y compris le contenu de `app.asar` via `@electron/asar`.

```
composants déclarés (clôture Windows)          129
composants déclarés (clôture serveur Linux)    133
composants réellement empaquetés                35
sections de notice disponibles                 133
app.asar listé par @electron/asar              oui
textes de licence manquants dans les notices     0
texte Electron                                 présent (1 Ko)
texte Chromium et ses composants tiers         présent (19 997 Ko)
```

### Écart de PLATEFORME (attendu, binaires optionnels)

| Composant | Présence |
|---|---|
| `@img/sharp-libvips-linux-x64@1.3.4`, `@img/sharp-libvips-linuxmusl-x64@1.3.4`, `@img/sharp-linux-x64@0.35.5`, `@img/sharp-linuxmusl-x64@0.35.5`, `@next/swc-linux-x64-gnu@15.5.28`, `@next/swc-linux-x64-musl@15.5.28` | **Linux/Vercel uniquement** |
| `@img/sharp-win32-x64@0.35.5`, `@next/swc-win32-x64-msvc@15.5.28` | **Windows uniquement** |

133 − 6 + 2 = 129. La SBOM versionnée décrit la clôture **serveur Linux** — celle qui est déployée sur Vercel — et c'est le bon choix : la régénérer depuis Windows aurait tu les binaires Linux du déploiement.

### Les 105 « déclarés mais absents du paquet »

Ce ne sont **pas** des composants non distribués : Next.js les **compile dans le bundle serveur** (`.next/server/**`) au lieu de les recopier comme dossiers de paquets. Le code voyage, l'obligation d'attribution s'applique, et la SBOM les déclare correctement. Seule leur FORME diffère.

### Les 13 « empaquetés sans notice correspondante » — écart réel

| Composant | Licence | Emplacement dans l'artefact | Analyse |
|---|---|---|---|
| `@edge-runtime/cookies@6.0.0`, `@edge-runtime/ponyfill@4.0.0`, `@edge-runtime/primitives@6.0.0`, `react-is@19.2.0-canary-…`, `react-refresh@0.12.0`, `regenerator-runtime@0.13.4` | — | `standalone/node_modules/next/dist/compiled/…` | **Vendorisés à l'intérieur du paquet `next`**, avec leur propre `package.json`. Couverts par la notice de `next@15.5.28`, qui est présente. |
| `prisma-client-47b414…@5.22.0` | — | `standalone/node_modules/.prisma/client` | **Client Prisma GÉNÉRÉ** depuis le schéma du produit. Pas un composant tiers. |
| **`typescript@5.9.3`** | **Apache-2.0** | `standalone/node_modules/typescript` — **8 904 Ko** | **Écart réel.** Tiré par `next/dist/lib/verify-typescript-setup.js` lors du traçage de la sortie autonome. Non déclaré dans la clôture de production (c'est une `devDependency`) et **absent des notices**. |
| **`source-map@0.6.1`** | **BSD-3-Clause** | `standalone/node_modules/source-map` — 129 Ko | **Écart réel**, même nature. |
| **`source-map-support@0.5.21`** | **MIT** | 24 Ko | **Écart réel**, même nature. |
| **`buffer-from@1.1.2`** | **MIT** | 5 Ko | **Écart réel**, même nature. |
| `@img/sharp-win32-x64@0.35.5`, `@next/swc-win32-x64-msvc@15.5.28` | Apache-2.0 / MIT | `app.asar.unpacked/node_modules/` | **Écart réel** : déclarés dans la clôture Windows, absents des notices issues de la clôture Linux. |

**Six composants sont donc distribués dans l'installateur Windows sans section de notice correspondante** : `typescript` (Apache-2.0), `source-map` (BSD-3-Clause), `source-map-support` (MIT), `buffer-from` (MIT), `@img/sharp-win32-x64` (Apache-2.0), `@next/swc-win32-x64-msvc` (MIT).

Ce n'est pas corrigé dans ce passage : y remédier proprement exige une décision produit — publier des notices **par plateforme** et les embarquer dans l'installateur, ce qui modifie le contenu distribué et invaliderait l'artefact qui vient d'être vérifié. Les composants, licences et emplacements sont nommés ci-dessus, et l'action est consignée dans `ACTIONS_MANUELLES_RESTANTES.md`.

Rapport complet, avec l'inventaire exhaustif des 35 paquets réellement empaquetés : `artifacts/windows-delivery/sbom-reconciliation.json`. SBOM de la clôture Windows : `docs/sbom/sbom-garageflows-windows.cdx.json`.

### Composants non npm

Les textes d'Electron (`LICENSE.electron.txt`) et de Chromium avec ses composants tiers (`LICENSES.chromium.html`, 19,5 Mio) sont **présents dans l'artefact**, comme l'exige leur distribution. Ils ne passent pas par la SBOM npm.

## 10. Poids de l'installateur

234,0 Mo, dont Chromium/Electron pour l'essentiel. Deux postes réductibles identifiés :

- **8,9 Mo de TypeScript** embarqués sans usage à l'exécution (voir §9) ;
- 19,5 Mo de `LICENSES.chromium.html`, obligatoire.

Aucune réduction n'a été tentée : alléger la sortie tracée par Next.js modifierait le contenu distribué.
