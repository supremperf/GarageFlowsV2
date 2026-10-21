# AUDIT_BUILD_INSTALLATION — 2026-10-21

## 1. Outils

Node 22.22.0, npm 10.9.4 (`engines` : `>=22.12.0 <23`), Python 3.13.16 et 3.12,
Next 15.5.27, Electron 41.10.6, electron-builder 26.15.3, Prisma 5.22.0.
Linux 6.18, sans Windows ni Wine.

## 2. Chaîne `npm run dist` rejouée étape par étape

`dist` = `preflight:release` → build d'empaquetage → `verify:standalone` →
`electron-builder --win --x64` → `check:artifact-secrets` →
`check:artifact-fuses` → `verify:installer`.

| Étape | Commande | Résultat | Statut |
|---|---|---|---|
| Installation propre | `npm ci` | 758 paquets ; `postinstall` (setup-dev + 2 × `prisma generate`) réussi | VALIDÉ |
| Audit | `npm audit` | 0 vulnérabilité | VALIDÉ |
| Préflight | `node scripts/preflight-release.cjs` | « Prérequis réunis » ; avertit que l'hôte n'est pas Windows ; matérialise `keys/public.pem` depuis l'ancrage embarqué | VALIDÉ |
| Build | `cross-env GF_PACKAGE_DESKTOP=1 npm run build` | exit 0 ; `.env` retiré, `public.pem` copié, 0 clé privée | VALIDÉ |
| Sortie autonome | `npm run verify:standalone` | « Sortie autonome complète (4 éléments vérifiés) » | VALIDÉ |
| Budget | `npm run check:perf-budget` | 3,49 / 3,65 Mio ; bloc max 322,3 / 512 Kio | VALIDÉ |
| Empaquetage | `npx electron-builder --win --x64 --publish never` | échec : téléchargement d'Electron depuis github.com refusé par le proxy du bac à sable (alerte TLS) | BLOQUÉ |
| `check:artifact-secrets`, `check:artifact-fuses`, `verify:installer` | — | aucun artefact Windows | BLOQUÉ |

Remarque : un `npm run build` lancé **sans** `preflight:release` signale
« keys/public.pem absent — sortie NON distribuable » et `verify:standalone`
échoue. C'est le comportement voulu (fail-closed) : `npm run dist` exécute le
préflight en premier.

## 3. Test du serveur empaqueté (composant, Linux)

Le contenu de `.next/standalone`, celui qu'Electron démarre, a été lancé comme
le fait le poste : `NODE_ENV=production`, `ELECTRON=1`, base SQLite copiée du
modèle de version, secrets aléatoires propres au test.

| Vérification | Résultat |
|---|---|
| Démarrage et sonde de santé (`electron/server-ready.js`) | OK en 1 724 ms |
| `/api/internal/export` sans clé | 401 |
| `/api/internal/export` avec clé | 200, client de test présent |
| `/api/clients` sans session | 401 |
| `/login` | 200 |
| Redémarrage, puis relecture | données persistées |

Ceci ne remplace pas `scripts/test-installed-server.cjs`, réservé à la CI
Windows sur un installateur réellement installé.

## 4. Non réalisé

| Élément | Statut | Pour lever le blocage |
|---|---|---|
| `dist/GarageFlows-Setup.exe` | BLOQUÉ | poste Windows ou CI avec accès à github.com |
| Installation, lancement, désinstallation, réinstallation, mise à jour Vn → Vn+1 | BLOQUÉ | matrice `WINDOWS_INSTALL_UPDATE_MATRIX` sur Windows 10/11 |
| Signature Authenticode | BLOQUÉ | certificat de signature de code |
| Signature Ed25519 d'un vrai installeur | BLOQUÉ | `GF_UPDATE_SIGNING_KEY` ou `GF_UPDATE_SIGNING_KEY_FILE` |

Nom réel de l'artefact : `build.nsis.artifactName` vaut `GarageFlows-Setup.exe`
(nom stable exigé par la chaîne de mise à jour), et non
`GarageFlows Setup x.y.z.exe`.

## 5. Commandes utilisateur (poste Windows connecté)

```cmd
cd chemin-vers-garageflows
npm install
npm run dist
```

Installer : `dist/GarageFlows-Setup.exe` (copie vérifiée dans `release/`).
