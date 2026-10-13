<!-- doc-status: actif -->

# Inventaire des canaux IPC Electron (V15)

Audité le 2026-08-07 sur `electron/main.js` + `electron/preload.js`. Contexte de
sûreté global : les 3 `BrowserWindow` sont `contextIsolation:true`,
`nodeIntegration:false`, `sandbox:true`, `webSecurity:true` ; le renderer
n'accède à AUCUN Node brut — le preload expose une **allow-list fixe**
(`contextBridge.exposeInMainWorld('electronAPI', {…})`), sans `require`, `fs`,
`shell`, `process` ni `eval`. Le serveur Next embarqué n'écoute que 127.0.0.1.

Colonnes : sens (R→M renderer→main), paramètres, validation, privilège, risque.

| Canal | Sens | Paramètres | Validation | Privilège | Risque |
|---|---|---|---|---|---|
| `app:version` | R→M | — | n/a | lecture version | nul |
| `app:license-info` | R→M | — | n/a | lecture licence (masquée) | nul |
| `app:db-path` | R→M | — | n/a | lecture chemin | faible |
| `app:backup` | R→M | — | n/a | copie BD locale | faible (chemin fixe) |
| `app:open-backups` / `app:open-logs` | R→M | — | n/a | `shell.openPath` sur chemin **fixe interne** | faible |
| `win:minimize/maximize-toggle/close/fullscreen-toggle/is-maximized` | R→M | — | n/a | contrôle fenêtre | nul |
| `app:desktop-export-now` / `app:open-desktop-export` | R→M | — | n/a | export vers dossier fixe | faible |
| `app:entitlements` / `app:notifications` / `app:online-status` / `app:local-ip` | R→M | — | n/a | lecture état | nul |
| `app:crash-consent` | R→M | — | n/a | lecture consentement | nul |
| `license-submit` | R→M | `token:string` | vérifié par le flux licence (`verifyLicenseToken`) | activation licence | contrôlé (signature ECDSA) |
| `license-quit` | R→M | — | n/a | quitte | nul |
| `app:update-license` | R→M | `token:string` | vérification licence signée | maj licence | contrôlé |
| `app:ack-notification` | R→M | `notificationId` | garde `!notificationId → {ok:false}` ; POST serveur scopé licence | acquittement diffusion | faible |
| `app:set-crash-consent` | R→M | `value` | coercition `!!value` | écrit un booléen de réglage | nul |
| `app:report-crash` | R→M | `info:{message,stack,fatal}` | `sanitizeCrashReport` : redaction + bornage (message 2000, stack 20000, logs 4000) — `control-plane.js:137` | journalise un crash | faible (déjà borné+redacté) |
| `app:breadcrumb` | R→M (on) | `action` | `String(action).slice(0,120)` + buffer borné à 25 — `main.js:678` | miette de diagnostic | faible (déjà borné) |
| `app:check-updates` | R→M | — | n/a | interroge le serveur de MàJ | contrôlé |
| `app:install-update` | R→M | `arg:string\|{url,sha256,size,manifest}` | **FAIL-CLOSED** : si signature configurée, **manifeste Ed25519 signé OBLIGATOIRE** ; les valeurs signées priment ; URL typée ; SHA-256 + taille vérifiés avant exécution ; anti-downgrade (semver) | télécharge+exécute l'installeur | **le plus sensible — mitigé** (voir `electron/update-verify.js`) |

## Constats

- **Aucun canal n'exécute de shell/exec/fs arbitraire à partir d'une chaîne
  libre du renderer.** Les actions `shell.openPath`/`openExternal` ciblent des
  chemins internes fixes ou une allow-list d'hôtes HTTPS
  (`main.js` `setWindowOpenHandler` + `ALLOWED_EXTERNAL_HOSTS`).
- Le canal privilégié `app:install-update` est **fail-closed** sur un manifeste
  signé (autorité de confiance indépendante du serveur de binaires).
- **Entrées du renderer déjà bornées et redactées** : `app:report-crash`
  (`sanitizeCrashReport`, redaction + troncature par champ) et `app:breadcrumb`
  (`String(...).slice(0,120)` + buffer borné). **Constat V15 : aucune faiblesse
  de validation IPC trouvée** — le pont est une allow-list minimale et les rares
  entrées sont coercées/bornées. Aucun correctif nécessaire (revalidé, non
  affirmé sans preuve).

## Tests rattachés

`nav-guard`, `update-verify` (manifeste signé/hash/anti-downgrade fail-closed),
`user-data-path`, `pre-migration-backup`.
