<!-- doc-numbers: journal -->
# GarageFlows-Setup.exe — rapport de fabrication et reprise du 18 octobre 2026

## Verdict et livrable réel

**L’installateur autonome a été fabriqué et sa recette Windows automatisée a réussi. La distribution production reste NO-GO**, car le contrôle navigateur authentifié de staging et la validation globale restent rouges. Aucune fusion forcée dans main, aucun déploiement Vercel, aucune publication de mise à jour ni release production.

Preuve : [job Windows réussi](https://github.com/supremperf/GarageFlowsV2/actions/runs/39144372534/job/117726161834), commit exact **`5a10e96396ba2a78e447a65959cf5491fa5d8a67`**, arbre de fabrication propre. Les reçus ont été lus par l’API GitHub Checks et conservés dans [evidence/ci-5a10e96.json](evidence/ci-5a10e96.json).

| Identité | Valeur attestée par la CI Windows |
|---|---|
| Produit / version | GarageFlows 1.1.0, Windows x64 |
| Fichier de sortie | `release/GarageFlows-Setup.exe` |
| Taille EXE | **231 057 824 octets** (220,35 Mio ; 231,06 Mo décimaux) |
| SHA-256 EXE | `faf8c3e6ddb8534125469795f70cefd5b75d596431775f6d122d62a08d615c59` |
| Charge embarquée | 3 045 fichiers, inventaire et SHA256 de chacun comparés à win-unpacked après extraction effective |
| Signature Windows | **NotSigned**, pas de certificat Authenticode disponible |

**[Télécharger l’artefact contenant le Setup](https://github.com/supremperf/GarageFlowsV2/actions/runs/39144372534/artifacts/12143410620)** (accès GitHub au dépôt requis, rétention CI 30 jours). GitHub enveloppe l’artefact dans un ZIP de transport de 230 787 648 octets : ce n’est pas la taille de l’EXE. L’éditeur en extrait **uniquement GarageFlows-Setup.exe** pour le distribuer au client ; aucun dossier de ressources ne l’accompagne.

Le téléchargement depuis le stockage Azure des artefacts est bloqué dans le sandbox Arena. **Aucun EXE local n’est prétendu disponible ici et aucune empreinte recalculée localement n’est revendiquée** : les valeurs ci-dessus proviennent des reçus du job réussi, pas d’un fichier créé ou renommé dans cette session.

## 1. Audit initial et reprise

L’[audit architectural initial](00-ARCHITECTURE-AVANT-MODIFICATION.md) et le [guide opérateur](../../WINDOWS_DISTRIBUTION.md) décrivent les composants et le contrat complet. À la reprise : arbre Git propre, branche de session `arena/8ffb06d0-garageflowsv2` au commit 5a10e96 ; branche par défaut main à e3ac5f5, plus ancienne ; branche distante portant les travaux précédents `arena/55edbdc1-garageflowsv2` également à 5a10e96. Aucun changement utilisateur écrasé. Aucun dossier dist/release initial.

Architecture réelle : Electron 41.10.6, Next 15.5.27/React 18.3.1, Prisma 5.22 résolu, electron-builder 26.15.3, Node22 et npm11.16.0 en CI. Un seul bloc builder dans package.json. API App Router exécutées par Next standalone ; deux clients Prisma distincts, SQLite Desktop et PostgreSQL PWA ; langues incluses dans les bundles Next. Le générateur Python reste un outil éditeur.

## 2. Problèmes corrigés dans la chaîne reprise

- Nom/version de Setup et mélange des sorties : NSIS produit désormais le nom fixe ; dist reste intermédiaire, release contient uniquement l’EXE contrôlé.
- Une vérification MZ/taille ne prouvait pas le contenu réel du Setup : extraction de la charge embarquée et comparaison exhaustive ajoutées.
- Runtime installé incomplet après les filtres Builder : projection de la fermeture tracée complète hors ASAR ; repli borné sur les dépendances production réellement collectées par Builder, jamais sur tout le node_modules de développement. Copie explicite du client caché `.prisma/client`, dont le moteur Windows.
- Attente serveur insuffisante : health 200/DB connectée et défi HMAC propre à ce démarrage, délais bornés, arrêt sur décès du processus ; pas d’ouverture métier sur un service étranger ou indisponible.
- Configuration/données : aucune lecture de .env du dépôt en packagé ; base existante illisible conservée avec arrêt, copie initiale exclusive, pas de réinitialisation.
- Recette d’installation absente : le vrai EXE est installé, lancé puis réinstallé/désinstallé en runner Windows jetable. L’observation du handle de processus garantit un code retour installateur lisible.

## 3. Architecture finale et configurations

Conservation de **Electron + Next standalone + API locales + Prisma SQLite + NSIS offline x64**. Pas de remplacement théorique du système existant.

Démarrage : identité/dossier utilisateur historiques, secrets locaux et intégrité, base/template et sauvegarde pré-migration, licence ECDSA P-256/HWID/autorité, `utilityProcess.fork` avec le Node intégré à Electron, écoute **127.0.0.1 uniquement**, disponibilité authentifiée, migrations internes SQLite, fenêtre métier. Fermeture et before-quit arrêtent le serveur. Port 4028 fixe : un conflit doit échouer proprement, pas se connecter à un autre service. Origine renderer localhost alignée sur Next et résolue vers IPv4 locale.

**Builder :** appId `com.garageflow.app`, productName GarageFlows, `asar: true`, main/preload/modules Electron dans ASAR ; standalone, icône, schéma/template SQLite et clé publique comme ressources ; moteurs Prisma hors ASAR ; afterPack projette les modules, applique les fuses puis scelle l’intégrité. `directories.output: dist`.

**NSIS :** cible `nsis` (pas nsis-web), x64, `artifactName: GarageFlows-Setup.exe`, `oneClick: false`, `perMachine: false`, `allowElevation: false`, `allowToChangeInstallationDirectory: false`, `createDesktopShortcut: always`, `createStartMenuShortcut: true`, icônes officielles, `deleteAppDataOnUninstall: false`, macros `scripts/installer.nsh`. Aucun téléchargement de runtime imposé au client.

**Données :** `%APPDATA%\GarageFlow\` reste le chemin historique volontaire. Base, photos, sauvegardes, licence et secrets ne résident ni dans ASAR ni dans l’installation. Ne pas changer ce nom pour suivre la marque. Les migrations PostgreSQL ne sont pas exécutées sur Desktop ; le routage des clients et les gardes PWA/Vercel sont conservés.

## 4. Fichiers et dépendances

La transformation héritée est portée notamment par :

- `package.json` (contrat scripts/NSIS), `scripts/installer.nsh`, `scripts/afterPack.js` ;
- `scripts/lib/installed-runtime-modules.cjs`, `scripts/lib/windows-delivery.cjs`, `scripts/verify-installer.cjs` ;
- `electron/main.js`, `electron/server-ready.js`, `src/app/api/health/route.ts` ;
- `scripts/test-windows-setup.ps1`, `scripts/test-installed-server.cjs`, `.github/workflows/ci.yml` ;
- tests de livraison, démarrage, données et secrets, guide et audit Windows.

**Ce lot de reprise** ajoute trois tests à `tests/installed-runtime-modules.test.cjs` et met à jour ce rapport, le guide et les reçus de preuve. Il ne modifie pas le runtime de l’EXE attesté. Les tests couvrent la fermeture tracée (auparavant non couverte), le chargement des modules après suppression des entrées de build, le refus d’un repli implicite vers le checkout et l’échec si le moteur Windows manque. **Aucune dépendance ajoutée/supprimée**, aucun lock modifié dans ce lot.

## 5. Commandes et tests réellement exécutés

Fabrication officielle **sur Windows x64**, outils éditeur uniquement :

```powershell
npm ci
npm run lint
npm run typecheck
npm test
npm run dist
```

`dist` enchaîne préflight, génération Prisma Desktop/serveur, Next build/postbuild, contrôle standalone, builder NSIS, secrets/fuses et vérification/copier du Setup vers release. Les reçus restent sous artifacts/windows-delivery, pas chez le client.

### Windows CI — commit 5a10e96

| Contrôle | Résultat |
|---|---|
| Génération Prisma, Next build, postbuild, standalone | Réussis dans la commande officielle dist |
| Packaging Electron/NSIS offline, ressources, secrets/fuses | Réussis |
| Extraction/comparaison réelle de la charge du Setup | Réussie, 3 045 fichiers |
| Budget JS, intégrité réelle, provenance de l’artefact | Jobs/étapes réussis |
| Installation silencieuse du Setup réel | Réussie, code retour 0 |
| Lancement installé depuis CWD vide, PATH Windows seulement | Réussi jusqu’à l’écran d’activation réel |
| SQLite créée, écriture/lecture sentinelle | Réussies |
| Serveur installé : modules limités au payload, refus API sans clé, export, backup relu, static, migrations SQLite | Réussis via Node du runner comme outil de recette |
| Fermeture, relance, réinstallation, désinstallation | Réussies ; données/secrets conservés |
| Dépendances, Gitleaks, types/lint/tests SQLite/PostgreSQL, build standard, E2E publics | Jobs réussis |
| E2E authentifié staging / validation globale obligatoire | **Échec** ; ne pas masquer ni retirer cette porte |

### Sandbox Linux — reprise du 18 octobre

- `npm ci --ignore-scripts` : réussi (758 paquets ajoutés, audit npm 0 vulnérabilité). Ce n’est **pas** une installation complète des moteurs natifs.
- `npm run test:release-safety` : **94/94 réussis**, dont quatre tests de projection runtime.
- `npm run lint` : réussi, code 0.
- `npm run check:sqlite-template` : intégrité/foreign keys/baseline/checksums réussis, 214 migrations enregistrées, aucune en attente.
- `npm run preflight:release` : réussi, avertissement explicite environnement non-Windows ; seule l’ancre publique existante a été matérialisée.
- Génération Prisma locale : **bloquée** sur binaries.prisma.sh (réseau/TLS interdit par le sandbox). Aucun contournement TLS, aucun moteur fictif. Build/typecheck natifs locaux non revendiqués ; la preuve de build vient de la CI Windows du SHA indiqué.

## 6. Exclusions et mises à jour

Exclus/contrôlés : clés privées licence/update, .env et secrets éditeur, outils Python keygen, interfaces/bases administratives et états éditeur. Seules les ancres publiques requises à la vérification sont distribuées. Aucun contrôle de licence, HWID, appareil, record-MAC ou intégrité n’a été désactivé pour la recette.

Protocole existant **Ed25519 + SHA256/taille + version/canal/plateforme + HTTPS autorisé + anti-downgrade** conservé, pas d’electron-updater ajouté. Les clés privées restent hors distribution. Signature d’un manifeste réservée à l’éditeur ; URL immuable par version et version package à augmenter pour une vraie mise à jour. Le nom fixe du Setup n’est pas un obstacle. Pas de manifeste signé ni publication production effectués ; Authenticode absent et avertissement SmartScreen possible.

## 7. Limites et clôture

Le runner hébergé dispose d’outils de build même si PATH est restreint au lancement : **ce n’est pas un PC physique Windows vierge**. Le test Electron n’active pas de licence production et ne prouve pas une session métier licenciée ; le test serveur avec Node du runner est complémentaire, pas une preuve de démarrage du utility process dans une session licenciée. Réinstallation de même version ≠ toutes les migrations inter-versions. Les 14 langues sont conservées, pas toutes inspectées visuellement. Aucune promesse d’absence absolue de régression.

La CI globale du même SHA reste rouge et les [blocages sécurité/revue préexistants](../security-151/02-VERDICT-ET-INTEGRATION.md) ne sont pas levés par la fabrication. Avant distribution production : recette licenciée autorisée, staging authentifié configuré/vert, revue sécurité et scénarios métier, signature éditeur et décision humaine. Les commits de tests/documentation postérieurs ne reçoivent pas artificiellement le statut CI de 5a10e96.
