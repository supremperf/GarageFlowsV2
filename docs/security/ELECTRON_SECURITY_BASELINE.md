# Electron Security Baseline — configuration attendue vs observée

Audit du 2026-08-07 (commit de la V13). Chaque « observé » cite le fichier:ligne
réellement lu — aucune valeur recopiée d'un rapport antérieur.

## 1. Configuration des fenêtres (BrowserWindow)

| Réglage | Attendu | Observé | Où |
|---|---|---|---|
| `contextIsolation` | `true` | ✅ `true` sur les 3 fenêtres | `electron/main.js:1678, 1708, 1786` |
| `nodeIntegration` | `false` | ✅ `false` sur les 3 fenêtres | idem |
| `sandbox` | `true` | ✅ `true` sur les 3 fenêtres | idem |
| `webSecurity` | `true` | ✅ `true` (explicite) | `main.js:1711, 1789` |
| `eval` / `new Function` | absents | ✅ 0 occurrence dans `electron/` | grep V13 |

## 2. Navigation & contenu distant

- **Garde de navigation pure et testée** (`electron/nav-guard.js`) : seule
  l'origine locale exacte (`http://127.0.0.1:PORT`) est autorisée — comparaison
  sur `URL(...).origin` (AUD-003 corrigé).
- **`setWindowOpenHandler`** : `action: 'deny'` systématique ; `shell.openExternal`
  uniquement pour des URL **https** dont l'hôte est dans une **allowlist
  explicite** (`garageflows.fr` et sous-domaines) — `main.js:1880-1892`. URL
  invalide → refus silencieux journalisé.
- Le serveur Next embarqué n'écoute que sur la boucle locale (127.0.0.1).

## 3. IPC & preload

- **27 handlers IPC** (`ipcMain.handle/on`, `main.js`), exposés au renderer via
  un **unique `contextBridge.exposeInMainWorld('electronAPI', …)`**
  (`preload.js:10`) — pas d'accès Node direct côté renderer.
- Aucun handler n'exécute de shell à partir d'une entrée utilisateur (audit
  V13 : 0 `child_process` alimenté par un argument IPC).
- Entrées validées côté main ; les décisions critiques (licence, migration)
  sont revérifiées côté serveur/local en fail-closed.

## 4. Fuses (gravées au packaging — `scripts/fuse-config.js` + `afterPack`)

| Fuse | Valeur |
|---|---|
| `RunAsNode` | `false` (pas de mode Node caché `ELECTRON_RUN_AS_NODE`) |
| `EnableNodeCliInspectArguments` | `false` (pas de `--inspect` distant) |
| `OnlyLoadAppFromAsar` | `true` (chargement exclusif depuis l'asar) |
| + durcissements complémentaires | voir `scripts/fuse-config.js` |

## 5. Chaîne de démarrage & données

- **Sauvegarde vérifiée pré-migration** puis **migration fail-closed** avant
  ouverture de la fenêtre (`electron/pre-migration-backup.js`, ordre imposé par
  la garde `check:migration-safety`).
- Secrets locaux : dérivation par installation (`electron/secure-key.js`,
  `secret.js`) — jamais de constante committée ; ressources scellées
  (`integrity.js`, manifeste HMAC).
- Chemin `userData` : échec **journalisé et bloquant** (plus de catch silencieux).

## 6. Exceptions & justifications

- `sandbox:true` + preload : l'API exposée est minimale et typée ; pas de
  `remote`.
- CSP web (voir `next.config.mjs`) : `'unsafe-inline'` scripts reste
  l'exception documentée (hydratation Next sans nonce, AUD-024) ;
  `'unsafe-eval'` est **absent hors développement** depuis la V13.

## 7. Ce que cette baseline ne couvre pas (validation externe)

Packaging/installation **Windows réels**, signature **Authenticode**,
SmartScreen, coexistence PWA/EXE sur machines physiques : protocole documenté,
exécution = poste opérateur Windows (voir `EXTERNAL_VALIDATIONS`).

## 8. Tests rattachés

`nav-guard` (unitaires), `update-verify` (MàJ signées/hashées fail-closed),
`user-data-path`, `pre-migration-backup`, `secret-cipher`, intégrité des
ressources — tous dans la suite verte (voir baseline finale).

## 9. Revalidation du 2026-10-22 — candidat Electron 44.9.3 (non validé)

Les sections précédentes sont un relevé historique de la V13. Le candidat
courant est verrouillé sur Electron **44.9.3**, `@electron/fuses` 2.1.3 et
`electron-builder` 26.15.3. Electron 42 a atteint sa fin de support le
2026-10-20 ; 42.11.3 corrigeait bien les erreurs d’origine HID/USB mais ne
constituait plus une base maintenue au jour de cette revalidation. La version
44.9.3 est le correctif alors disponible sur la ligne 44 maintenue et intègre
la mitigation du certificat intermédiaire eMudhra compromis
([release Electron 44.9.3](https://github.com/electron/electron/releases/tag/v44.9.3),
[GHSA-jr5w-w6x2-84p9](https://github.com/electron/electron/security/advisories/GHSA-jr5w-w6x2-84p9)).
Les correctifs de validation d’origine HID/USB et `openExternal` sont également
présents dans cette branche (respectivement [GHSA-fw47-9c62-h3vw](https://github.com/electron/electron/security/advisories/GHSA-fw47-9c62-h3vw)
et [GHSA-997q-gvvc-jwmx](https://github.com/electron/electron/security/advisories/GHSA-997q-gvvc-jwmx)).
Cette sélection est un **candidat de sécurité**, pas une validation de lancement.

Le contrat Node/npm système du dépôt reste inchangé (`node >=22.12.0 <23`) ;
Electron 44 embarque son propre Node 24.x dans le runtime desktop. Ce n’est pas
une migration du Node système, mais cette différence ABI/runtime doit être
exercée sur l’installateur Windows. L’option macOS `openAsHidden` supprimée dans
Electron 44 a été retirée de l’appel `setLoginItemSettings` (la cible de
packaging est Windows).

Le build exige une valeur explicite pour chacun des **neuf** fuses V1
(`strictlyRequireAllFuses`) :

| Fuse V1 | Valeur configurée | Motif |
|---|---:|---|
| `RunAsNode` | `false` | Pas de mode Node via environnement ; Next est lancé par `utilityProcess.fork`. |
| `EnableCookieEncryption` | `true` | Cookies chiffrés par le magasin de clés OS ; ne pas rétrograder une base existante. |
| `EnableNodeOptionsEnvironmentVariable` | `false` | Désactive `NODE_OPTIONS`. Ne prétend pas filtrer `NODE_EXTRA_CA_CERTS` ni d’autres variables de processus. |
| `EnableNodeCliInspectArguments` | `false` | Désactive les points d’entrée d’inspection distants. |
| `EnableEmbeddedAsarIntegrityValidation` | `true` | electron-builder 26.15.3 sait inclure `ElectronAsarIntegrity` dans l’exécutable Windows ; le test verrouille `asar:true` et l’absence de `disableAsarIntegrity`. |
| `OnlyLoadAppFromAsar` | `true` | Pas de chargement de code depuis un dossier `app` substitué. |
| `LoadBrowserProcessSpecificV8Snapshot` | `false` | Aucun snapshot `browser_v8_context_snapshot.bin` spécifique n’est livré. |
| `GrantFileProtocolExtraPrivileges` | `true` | Exception nécessaire aux fenêtres locales chargées depuis `file://` dans l’ASAR ; l’A/B historique Electron 31.7.7 doit être rejoué sur l’artefact 44/Windows. |
| `WasmTrapHandlers` | `true` | Comportement mémoire WebAssembly sûr, explicitement fixé au lieu de dépendre du défaut Electron. |

`check-artifact-fuses` relit les bits du binaire empaqueté. Aucun binaire Windows
44.9.3, installateur, lancement, installation/réinstallation/désinstallation
ou test Authenticode n’a été vérifié ici. Le job Windows du candidat doit fournir
ces preuves avant publication.
