---
doc-numbers: journal
---

# VALIDATION WINDOWS — MASTER 7

Preuve : `MASTER7_EVIDENCE/logs/07-windows-signature.txt`. **Aucun certificat n'est inventé, et aucune compilation Linux n'est présentée comme une validation Windows.**

---

## 1. Signature : absente, reconfirmé

```
GarageFlows-Setup.exe      Status : NotSigned    251 220 180 octets
GarageFlows.exe            Status : NotSigned    246 840 832 octets
certificat signataire      : aucun, dans les deux cas

Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert   →   AUCUN
```

## 2. Pourquoi : rien n'est configuré pour signer

| `build.win` | Valeur |
|---|---|
| `target` | `[{"target":"nsis","arch":["x64"]}]` |
| `certificateFile` | **aucun** |
| `certificateSubject` | **aucun** |
| `signtoolOptions` | **aucun** |

| Variable | État |
|---|---|
| `CSC_LINK` · `CSC_KEY_PASSWORD` | **absentes** |
| `WIN_CSC_LINK` · `WIN_CSC_KEY_PASSWORD` | **absentes** |

Il n'y a donc **rien à corriger dans la configuration** : il manque un certificat. C'est un achat, pas un défaut logiciel.

## 3. Ce qui est vérifié sur l'artefact livré

Contrôles du projet exécutés **sur l'artefact déjà construit, sans reconstruction** — donc sur l'octet exactement livré :

| Contrôle | Résultat |
|---|---|
| `check:artifact-secrets` | **OK** — aucune clé privée, aucun secret |
| `check:artifact-fuses` | **OK** — 9 / 9 fusibles conformes |
| `verify:installer` | **OK** — taille, version, type d'exécutable, charge utile |

Fusibles Electron : `RunAsNode=false`, `EnableCookieEncryption=true`, `EnableNodeOptionsEnvironmentVariable=false`, `EnableNodeCliInspectArguments=false`, `EnableEmbeddedAsarIntegrityValidation=true`, `OnlyLoadAppFromAsar=true`, `LoadBrowserProcessSpecificV8Snapshot=false`, `GrantFileProtocolExtraPrivileges=true`, `WasmTrapHandlers=true`.

## 4. Ce que la cible NSIS garantit déjà

| Réglage | Valeur | Effet |
|---|---|---|
| `oneClick` | `false` | l'utilisateur voit et contrôle l'étape |
| `perMachine` | `false` | installation par utilisateur |
| `allowElevation` | `false` | **aucune demande de droits administrateur** |
| `deleteAppDataOnUninstall` | **`false`** | **les données utilisateur sont conservées à la désinstallation** |
| `createDesktopShortcut` | `always` | |
| `createStartMenuShortcut` | `true` | |

Le point le plus important pour un parc installé — la non-destruction des données à la désinstallation — est **acquis par configuration**.

## 5. Ce qui reste non joué, et pourquoi

**Non exécuté** : installation, raccourcis, entrée de désinstallation, mise à niveau, désinstallation, activation et HWID sur poste vierge.

**Raison** : ce poste héberge une installation **réelle** de GarageFlows et les données métier de l'utilisateur. L'`appId` étant partagé, une installation de test rendrait l'installation existante non désinstallable. La procédure officielle du projet refuse d'ailleurs de s'exécuter ici.

**Je ne peux pas créer de machine virtuelle Windows jetable depuis cette session** : c'est un prérequis matériel externe. Le mandat demandait de « préparer un environnement Windows propre et jetable » — je peux en fournir la procédure, pas la machine.

## 6. Procédure sur machine jetable

```powershell
# 1. Vérifier l'empreinte AVANT d'exécuter quoi que ce soit
Get-FileHash .\GarageFlows-Setup.exe -Algorithm SHA256

# 2. Jouer la procédure officielle du projet, en mode isolé
$env:GITHUB_ACTIONS = "true"
$env:RUNNER_OS = "Windows"
$env:GF_WINDOWS_SMOKE_ISOLATED = "1"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-windows-setup.ps1
```

Puis, avec une **licence de test** — jamais une licence client :

- activation et relevé du HWID ;
- création d'un client et d'une facture, export PDF ;
- paramètres, comportement hors ligne ;
- **mise à niveau** depuis la version précédente ;
- **désinstallation**, en vérifiant que les données survivent (`deleteAppDataOnUninstall: false`).

**Preuve attendue** : le JSON de résultat avec `success: true`.

## 7. Obtenir un certificat

| Option | Coût | Réputation SmartScreen | Contrainte |
|---|---|---|---|
| **OV** (validation d'organisation) | moindre | **à construire** — les premiers clients verront encore un avertissement | aucune particulière |
| **EV** (validation étendue) | plus élevé | **immédiate** | clé en HSM ou jeton matériel ; impose une CI ayant accès au matériel |

Mise en œuvre, une fois le certificat obtenu :

- ne **jamais** committer le certificat ni son mot de passe ;
- fournir `CSC_LINK` et `CSC_KEY_PASSWORD` par les **secrets de la CI** ;
- reconstruire : `npm run dist` signera alors l'installateur et les exécutables ;
- vérifier : `Get-AuthenticodeSignature` → `Status: Valid`, et le reçu de livraison doit porter `authenticodeVerified: true`.

## 8. Verdict de phase

| | |
|---|---|
| signature | **BLOQUÉ** — certificat absent, prérequis externe |
| parcours d'installation réel | **BLOQUÉ** — machine jetable requise |
| intégrité, fusibles, secrets de l'artefact | **VALIDÉ** sur l'octet livré |
| conservation des données à la désinstallation | **VALIDÉ** par configuration |
