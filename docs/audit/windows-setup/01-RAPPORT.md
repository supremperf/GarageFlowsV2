<!-- doc-numbers: journal -->
# GarageFlows-Setup.exe — rapport de fabrication et de recette

**Reprise ultérieure : [correctifs sécurité, résultats CodeQL et nouveau candidat Windows6087458](02-REPRISE-SECURITE.md).** Les identités ci-dessous restent celles du build5a10e96, pas du nouveau fichier.

## Résultat technique : Setup réel fabriqué et recette Windows réussie

**Candidat de distribution, pas une autorisation de publication production.** Le job Windows du commit **5a10e96396ba2a78e447a65959cf5491fa5d8a67** est **SUCCESS**, avec une véritable installation/lancement/recette serveur/réinstallation/désinstallation. Le verdict global du dépôt reste NO-GO (E2E authentifié et résultats CodeQL bloquants). Aucun merge, déploiement Vercel ou publication de release/update production.

### Livrable réel

| Champ | Valeur attestée par la CI Windows |
|---|---|
| Fichier | **release/GarageFlows-Setup.exe** |
| Version | 1.1.0, identités applicatives historiques conservées |
| Cible | Windows x64, NSIS offline embarqué |
| Taille EXE | **231057824 octets**, soit **220.4 Mio** |
| SHA-256 | **faf8c3e6ddb8534125469795f70cefd5b75d596431775f6d122d62a08d615c59** |
| Charge embarquée | **3045 fichiers**, inventaire et SHA256 de chacun comparés à win-unpacked |
| Signature Windows | **NotSigned**, constaté par Get-AuthenticodeSignature |
| Build | Arbre propre, commit5a10e96, Node22/npm11.16, Next15.5.27, Electron41.10.6, Prisma5.22, Builder26.15.3 |

- **[Télécharger l’artefact contenant uniquement le Setup](https://github.com/supremperf/GarageFlowsV2/actions/runs/39144372534/artifacts/12143410620)** — GitHub Actions enveloppe l’EXE dans un ZIP de transport (230787648octets), pas dans un dossier de sources/ressources. L’éditeur extrait et distribue **le seul EXE** au client. Durée de rétention configurée30jours, connexion GitHub éventuellement requise.
- [Recette Windows et build exacts](https://github.com/supremperf/GarageFlowsV2/actions/runs/39144372534/job/117726161834).
- [Artefact séparé de reçus techniques](https://github.com/supremperf/GarageFlowsV2/actions/runs/39144372534/artifacts/12141969997), sans données utilisateur ni secrets.
- [Identité/taille/hash](evidence/delivery.json), [installation réelle](evidence/windows-install-smoke.json), [serveur réellement installé](evidence/installed-server.json), [jobs du SHA testé](evidence/ci-tested-5a10e96.json), [diagnostic de fabrication expurgé](evidence/packaging-tested-5a10e96.json).

**Le binaire n’a pas été rapatrié dans ce sandbox Linux** : tentative de téléchargement API GitHub, exit1/zéro octet ; pas de faux fichier EXE créé. Le chemin release/... est celui réellement produit dans le build Windows. Le hash/taille ci-dessus proviennent du reçu du véritable fichier produit ; ils ne sont pas des valeurs inventées ni le hash du ZIP. La livraison récupérable est l’artefact GitHub, pas une promesse de compilation future.

## 1. Audit initial et architecture retenue

[Audit avant modifications](00-ARCHITECTURE-AVANT-MODIFICATION.md). Lecture intégrale du package, main4460lignes, preload153lignes, Nextconfig, scripts/NSIS/hooks et frontières DB/licence/données. Départ f56e759, branche de session et distante identiques, arbre propre ; main e3ac5f5 ancienne. La chaîne était déjà Electron + Next standalone + NSIS, adaptée à ce projet : elle a été corrigée, pas remplacée par une autre technologie.

ASAR contient Electron/preload/HTML et dépendances production, les ressources physiques contiennent le standalone et les moteurs natifs. Le serveur utilise **utilityProcess.fork et le Node d’Electron**, pas un Node/Python/npm du client. Écoute uniquement127.0.0.1, origine renderer localhost forcée IPv4 pour les redirections/cookies Next.

SQLite reste dans **%APPDATA%\GarageFlow\garageflow.db**, nom historique épinglé pour conserver données/licence/secrets. Le PWA garde PostgreSQL et sa chaîne Vercel ; pas de migrations PostgreSQL exécutées par Desktop. Les traductions et modules métier n’ont pas été supprimés/remplacés.

## 2. Défauts détectés et corrections structurelles

1. Nom de Setup versionné et mélange dist/intermédiaires/client : nom NSIS fixé à GarageFlows-Setup.exe, promotion atomique après contrôles vers release contenant **un seul fichier** ; reçus ailleurs, refus/préservation des fichiers étrangers plutôt que suppression.
2. Ancien vérificateur : seulement MZ/taille + dossier voisin. Nouveau contrôle : PE et EXE applicatif AMD64, extraction de la **charge7z réellement embarquée** puis comparaison de tous les chemins/hashs. Le lecteur7za reconnaît ici directement le fluxSFX ; pas de confiance dans un nom interne app-64.7z ni dans un EXE renommé.
3. Ancien chemin7zip-bin obsolète : utilisation du toolset checksummé de Builder26 déjà utilisé par la fabrication. Un listing/extracteur échoué fait désormais échouer le contrôle, jamais succès avec avertissement.
4. **Défaut réel reproduit en installation : Cannot find module 'next' depuis resources/standalone/server.js**, malgré la présence de package.json. [Preuve du candidat en échec](evidence/intermediate-installed-server.json). La garde n’était pas fautive : le résolveur original Node échouait avant son contrôle. Le client/moteur .prisma était lui aussi absent de son emplacement physique. Remise explicite de la fermeture Next tracée et du client Windows **après le filtrage des extraResources**, validation des résolutions dans le payload ; repli complet production d’ASAR seulement si nécessaire. Le build final atteste **source: next-traced-closure**, pas l’arbre de développement. Aucune copie ad hoc d’un seul next.js ni NODE_PATH vers le dépôt.
5. Attente du serveur anciennement fail-open/non bornée par requête : délai global/requêtes/corps bornés, défi HMAC lié à la clé interne aléatoire du processus, health200 et DB connectée requis ; décès du processus interrompt l’attente ; timeout ne poursuit plus migrations/fenêtre métier. Arrêt explicite à before-quit conservant le nettoyage existant.
6. Pas de .env de projet lu/créé en build packagé. Public.pem restauré depuis les ancres concordantes au préflight, **sans génération/rotation de paire**. Aucune clé privée licence/update, outil Python keygen ou base émettrice dans le package ; contrôles ASAR/arbre + clés PEM multilignes/Ed25519 et gros fichiers renforcés.
7. Une DB existante illisible est **conservée sur place**, jamais silencieusement renommée/réinitialisée ; création initiale exclusive (COPYFILE_EXCL). NSIS conserve userData à la désinstallation.
8. Notice tierce incluse dans ASAR. Signature de mises à jour existante maintenue, aide release:sign adaptée au nouveau chemin. Ni nouvelle dépendance ni suppression de dépendance : package-lock inchangé ; ASAR/toolset proviennent de Builder existant.

Les échecs intermédiaires ne sont pas masqués : fixture dotenv isolée sans app adaptée et complétée par le cas packagé ; cinq variables du harnais classées plateforme ; chemin historique lu depuis sa constante plutôt que renommé pour passer la marque ; 7zip/format et runtime manquant conservés dans les preuves. La projection production large a produit un candidat301.3Mio dont l’installation n’a pas été validée : pas présenté comme livrable final. Le candidat final remet la fermeture **tracée** après filtrage,220.4Mio, et passe le parcours complet.

## 3. Configuration finale et fichiers modifiés

[Configuration Builder complète](evidence/electron-builder-config.json). NSIS : oneClick=false, perMachine=false, allowElevation=false, allowToChangeInstallationDirectory=false, deleteAppDataOnUninstall=false, raccourcis Bureau/MenuDémarrer, icône officielle, artifactName=GarageFlows-Setup.exe, include scripts/installer.nsh. **appIdcom.garageflow.app et noms de données/registres historiques inchangés** ; ASAR/fuses/intégrité enforced conservés. Dist reste la sortie interne du builder, release la livraison unique.

Fichiers : package.json/.gitignore ; electron/main.js et nouveau server-ready.js ; health/route.ts (défi local, réponse publique PWA inchangée) ; scripts afterPack, postbuild/préflight, verify-installer, scanner secrets/signature, nouvelles bibliothèques windows-delivery/installed-runtime-modules/private-key-material ; harnais test-windows-setup.ps1 et test-installed-server.cjs ; workflow Windows ; tests Node et fixture dotenv ; manifeste d’environnement/registre généré ; README/guide/rapports/baseline. Liste et hashes archivés dans les preuves. **Aucun module métier/langue/DB existante retiré.**

## 4. Commandes

Éditeur Windows : `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, **npm run dist**. Aucun de ces outils n’est requis chez le client. Procédure détaillée : [guide](../../WINDOWS_DISTRIBUTION.md).

Client : télécharger uniquement GarageFlows-Setup.exe depuis le canal validé de l’éditeur, lancer l’assistant utilisateur, puis le raccourci ; activer normalement sa licence. Aucun dossier dist/node_modules/source ni fichier de configuration supplémentaire à récupérer.

## 5. Tests réellement exécutés

| Contrôle | Résultat et périmètre |
|---|---|
| Build standard + budget, TypeScript/ESLint, schemas/migrations/tests SQLite/PostgreSQL/Redis | **SUCCESS en CI5a10e96**, métadonnées de jobs conservées |
| Packaging NSIS x64 | **SUCCESS**, EXE réel231057824octets |
| Contenu réel du Setup | **3045fichiers/hashs comparés**, payload offline présent,7fuses conformes, scan secrets passé |
| Installation réelle Windows | **SUCCESS**, lancement EXE installé/activation réelle, PATH système et CWD vide |
| Serveur/API depuis installation | **SUCCESS**, résolution de modules confinée au payload ; health/clé interne, refus sans clé, lecture/export fixture SQLite, sauvegarde relue, static et migration interne |
| Données et arrêt | **SUCCESS**, fermeture normale sans processus restant, relance/réinstallation même version/désinstallation avec conservation DB/sentinelle/secrets vérifiés |
| Node local | **407/407**, aucun skip, [sortie](evidence/node-tests.txt) ; inclut2modes de projection d’ASAR/trace réels avec transitive et client natif préservés |
| Ciblés locaux |38/38 Node et49/49 Vitest initiaux,24/24 guards docs/baseline ; types/lint/cohérence/env0 |
| Globale locale |3370/4222,3assertions preparationDB échouées TLS Prisma,849pending,79fichiers empêchés ; [preuve](evidence/local-global.json), pas une suite locale entièrement verte |
| Audit npm complet / Gitleaks |0npm etSUCCESS Gitleaks CI ; **ne signifie pas0alertes GitHub sur main** |
| Signature Windows |**NotSigned** ; pas de faux certificat/clé fabriqué pour ce résultat |

Le serveur installé est testé avec **le Node du runner comme outil de recette** ; il ne peut pas emprunter de modules au checkout. Le GUI installé est lancé sans outils sur PATH mais s’arrête volontairement à l’activation sécurisée. Le test ne prétend pas avoir ouvert une session métier licenciée en production. Le runner Windows contient des outils de build : **pas de test revendiqué d’un PC physique d’usine sans outils**. Pas de test de tous les scénarios métier ni de toutes les migrations inter-versions : ici réinstallation même version + suites automatiques existantes.

## 6. Updates, exclusions et verdict

L’EXE embarque les ressources statiques, icônes,14langues et modules nécessaires, moteur/client SQLite hors ASAR et runtime Electron. Sont exclus les privés, .env, outils/interfaces Python keygen et états/bases émetteur ; les fonctionnalités web administrateur existantes ne sont pas supprimées et conservent leurs gardes ; les secrets propres au poste sont créés dans userData, pas livrés dans le Setup. Conservation des fichiers/ancres publics nécessaires.

Le canal existant exige Ed25519 + hash/taille et contrôles de versions/canal/URL. Pas d’electron-updater ajouté ni de manifeste signé avec une nouvelle clé improvisée. L’aide pointe vers release/GarageFlows-Setup.exe ; les futures URLs doivent être immuables par version. La candidature conserve version1.1.0 : augmenter la version avant une vraie nouvelle publication pour les postes déjà en1.1.0. Canal de publication/signature éditeur et repli GitHub historique non attestés de bout en bout ; aucune mise à jour production publiée.

**Transformation de packaging implémentée, candidat réel fabriqué et recette Windows ci-dessus réussie. Mission globale de distribution production non clôturée** : Authenticode/SmartScreen après téléchargement Internet, session métier avec licence/autorité réelles, PC d’usine sans outils et validation métier exhaustive restent non attestés ; E2E authentifié/CodeQL et151alertes main restent ouverts, [rapport sécurité](../security-151/02-VERDICT-ET-INTEGRATION.md). **NO-GO production maintenu**, aucune fusion forcée ni déploiement. Les modifications documentaires/tests postérieures au SHA testé ne reçoivent pas artificiellement sa validation CI.
