---
doc-numbers: journal
---

# WINDOWS ET INSTALLATEUR — rapport MASTER 6

**Verdict : installateur produit et vérifié ; signature et test d'installation restent BLOCKED.** Les deux limites de MASTER 5 subsistent, pour les mêmes raisons — aucune n'est levable depuis ce poste.

## 1. Signature Authenticode — BLOCKED

```
Get-AuthenticodeSignature release\GarageFlows-Setup.exe
Status            : NotSigned
SignerCertificate : <aucun>
```

Idem pour `dist\win-unpacked\GarageFlows.exe`. Le reçu de livraison l'enregistre honnêtement : `authenticodeVerified: false`.

### Audit de la configuration de signature

| Élément | Constat |
|---|---|
| bloc `build.win` de `package.json` | **aucun** `certificateFile`, `certificateSubjectName`, `certificateSha1` ni `signingHashAlgorithms` |
| certificat sur le poste | **aucun** certificat de signature de code trouvé |
| variables d'environnement de signature | `CSC_LINK`, `CSC_KEY_PASSWORD` : **absentes** |
| lignes « signing with signtool.exe » du journal | **tentatives sans certificat** — electron-builder les émet puis continue |

### Ce qui n'a pas été fait, délibérément

- aucun certificat auto-signé fabriqué — il ne lèverait pas l'avertissement SmartScreen et donnerait une fausse impression de signature ;
- aucun certificat acheté ;
- l'installateur n'est **jamais** présenté comme signé.

### Pour lever ce blocage

Acquérir un certificat de signature de code **OV** (validation d'organisation) ou **EV** (clé en HSM, réputation SmartScreen immédiate), puis le déclarer dans la cible `win` d'electron-builder et reconstruire. Conséquence actuelle pour l'utilisateur final : SmartScreen affichera « éditeur inconnu » à chaque installation.

## 2. Test d'installation sur machine jetable — BLOCKED

`scripts/test-windows-setup.ps1` est la procédure complète du projet. Elle **refuse de s'exécuter** ici, et à double titre :

```powershell
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows'
    -or $env:GF_WINDOWS_SMOKE_ISOLATED -ne '1') {
  throw 'Refused: an explicitly approved disposable Windows CI runner is required.' }
if (Test-Path $UserData) {
  throw 'Refused: userData already exists; no existing profile may be modified by this test.' }
```

### Pourquoi ce poste ne convient pas

| Constat mesuré | Valeur |
|---|---|
| installation GarageFlows existante | `%LOCALAPPDATA%\Programs\GarageFlows` |
| entrée de désinstallation | « GarageFlows 1.1.0 » (HKCU) |
| profil de données réel | `%APPDATA%\GarageFlow` — **411 fichiers, 285 501 418 octets** |
| base métier | `garageflow.db`, 1 241 088 octets, SHA-256 `7CAF2ADB…B76E4DCF` |

L'`appId` est partagé (`com.garageflow.app`) : installer ici risquerait de rendre **votre** installation non désinstallable, avec un build **non signé**.

L'isolation du `userData` est par ailleurs **impossible** sur ce poste : `electron/user-data-path.js` épingle le chemin sur `app.getPath('appData')`, qu'Electron résout par le **dossier connu Windows** et non par la variable `APPDATA` — la redirection a été tentée et mesurée sans effet (seuls des caches Chromium ont été créés dans le dossier jetable).

**Aucune installation, mise à niveau ou désinstallation n'a été tentée.** Vos données sont intactes.

### Ce qui EST prouvé, sans rien installer

Démarrage de l'exécutable **empaqueté** (`dist/win-unpacked/GarageFlows.exe` — l'arborescence exacte que NSIS recopie), avec **PATH réduit à Windows** (ni Node, ni npm, ni Python) et **répertoire courant vide** :

| Contrôle | Résultat |
|---|---|
| fenêtre ouverte, titre stabilisé | **`GarageFlows — Activation`** |
| validation d'intégrité ASAR à l'exécution | **`[integrity] OK — 540 fichiers critiques vérifiés`** |
| épinglage du `userData` | **OK** |
| secret d'installation et clé de chiffrement SMTP | **prêts** |
| détection de la base existante | **OK** |
| **sauvegarde pré-migration automatique** | **créée** |
| porte de licence *fail-closed* | **écran d'activation affiché** |
| arrêt propre, 2 démarrages successifs | **0 processus résiduel** |
| base métier avant/après | **inchangée, même SHA-256** |

### Ce qui reste NON EXÉCUTÉ

Exécution de l'installeur NSIS, raccourcis bureau et menu Démarrer, entrée de désinstallation, **mise à niveau** d'une installation précédente, **désinstallation avec conservation des données** (`deleteAppDataOnUninstall: false` est une configuration vérifiée, pas une preuve de comportement), activation de licence sur poste vierge, et vérification HWID sur poste vierge.

### Procédure prête à l'emploi

Sur une machine virtuelle Windows propre, sans GarageFlows installé :

```powershell
# 1. Vérifier l'empreinte avant toute exécution
Get-FileHash .\GarageFlows-Setup.exe -Algorithm SHA256

# 2. Lancer la procédure officielle du projet
$env:GITHUB_ACTIONS='true'; $env:RUNNER_OS='Windows'; $env:GF_WINDOWS_SMOKE_ISOLATED='1'
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-windows-setup.ps1
```

Elle couvre installation, premier démarrage, création du dossier de données, base locale, sentinelle SQLite avec `PRAGMA integrity_check`, réinstallation avec conservation des données, et désinstallation avec conservation. Preuve attendue : le JSON de résultat avec `success: true`.

Il faudra y ajouter, avec une **licence de test** (voir `MASTER6_LICENSE_REPORT.md`) : activation réelle, vérification HWID, création d'un client et d'une facture, export PDF, paramètres, et comportement hors ligne.

## 3. L'artefact produit

Voir `MASTER6_RELEASE_REPORT.md` pour l'empreinte, la taille et le commit de l'installateur final publié.

| Contrôle | Résultat |
|---|---|
| `check:artifact-secrets` | **aucune clé privée, aucune valeur de secret** (2 885 fichiers + installateur) |
| `check:artifact-fuses` | **9/9 fusibles conformes** |
| manifeste d'intégrité | **540 fichiers critiques** signés |
| `verify:installer` | **OK** — taille, version, type d'exécutable, charge utile vérifiée |
| cible NSIS | `oneClick: false`, `perMachine: false`, `allowElevation: false`, `asInvoker` |
| clé publique embarquée | **publique uniquement**, empreinte `b16d2e1b…`, matérialisée depuis les ancrages des sources |

## 4. Réconciliation SBOM ↔ notices de l'artefact

Six composants sont distribués dans l'installateur **sans section de notice** (hérité MASTER 5, inchangé) : `typescript@5.9.3` (Apache-2.0, 8 904 Ko), `source-map@0.6.1` (BSD-3-Clause), `source-map-support@0.5.21` (MIT), `buffer-from@1.1.2` (MIT), `@img/sharp-win32-x64@0.35.5` (Apache-2.0), `@next/swc-win32-x64-msvc@15.5.28` (MIT).

Y remédier exige une décision produit (notices **par plateforme** embarquées), ce qui modifierait le contenu distribué. Consigné dans `MASTER6_MANUAL_ACTIONS.md`.
