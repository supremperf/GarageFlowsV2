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
