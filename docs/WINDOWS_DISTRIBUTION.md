# Distribution Windows — un seul GarageFlows-Setup.exe

## Client Windows x64

Le fichier client est **`GarageFlows-Setup.exe`**. Il contient l’application Electron, son runtime Node intégré, Next standalone et les API locales, Prisma/moteur Windows, le modèle SQLite vide, les images/statics et les traductions. **Ne distribuez ni les sources ni dist/win-unpacked ni node_modules.** Le client n’installe ni Node, npm, Python, une base serveur, ni un fichier .env.

L’assistant NSIS installe par utilisateur, crée les raccourcis Bureau/Menu Démarrer et le désinstalleur. Une licence valide et l’accès à l’autorité pour l’activation restent requis ; le Setup ne fournit pas une licence gratuite. Les comptes de services externes (mail/IA/cloud…) restent ceux du garage et ne sont pas des outils de développement à installer.

Les données restent dans **`%APPDATA%\GarageFlow\`** (nom historique volontaire, malgré la marque GarageFlows) : garageflow.db, photos, sauvegardes, préférences, secrets locaux et licence chiffrée. Ne changez pas appId ni ce chemin pour renommer le Setup. La désinstallation retire le programme/raccourcis, pas ces données. Une base existante illisible est conservée sur place et bloque le démarrage, jamais réinitialisée pour faire fonctionner une installation.

## Fabrication — éditeur uniquement

Depuis un checkout propre **sur Windows x64**, avec Node22 et npm11.16.0 :

```powershell
npm ci
npm run lint
npm run typecheck
npm test
npm run dist
```

`npm run dist` conserve la chaîne existante et échoue à la première étape en erreur :

1. Préflight : restaure uniquement le PEM **public déjà embarqué**, contrôle les ancres concordantes, icône, template et absence de privés. Ne génère/rotate aucune paire.
2. Build Next et génération des clients Prisma, postbuild standalone/statics/public/schema/template ; Vercel ignore toujours ces opérations desktop.
3. Contrôle standalone puis electron-builder : Windows x64, `nsis` offline (pas nsis-web), ASAR et ressources natives, appId `com.garageflow.app`, `artifactName: GarageFlows-Setup.exe`, perMachine/allowElevation/deleteAppDataOnUninstall=false.
4. `afterPack` remet physiquement la **fermeture de dépendances tracée par Next** dans `resources/standalone/node_modules`, après filtrage des ressources par Builder. Si ses entrées indispensables sont incomplètes, il dispose du repli vers la fermeture production d’app.asar, jamais vers les dépendances de développement. Le client `.prisma` Windows généré est copié explicitement après ce filtrage. Résolution de next/react/react-dom/Prisma obligatoirement dans le payload ; aucun emprunt au checkout. Cette étape précède le scellement d’intégrité. Les contrôles secrets/fuses/intégrité sont conservés ; le scan détecte aussi les PEM multilignes/Ed25519 et n’ignore pas les gros fichiers.
5. Vérification PE du Setup et de l’EXE x64, extraction effective de la charge7z embarquée (directement si le lecteur reconnaît le flux SFX, sinon via l’archive NSIS identifiée par sa signature), comparaison **de chaque fichier et SHA256** de la charge avec win-unpacked. Refus des outils keygen/états éditeur/env dans l’arbre et l’ASAR.
6. Copie atomique de l’EXE vérifié vers `release/GarageFlows-Setup.exe`. **release ne contient que ce fichier.** Les fichiers étrangers sont refusés et préservés, pas supprimés automatiquement.

Sorties :

```text
dist/                              # intermédiaires, win-unpacked, blockmap, YAML…
release/GarageFlows-Setup.exe        # seul fichier destiné au client
artifacts/windows-delivery/         # reçus techniques JSON, pas de données utilisateur
```

Ces sorties sont ignorées par Git. Aucun installateur n’est ajouté aux commits. Taille/SHA/version/commit se trouvent dans `artifacts/windows-delivery/delivery.json`, et sont aussi annoncés en CI. Ne pas faire passer un simple fichier MZ ou un ancien EXE renommé pour une nouvelle fabrication.

`verify:installer` nomme le défaut avant de refuser : un Setup tronqué par une copie ou un téléchargement interrompu est annoncé `TRUNCATED_SIZE` avec sa taille réelle, le seuil attendu et l’étape suivante, au lieu d’un « Invalid Windows executable » sans aucune indication. Les codes possibles sont `ABSENT`, `UNREADABLE`, `NOT_A_FILE`, `EMPTY`, `TRUNCATED_SIZE`, `NOT_MZ`, `PE_OFFSET_OUT_OF_RANGE`, `BAD_PE_SIGNATURE`, `SHORT_READ`. L’empreinte est calculée même sur un fichier refusé : c’est elle qui prouve la copie interrompue.

## Récupérer le Setup fabriqué par la CI

Aucune release GitHub publique n’est publiée et aucun workflow ne publie à la place de l’éditeur : c’est un choix explicite, pas un oubli. Le job Windows dépose néanmoins le fichier réel en artefact à chaque poussée sur `main`, `master`, `develop`, `claude/**`, `integration/**` et `arena/**`.

```bash
gh run list --workflow ci.yml --branch main --limit 5
gh run download <run-id> --name garageflows-installer-windows-x64 --dir ./recu
# ./recu/GarageFlows-Setup.exe — l’archive ZIP de transport GitHub est déjà défaite par gh
```

L’artefact ne contient **que** l’EXE. Sa rétention est de **30 jours** : au-delà, il faut relancer le job plutôt que de ressortir un ancien fichier. Les reçus techniques (identité, recette d’installation, serveur installé) sont dans l’artefact séparé `garageflows-windows-validation`, jamais dans celui du client.

Vérifier avant de distribuer, sans faire confiance au nom du fichier :

```bash
sha256sum ./recu/GarageFlows-Setup.exe   # à comparer au SHA-256 du reçu delivery.json du même run
```

Le canal de distribution vers les garages reste celui de l’éditeur (hébergement sur un domaine autorisé par `electron/update-verify.js` pour que la mise à jour intégrée fonctionne, ou remise directe du fichier). Publier l’EXE sur un hôte qui n’est pas dans cette liste ne casse pas l’installation manuelle, mais l’application refusera cette URL comme source de mise à jour.

## Démarrage autonome et sécurité

Le processus principal crée/relit ses secrets locaux, vérifie l’intégrité enforced, conserve/crée la base utilisateur puis prépare sa sauvegarde. L’activation ECDSA-P256/HWID/appareil reste obligatoire. Le serveur s’exécute via `utilityProcess.fork`, **avec le Node d’Electron**, et écoute uniquement127.0.0.1. L’origine du navigateur reste localhost, résolue vers127.0.0.1 pour rester compatible avec les redirections Next et les cookies.

Le démarrage exige un health200/DB connectée et un défi HMAC lié à la clé interne aléatoire de **ce** processus : un serveur tiers sur4028 ne suffit pas. Requêtes/buffer/délai total bornés ; décès du utility process interrompt l’attente, timeout bloque l’ouverture. Aucune migration ni fenêtre métier après cet échec. `before-quit` et la fermeture des fenêtres arrêtent le serveur ; les fuses/ASAR, record-MAC, autorité distante et protections anti-revocation ne sont pas désactivés.

Le schéma desktop utilise SQLite ; le serveur PWA conserve son schéma PostgreSQL. Les migrations du poste passent par l’API interne SQLite protégée, pas par une CLI Prisma/npm/Python installée chez le client.

## Validation Windows automatisée

Le job Windows existant garde ses prérequis et vérifications. Après build, il exécute `scripts/test-windows-setup.ps1` sur son runner jetable :

- refuse un profil GarageFlow déjà présent ; aucune donnée réelle n’est effacée ;
- installation silencieuse du **vrai Setup**, lancement de l’EXE installé depuis un CWD vide et avec PATH limité à Windows/System32 ;
- apparition de la fenêtre d’activation réelle, création de SQLite depuis les ressources, fermeture normale sans processus résiduel ;
- sentinelle SQL, composants du serveur **installé** (modules interdits hors du payload, export/API interne authentifiée, backup SQLite relu, static et migration SQLite) ;
- relance, réinstallation de la même version, désinstallation, puis contrôle de conservation de la base/sentinelle/secrets.

**Distinctions impératives :** le composant serveur est testé avec le Node du runner comme outil de recette, pas comme dépendance du client. Le test GUI prouve le lancement installé jusqu’à l’activation, pas une session métier licenciée. Le runner dispose d’outils de build même si leur PATH est retiré au lancement : ce n’est pas un PC physique d’usine sans outils. Une réinstallation de même version ne prouve pas toutes les migrations inter-versions. Lire les reçus pour les étapes effectivement passées : un test écrit n’est pas un test exécuté.

GITHUB_ACTIONS, RUNNER_OS et RUNNER_TEMP viennent de GitHub ; GF_WINDOWS_SMOKE_ISOLATED est l’autorisation explicite du job jetable ; GF_SETUP_SMOKE_DB est le chemin temporaire transmis à l’outil SQL de recette. Ils sont classés harnais/plateforme au manifeste d’environnement. **Ne pas les configurer dans l’application cliente, Vercel ou un .env de production.**

L’artefact CI client ne contient que l’EXE ; un deuxième artefact distinct contient les reçus JSON, jamais userData, clé locale, jeton ou log brut. GitHub Actions enveloppe les téléchargements d’artefacts dans une archive ZIP de transport : l’éditeur en extrait l’EXE pour son canal de distribution ; ce ZIP n’est pas un dossier de ressources à faire installer par le client.

## Mises à jour et signature

Le protocole existant Ed25519 + SHA256/taille, canal/plateforme/version, anti-downgrade et URLs autorisées est conservé ; pas d’introduction d’electron-updater. Le nouveau nom fixe n’empêche pas le versionnement du manifeste. Publier à une **URL immuable par version**, par exemple `/downloads/1.1.1/GarageFlows-Setup.exe`, et augmenter la version produit avant une vraie nouvelle publication : la version de candidature1.1.0 n’est pas une update pour un poste déjà en1.1.0.

```powershell
npm run release:sign -- --file release/GarageFlows-Setup.exe --version <version-package> --download-url <URL-HTTPS-autorisée>
```

Les clés privées licence/update restent chez l’éditeur, jamais dans l’EXE. Le build ne signe pas de manifeste avec une nouvelle clé improvisée. **Signature de manifeste Ed25519 ≠ signature Windows Authenticode.** Sans certificat éditeur disponible, aucune signature Authenticode n’est prétendue et SmartScreen peut avertir. La fabrication ne publie pas de release GitHub/serveur de mise à jour et ne déploie pas Vercel automatiquement.

## Statut et limites

Le rapport le plus récent est [la reprise de livraison](audit/windows-setup/05-REPRISE-LIVRAISON.md) : identité réelle du fichier fabriqué sur le HEAD courant, tests effectivement exécutés, ce que l’environnement ne pouvait pas faire, et limites ouvertes. Les rapports précédents — [fabrication et recette](audit/windows-setup/01-RAPPORT.md), [sécurité](audit/windows-setup/02-REPRISE-SECURITE.md), [transport](audit/windows-setup/03-REPRISE-TRANSPORT.md), [synchronisation](audit/windows-setup/04-REPRISE-SYNCHRONISATION.md) — restent valables pour les identités de build qu’ils attestent, qui ne sont pas les mêmes fichiers. Les [blocages sécurité préexistants](audit/security-151/02-VERDICT-ET-INTEGRATION.md) ne disparaissent pas parce qu’un Setup est fabriqué. Ne pas confondre **candidat de packaging validé** et autorisation de distribution production, absence de toute régression métier ou correspondance prouvée de la clé privée de l’autorité réelle.

Trois faits à ne pas perdre de vue avant de remettre ce fichier à un garage :

- l’installateur est **`NotSigned`** — SmartScreen avertira « Éditeur inconnu » après un téléchargement Internet ; lever ce point exige un certificat Authenticode, pas du code ;
- la recette CI s’arrête à la **fenêtre d’activation réelle** : aucune session métier licenciée n’a été ouverte, ni sur autorité de production, ni sur un PC physique d’usine dépourvu d’outils de build ;
- la version produit reste **1.1.0** : un parc déjà en 1.1.0 refusera cette candidature à juste titre (anti-downgrade). Augmenter la version avant toute nouvelle publication réelle.
