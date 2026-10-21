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

## 4. Preuve Windows : job CI « Windows candidate packaging and inspection »

Ce que le conteneur ne pouvait pas faire, la CI de la PR #34 l'a fait sur un
exécuteur `windows-latest` (run 39536734268, job Windows 119016439462, tête `9a244ad`). Toutes les étapes ont réussi :

| Étape CI | Résultat |
|---|---|
| `npm ci`, ancrage public matérialisé, `check:public-key`, `keys:check` | réussi |
| Tests d'empaquetage (`package-prisma-resources`, `build-public-key`, `preload-listeners`, `preserve-legacy-dev-db`, `next-build-home`, `restore-public-anchors`, `windows-package-diagnostic`) | réussi |
| `npm run dist` officiel (préflight, build, `verify:standalone`, electron-builder, `check:artifact-secrets`, `check:artifact-fuses`, `verify:installer`) | réussi en 4 min 27 |
| Intégrité contre les ressources réellement empaquetées (`integrity-diagnostics`, `GF_REQUIRE_ARTIFACT_TEST=1`) | réussi : c'est le test G, ignoré dans le conteneur |
| `release:verify-artifact` | réussi |
| `scripts/test-windows-setup.ps1` : installation silencieuse dans un dossier isolé, lancement depuis un dossier vide jusqu'à la fenêtre d'activation, base SQLite initialisée depuis les ressources installées, tests du serveur installé, réinstallation (données et secret d'installation préservés), désinstallation (exécutable retiré, données utilisateur intactes) | réussi en 1 min 24 |
| Publication de `release/GarageFlows-Setup.exe` en artefact (30 jours) | réussi |

Ce que ce job **ne prouve pas**, et que le script consigne lui-même :
`licensedBusinessWorkflowTested: false` (aucun parcours licencié, faute de
licence de l'autorité) et `cleanOSWithoutBuildToolsTested: false` (l'exécuteur
CI est un Windows Server outillé, pas un Windows 10/11 vierge).

## 5. Non réalisé

| Élément | Statut | Pour lever le blocage |
|---|---|---|
| `electron-builder` dans le conteneur | BLOQUÉ | téléchargement d'Electron refusé ; **couvert par la CI Windows (§4)** |
| Mise à jour Vn → Vn+1 sans perte de données | NON TESTÉ | matrice `WINDOWS_INSTALL_UPDATE_MATRIX` |
| Poste Windows 10/11 vierge, parcours licencié de bout en bout | NON TESTÉ | poste réel + licence de l'autorité |
| Signature Authenticode | BLOQUÉ | certificat de signature de code |
| Signature Ed25519 d'un vrai installeur | BLOQUÉ | `GF_UPDATE_SIGNING_KEY` ou `GF_UPDATE_SIGNING_KEY_FILE` |

Nom réel de l'artefact : `build.nsis.artifactName` vaut `GarageFlows-Setup.exe`
(nom stable exigé par la chaîne de mise à jour), et non
`GarageFlows Setup x.y.z.exe`.

## 6. Commandes utilisateur (poste Windows connecté)

```cmd
cd chemin-vers-garageflows
npm install
npm run dist
```

Installer : `dist/GarageFlows-Setup.exe` (copie vérifiée dans `release/`).
