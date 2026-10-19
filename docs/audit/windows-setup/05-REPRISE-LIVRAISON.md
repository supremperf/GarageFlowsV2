<!-- doc-numbers: journal -->
# Reprise — rapport de la mission « un seul GarageFlows-Setup.exe »

Réponse au §12 de la mission (rapport final : audit, problèmes, architecture,
fichiers, dépendances, configurations, commandes, tests réellement exécutés,
chemin/taille/empreinte du livrable, exclusions, mises à jour, limites).

Chaîne des rapports : [fabrication et recette](01-RAPPORT.md) →
[sécurité](02-REPRISE-SECURITE.md) → [transport](03-REPRISE-TRANSPORT.md) →
[synchronisation](04-REPRISE-SYNCHRONISATION.md) → **celui-ci**.

## 0. Où la reprise a commencé

Départ : HEAD `f2370a3a8d411b704193dea78b062d85b5f537d9`, branche de session
propre, aucun fichier modifié non commité à écraser. `main` distante à `e3ac5f5`
— **deux commits en retard**, c'est-à-dire que tout le travail de distribution
vivait hors de la branche par défaut.

Constat décisif, vérifié et non repris des rapports antérieurs : le job
**Windows candidate packaging and inspection** est `SUCCESS` sur CE commit, en
push comme en PR. La mission n'était donc pas « construire l'installateur » — il
est construit et recetté — mais trois trous précis :

1. les reçus de CE build n'étaient **pas archivés dans le dépôt** (seuls ceux de
   `5a10e96`, `6087458`, `66859cc` et `7e6891e` l'étaient) ;
2. le livrable n'était récupérable que comme **artefact CI à rétention 30 jours**,
   sans chemin documenté pour l'éditeur ;
3. un défaut réel de diagnostic dans la dernière étape de la chaîne (§2).

## 1. Audit de l'architecture initiale (relue, pas recopiée)

Relus intégralement dans cette session : `package.json` (scripts + bloc `build`),
`next.config.mjs`, `electron/main.js` (démarrage, `startNextServer`,
`waitForServer`, arrêt), `electron/server-ready.js`, `electron/update-verify.js`,
`scripts/installer.nsh`, `scripts/afterPack.js`, `scripts/post-build.js`,
`scripts/preflight-release.cjs`, `scripts/verify-installer.cjs`,
`scripts/lib/windows-delivery.cjs`, `scripts/lib/installed-runtime-modules.cjs`,
`scripts/lib/package-prisma-resources.cjs`, `.github/workflows/ci.yml`.

Architecture réelle, conforme à la cible demandée par la mission :

- **Electron 41.10.6** + **Next.js 15.5.27** en `output: 'standalone'`, racine de
  tracing verrouillée sur le projet (`outputFileTracingRoot`) — sans elle, un
  `package-lock.json` parasite dans le profil utilisateur déplaçait `server.js`
  et l'installateur embarquait une arborescence imbriquée.
- Le serveur local tourne via **`utilityProcess.fork`**, donc avec **le Node
  d'Electron** : aucun Node, npm ou Python n'est requis chez le client.
- Écoute **`HOSTNAME: '127.0.0.1'`** uniquement ; origine renderer
  `http://localhost:4028` résolue vers IPv4 pour que redirections Next et cookies
  NextAuth restent sur la même origine.
- Démarrage conditionné à un **health 200 + `db: 'connected'` + preuve HMAC** liée
  à la clé interne aléatoire du processus : un serveur tiers sur 4028 ne suffit
  pas, et son décès interrompt l'attente (`AbortController`).
- **SQLite** dans `%APPDATA%\GarageFlow\garageflow.db` (nom historique épinglé),
  créé exclusivement (`COPYFILE_EXCL`) depuis `prisma/garageflow-template.db`.
  Une base existante illisible est conservée sur place et bloque le démarrage :
  jamais réinitialisée.
- **PostgreSQL** reste au PWA (`prisma/server/`) ; aucune migration PostgreSQL
  n'est exécutée par le poste. Les migrations desktop passent par l'API interne
  SQLite authentifiée, pas par une CLI installée chez le client.
- Arrêt propre : `before-quit` et fermeture des fenêtres tuent le processus
  enfant ; `arretVoulu` distingue nos arrêts d'une mort inattendue (boîte
  « Relancer le service » dans ce second cas).

## 2. Problème détecté et corrigé dans cette session

**`scripts/verify-installer.cjs` ne tenait pas la promesse écrite dans son propre
en-tête.** Ce script annonce qu'il nomme un par un : l'installeur d'une version
précédente, « une archive vide ou tronquée (téléchargement/copie interrompue) »,
un fichier qui n'est pas un exécutable Windows, une charge utile incomplète —
chacun avec sa sortie de secours.

Or les contrôles de taille et d'en-tête vivaient **uniquement** dans `peInfo()`,
qui **lève**. L'exception quittait `main()` avant que la liste `problemes` ne soit
assemblée, et le bloc `if (problemes.length)` avec elle. Conséquence mesurée sur
fixture : un Setup tronqué à 1 Mio — la façon la plus courante dont un
installateur atteint un client, une copie ou un téléchargement interrompu —
produisait

```text
Installeur non livrable : Invalid Windows executable
```

sans taille, sans seuil, sans étape suivante. Le diagnostic n'existait que dans
le commentaire. Le contrôle `if (stat.size < TAILLE_MINIMALE_OCTETS)` écrit juste
après était, lui, **du code mort** : `peInfo()` avait déjà levé pour ce cas.

Correction, additive :

- `scripts/lib/windows-delivery.cjs` expose **`describePe()`**, qui diagnostique
  sans lever et rend un code stable : `ABSENT` · `UNREADABLE` · `NOT_A_FILE` ·
  `EMPTY` · `TRUNCATED_SIZE` · `NOT_MZ` · `PE_OFFSET_OUT_OF_RANGE` ·
  `BAD_PE_SIGNATURE` · `SHORT_READ`. Le seuil de livraison y est distingué du
  seuil de validité : un fichier sous le minimum reste **analysé**, donc une
  souche de 40 Ko est annoncée `TRUNCATED_SIZE` avec les deux nombres plutôt que
  refusée sans explication. Un en-tête PE annoncé au-delà de la fin du fichier
  est classé **troncature**, pas « en-tête invalide » — la nuance dit à
  l'éditeur de reprendre le fichier au lieu de reconstruire.
- `peInfo()` **conserve son contrat de refus** (`inspectNsis()` et `publish()`
  doivent arrêter la chaîne) et porte désormais la cause précise dans son
  message. L'assertion historique `/Invalid Windows/` du test existant continue
  de passer : rien n'a été affaibli pour accommoder le changement.
- `scripts/verify-installer.cjs` passe par `describePe()`, pousse le défaut dans
  `problemes` avec `SECOURS_PE` (« relancer `npm run dist` sur un poste Windows ;
  si le fichier a été copié ou téléchargé, le reprendre à la source et vérifier
  son empreinte »), calcule l'empreinte **même sur un fichier tronqué** — c'est
  elle qui prouve la copie interrompue — et n'atteint l'inspection réelle de la
  charge utile NSIS que si l'exécutable est sain. L'en-tête du verdict dit
  « Artefact inspecté — NON livrable » au lieu d'« Artefact vérifié » quand des
  problèmes existent : un fichier refusé ne s'annonce plus comme vérifié.

**+3 tests** dans `tests/windows-delivery.test.cjs` : les neuf codes de défaut sur
fixtures réelles (absent, vide, déchets non-MZ, PE valide 20× trop petit,
en-tête annoncé hors du fichier, offset PE hors bornes, signature PE absente,
x64 valide, x86 32 bits) ; la conservation du refus `peInfo()` avec sa cause ;
et un **garde de câblage** sur le vérificateur. Ce garde porte sur le **code**,
commentaires retirés — sa première version échouait sur la prose qui explique
pourquoi `peInfo()` n'a plus sa place ici, ce qui aurait été un garde aveugle.

Aucune dépendance ajoutée ou supprimée : `package.json` et `package-lock.json`
inchangés. Aucune règle métier, aucun contrôle de sécurité, aucun seuil
relâché — le refus de livrer un exécutable invalide est strictement identique,
seul son énoncé change.

## 3. Livrable : identité réelle du fichier

Deux identités sont archivées dans [`finalisation/`](finalisation/), et il ne
faut pas les confondre.

**Celle qui fait foi pour cette reprise : le commit `887c212`**, c'est-à-dire
l'arbre qui contient le correctif de diagnostic. Reçu lu depuis `api.github.com`
(annotations du job Windows `117865755234`, run `push` `39191332001`,
`head_sha 887c212a806b64db1b8c10e9b7e9fe01ef06ef3b`, `dirty: false`).

| Champ | Valeur attestée par la CI Windows sur `887c212` |
|---|---|
| Chemin produit | `release/GarageFlows-Setup.exe` |
| Version | 1.1.0 · `commit 887c212` · `dirty: false` |
| Cible | `win32` / `x64`, NSIS offline embarqué |
| **Taille** | **231 063 118 octets** (220,4 Mio) |
| **SHA-256** | **`727cbdc37a435754c7a96eeb552d19a6574e44824ce758240804756ceb9a2383`** |
| Charge utile | **3 045 fichiers**, inventaire **et** empreinte de chacun comparés à `win-unpacked` |
| Extraction | `embedded-7z-sfx` · `payloadVerified: true` · `offlinePayloadEmbedded: true` |
| Signature Authenticode | **`NotSigned`** (`authenticodeVerified: false`) |
| Artefact récupérable | `garageflows-installer-windows-x64`, ZIP de transport 230 792 870 octets, rétention 30 jours |

Ce reçu a une portée précise : `verify:installer` est la **dernière** étape de
`npm run dist`, donc `describePe()` et la promotion atomique dans `release/` ont
réellement tourné dans un build Windows, sur un exécutable de 220 Mio valide,
sans faire échouer la chaîne. Ce qui n'est **pas** démontré par ce run : le
chemin d'erreur. Aucun installeur tronqué n'a été soumis au vérificateur sur
l'exécuteur Windows — ce cas est couvert par les fixtures des tests ajoutés, qui
sont réelles mais locales.

Recette d'installation sur le même commit
([`windows-smoke-887c212.json`](finalisation/windows-smoke-887c212.json)) :
`installExecuted`, `activationWindowOpened`, `restrictedPathLaunch` (CWD vide,
PATH réduit à System32), `sqliteSentinelWritten`,
`installedServerComponentsPassed`, `reinstallPreservedData`,
`uninstallPreservedData`, `installerExitCode: 0`, `installedExePresent` — tous
**vrais**. `licensedBusinessWorkflowTested` et
`cleanOSWithoutBuildToolsTested` restent **faux**, et le reçu le dit lui-même.

**Référence antérieure : `f2370a3`** (HEAD au début de cette reprise), déjà
archivée parce qu'elle manquait au dépôt — taille 231 063 440 octets, SHA-256
`5f24a555f325be7ecae61c0478a5f80368bc552598af2e7a26fba37db8d6a4a1`, mêmes
3 045 fichiers et mêmes conclusions de recette
([reçu](finalisation/delivery-f2370a3.json)). Les deux fichiers diffèrent de
322 octets : le code du vérificateur a changé entre les deux, pas la charge
utile applicative.

Le run `pull_request` de la PR #13 porte un **commit de fusion** généré par
GitHub (`refs/pull/13/merge`), pas la tête de branche : son reçu est archivé
séparément avec cette mise en garde
([`delivery-pr13-merge-commit.json`](finalisation/delivery-pr13-merge-commit.json)),
parce que confondre les deux ferait attribuer à une branche une empreinte qui
n'est pas la sienne.

Le commit qui archive ces reçus est postérieur au SHA qu'ils attestent, et
**n'hérite pas** de sa validation CI : il ne modifie que des documents et des
preuves.

**Le binaire n'a pas été rapatrié dans ce sandbox** : les artefacts et journaux
d'actions redirigent vers `productionresultssa1.blob.core.windows.net` et
`results-receiver.actions.githubusercontent.com`, hors de la liste d'hôtes
autorisée — `EOF`, zéro octet reçu. Aucun EXE local n'a été créé, et aucune
empreinte n'a été recalculée ici : celle du tableau vient du reçu du fichier
réellement produit.

## 4. Configurations finales (relues sur le dépôt, conformes à la mission)

**Electron Builder** — `appId com.garageflow.app` et `productName GarageFlows`
inchangés ; `asar: true` ; `asarUnpack` pour `query_engine-windows*` et
`@prisma/engines/**` ; `directories.output: dist` ; `extraResources` =
`.next/standalone` → `standalone`, `prisma/{schema.prisma,garageflow-template.db}`,
`keys/public.pem` (public seul), `icon.ico` ; exclusions `!**/.env*`, `!**/*.pem`,
`!**/*.key`, `!**/*.log`, `!**/*.map`, variantes `.bak/.old/.orig/.rej/~/.tmp` ;
`afterPack: scripts/afterPack.js` ; `win.requestedExecutionLevel: asInvoker`.

**NSIS** — `oneClick: false`, `perMachine: false`, `allowElevation: false`,
`allowToChangeInstallationDirectory: false`, **`artifactName:
GarageFlows-Setup.exe`** (nom fixe, sans version), `createDesktopShortcut:
always`, `createStartMenuShortcut: true`, **`deleteAppDataOnUninstall: false`**,
`include: scripts/installer.nsh`. Le `.nsh` ne définit plus `customInit` (il
désinstallait avant toute confirmation) ; les raccourcis sont recréés
explicitement avec `SetLnkAUMI`, et `customUnInstall` — orthographe exacte
attendue par electron-builder — retire les raccourcis et la clé de registre sans
toucher `%APPDATA%\GarageFlow`.

**Séparation dist/release** — `dist/` reste la sortie interne du builder
(intermédiaires, `win-unpacked`, blockmap, YAML) ; `release/` ne contient **que**
`GarageFlows-Setup.exe`, promu par copie atomique après contrôles, avec refus et
**préservation** (jamais suppression) d'un fichier étranger. Les deux sont
ignorés par Git (`/release/`, `dist/`, `/artifacts/windows-delivery/`).

## 5. Commandes

Éditeur, depuis un checkout propre **sur Windows x64**, Node 22 + npm 11.16.0 :

```powershell
npm ci
npm run lint
npm run typecheck
npm test
npm run dist
```

`npm run dist` échoue à la première étape en erreur :
`preflight:release` → `GF_PACKAGE_DESKTOP=1 npm run build` (+ `postbuild`) →
`verify:standalone` → `electron-builder --win --x64 --publish never` →
`check:artifact-secrets` → `check:artifact-fuses` → `verify:installer` (qui
inspecte la charge utile réellement embarquée puis promeut dans `release/`).

Client : télécharger **uniquement** `GarageFlows-Setup.exe`, lancer l'assistant,
utiliser le raccourci, activer sa licence. Aucun dossier `dist`, `node_modules`
ou source, aucun Node, npm, Python, base serveur ni fichier `.env`.

## 6. Tests réellement exécutés dans cette session

Reçu machine : [`finalisation/local-validation.json`](finalisation/local-validation.json).

| Contrôle | Résultat mesuré ici |
|---|---|
| Suite Node `tests/*.cjs` | **434/434 verts, 0 rouge, 0 ignoré** (431 avant mes 3 tests) |
| Vitest ciblé distribution/licence (6 fichiers : mise à jour, chaîne de signature, chemin de données, sauvegarde pré-migration, aller-retour émetteur, cohérence monétaire) | **66/66 verts** |
| `npm run test:release-safety` | exit 0 |
| ESLint (`src`) | exit 0, aucune erreur |
| Cohérence documentaire | exit 0 (225 `.md` scannés) |
| Marque | exit 0 (1 089 fichiers) |
| Aller-retour réel keygen Python → vérificateurs Node/Electron | **5/5 verts** après restauration de `.venv` (§7) |
| Vitest global | 4 237 tests : **3 354 verts, 4 rouges, 879 ignorés** ; 84 fichiers non collectables. Les 4 rouges viennent de `prepare-test-db` (moteur Prisma téléchargeable injoignable), pas du code |
| `tsc --noEmit` | **non concluant ici** : exit 1, 224 erreurs, toutes `TS2305/TS2307` d'absence du client Prisma généré. Attesté vert par la CI sur ce même arbre |
| Build Next.js, `prisma generate`, packaging NSIS, inspection du Setup, installation Windows | **non exécutés ici** — voir §7. Attestés par la CI sur `f2370a3` |

Rien n'est déclaré testé qui ne l'ait été : aucune compilation Windows, aucune
installation NSIS et aucun démarrage d'Electron n'a eu lieu dans ce sandbox.

## 7. Ce que cet environnement ne pouvait pas faire

- **`binaries.prisma.sh` est hors liste d'hôtes autorisée** : `prisma generate`
  **et** `prisma generate --no-engine` échouent tous deux sur le TLS (le second
  récupère quand même l'empreinte du moteur). D'où le `tsc` non concluant et les
  84 fichiers de tests d'intégration non collectables. Ce n'est pas attribuable
  au code : les jobs CI correspondants sont `SUCCESS` sur `f2370a3`.
- **Ni Windows ni Wine** : `electron-builder --win` ne peut pas fabriquer
  l'installateur ici. La fabrication et la recette restent le fait de
  l'exécuteur Windows de la CI, ou d'un poste éditeur.
- **Artefacts et journaux d'actions non téléchargeables** (hôtes de stockage hors
  liste). Les reçus ont été lus via `api.github.com` — annotations de job et
  métadonnées —, ce qui suffit à l'identité du livrable mais ne remplace pas le
  fichier.
- **Un blocage a été levé, pas contourné** : `cryptography` manquait, ce qui
  faisait échouer l'aller-retour keygen Python → vérificateurs Node. Restauré
  dans `.venv` (gitignoré) depuis `tests/requirements-keygen.txt` avec
  `--require-hashes --only-binary=:all:` sur PyPI, l'hôte autorisé. Le test passe
  réellement : la licence ECDSA P-256 émise par le vrai keygen Python est
  acceptée par les vrais vérificateurs du poste.

## 8. Exclusions du package (vérifiées par la chaîne, pas déclarées)

Aucune clé privée de licence ni de mise à jour, aucun `.env`, aucun outil ou
interface Python de keygen (`keygen*.py`), aucune base émettrice
(`licenses_db.json`, `server_config.json`), aucun état éditeur. Le refus est
double : exclusions `files` du builder **et** contrôle de l'arbre + de l'ASAR par
`inspectNsis()` (motif interdisant `.env`, `.pem`, `.key`, keygen et bases
émettrices), plus `check:artifact-secrets` qui détecte aussi les PEM multilignes
et Ed25519 et n'ignore pas les gros fichiers. `keys/public.pem`, seul élément
nécessaire à la vérification des signatures, est restauré au préflight depuis les
ancrages concordants — **sans génération ni rotation de paire**.

## 9. Mises à jour

Le protocole existant est conservé : manifeste **Ed25519** signé, `sha256` +
`size`, `product`/`channel`/`platform`/`architecture`, anti-downgrade strict,
palier `minVersion` **effectivement refusé** avant tout téléchargement, URL en
HTTPS sur hôte autorisé uniquement (`api.garageflows.fr`, `garageflows.fr`,
`app.garageflows.fr`), revalidation à **chaque** redirection, nom de fichier
assaini (un `%2E%2E%5C…` ne peut plus écrire hors du dossier temporaire),
tentative mémorisée 6 h et purge des installateurs abandonnés de plus de 7 jours.
**`electron-updater` n'a pas été introduit** : il n'apporterait rien que ce
protocole ne couvre déjà, et il signerait moins strictement.

Deux limites à connaître avant de publier :

- les clés publiques embarquées sont `gf-update-2026` (clé privée introuvable :
  plus aucune release ne peut être signée par elle, mais l'ancre reste le seul
  chemin de réparation du parc antérieur au 15/08/2026) et `gf-update-2026-2`
  (clé courante, privée hors dépôt). Un poste installé avant cette date ne
  connaît que la première.
- la version reste **1.1.0** : pour un parc déjà en 1.1.0, une nouvelle
  publication exige d'augmenter la version produit, sans quoi l'anti-downgrade la
  refuse à juste titre.

Décision du propriétaire prise dans cette session : **pas de release GitHub
publique, pas de workflow de publication automatique.** La fabrication reste
`npm run dist` sur poste éditeur, ou le job Windows de la CI ; le canal de
récupération est documenté dans
[`docs/WINDOWS_DISTRIBUTION.md`](../../WINDOWS_DISTRIBUTION.md).

## 10. Limites ouvertes — non levées par cette session

- **Authenticode absent** : l'installateur est `NotSigned`, donc SmartScreen
  avertira « Éditeur inconnu » après un téléchargement Internet. Aucun
  certificat, aucune clé de signature de code n'a été fabriquée pour masquer ce
  fait. Lever le blocage = acquérir un certificat OV/EV, le fournir à
  electron-builder (`CSC_LINK`/`CSC_KEY_PASSWORD`), rejouer `npm run dist`.
- **Aucune session métier licenciée** n'a été ouverte par la recette : le test
  s'arrête volontairement à la fenêtre d'activation réelle. Ni licence de
  production, ni autorité réelle, ni PC physique d'usine sans outils de build.
- **`Required validation` reste `FAILURE`** : son seul maillon rouge est
  `Authenticated browser validation`, qui échoue sur `MISSING_INPUT:BASE_URL` —
  l'environnement de staging approuvé et ses fixtures ne sont pas provisionnés.
  Ce n'est pas une régression et cela n'a pas été masqué : le job exige
  explicitement une cible non-production approuvée et refuse de deviner.
- **CodeQL : 9 résultats (2 high, 7 medium)**, aucun supprimé ni *dismissed*. Le
  job d'analyse est `SUCCESS` ; le check rouge est la porte « nouvelles alertes
  dans le code modifié par la PR », et comme `main` est deux commits en retard,
  le diff couvre l'arbre entier — GitHub le signale lui-même (« alerts not
  introduced by this pull request might have been detected because the code
  changes were too large »). Localisation relevée : `scripts/config-core.cjs:97`
  et `:147`, `scripts/lib/config-credentials.cjs:11`, `electron/http-json.js:92`,
  `electron/main.js:614` et `:2118`, `scripts/config-services.cjs:153`,
  `scripts/test-installed-server.cjs:90`, `src/lib/sync/cloud-client.ts:87`. Les
  deux emplacements du processus principal distribué portent déjà leurs
  mitigations (journal expurgé des URL et des caractères de contrôle ; état de
  blocage **signé HMAC** et relu avec vérification, à chemin fixe) : les modifier
  sans pouvoir exécuter l'application packagée aurait ajouté du risque plutôt que
  d'en retirer. Rien n'est annoncé résolu.
- Les **volumes bulk non bornés** de la synchronisation cloud restent ouverts
  (conservés délibérément au lot précédent pour ne pas casser les lots de
  preuves historiques) : risque mémoire non certifié clos.

## 11. Verdict

La chaîne de distribution demandée par la mission existe, est cohérente, et a
produit un fichier réel recetté sur Windows : un **seul** `GarageFlows-Setup.exe`,
autonome, qui installe, crée sa base dans le dossier utilisateur, survit à une
réinstallation et à une désinstallation sans perdre les données. Cette session a
archivé les reçus de CE build, réparé un diagnostic qui ne disait rien, et
vérifié localement ce qui pouvait l'être.

Ce n'est **pas** une autorisation de distribution production : l'installateur
n'est pas signé, aucune session métier licenciée n'a été exercée, et deux
contrôles de la CI restent rouges pour des causes externes documentées ci-dessus.
