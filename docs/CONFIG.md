# Config — configuration complète GarageFlow

## Ouvrir et lancer

**Windows : double-cliquer sur `config.cmd`** (souvent affiché « config » lorsque les extensions sont masquées). Linux/macOS : `./config` ou `node config`. Depuis le dépôt :

```sh
npm run config
```

Le fichier **`config` à la racine lance désormais le mode complet par défaut**, pas une suite de réglages manuels. **Node.js 22 et npm** sont les seuls prérequis du lanceur ; si Node est absent, le lanceur Windows le signale et conserve le message à l’écran. Il ne lance pas un installateur système privilégié sans autorisation.

Une fois le plan affiché, saisir **`AUTORISER`**. Ensuite, les étapes techniques s’enchaînent. Les demandes supplémentaires concernent des accès, la sélection d’une cible ambiguë, des secrets non récupérables ou une opération risquée : création de ressource, nouvelle autorité de licence, première licence admin, migration d’une base utilisée, nouveau canal de signature. Aucun compte, mot de passe fournisseur ou domaine n’est inventé.

## Analyse du dépôt et couverture

**[CONFIG_REPOSITORY_AUDIT.md](CONFIG_REPOSITORY_AUDIT.md)** contient l’inventaire transversal et la décision pour **chacune des 118 variables canoniques** : applicative, plateforme, runtime Electron, keygen, publication, maintenance/manuelle ou sans consommateur.

Le configurateur prend en charge **54 paramètres applicatifs**, y compris ceux absents du template initial : `GF_APP_URL`, `GF_TOTP_ENC_KEY`, anciennes clés TOTP, plafonds mécanicien, délai Redis et paramètres de stockage. Une variable déclarée historiquement mais sans consommateur n’est pas fabriquée : elle n’aurait aucun effet. Les variables OS/tests/debug/reset ne sont pas déployées en production.

```sh
npm run config:audit  # réactualise l’inventaire ; aucun accès cloud
```

L’inventaire lit les fichiers texte de l’ensemble des sources suivies/non ignorées et les références littérales d’environnement. Ce n’est pas une certification de chaque comportement métier ni un test des services externes. Les binaires sont identifiés, pas désassemblés. Les rapports ne contiennent pas de valeurs secrètes.

## Plan complet exécuté

1. **Inventaire du dépôt** : rapport local sans secrets et classification de tout le contrat d’environnement.
2. **Dépendances** : si nécessaires, `npm ci` depuis le lockfile ; génération des deux clients Prisma. Le setup desktop est neutralisé pendant l’installation des dépendances cloud, puis exécuté avec son propre profil.
3. **Vercel** : session existante réutilisée ou connexion officielle ; sélection/confirmation explicite du projet et de l’équipe ; récupération de production **avant génération des secrets**. Pas de modification de Preview/Development. Un override Electron, un NODE_ENV non production ou un nom de secret exposé publiquement bloque le plan avant déploiement.
4. **Neon/PostgreSQL** : session existante ou authentification officielle ; choix automatique lorsqu’une seule ressource existe, sinon sélection guidée ; création possible d’un projet/base/rôle en Europe si le compte est vide, uniquement après autorisation. Les deux véritables URLs sont récupérées. Une sélection différente d’une `DATABASE_URL` existante est refusée. Pour un PostgreSQL non-Neon existant, l’URL directe manquante est demandée sans deviner son hostname.
5. **Inspection SQL en lecture seule** : connectivité, tables et présence de données. Sur une base utilisée, une clé absente ne doit pas être régénérée à l’aveugle : importer l’original depuis le coffre, ou déclarer explicitement un domaine **jamais configuré**.
6. **URL serveur automatique** : `https://garageflows.fr` est la cible du mode complet, sans saisie d’URL pour une nouvelle configuration. Une cible existante différente exige confirmation ; aucun secret/API key n’est changé à cette étape. `GF_APP_URL` reçoit cette URL lorsqu’elle est absente. Cela ne crée ni DNS ni domaine Vercel : le domaine doit appartenir à l’opérateur et pointer sur le projet autorisé. Les conflits avec des valeurs Vercel existantes restent bloquants, sans écrasement silencieux.
7. **Upstash** : session officielle réutilisée ou accès demandé (email + clé Developer API, pas le mot de passe du compte), récupération automatique de l’endpoint REST et du token. S’il n’existe pas de Redis, création possible sur autorisation avec **plan gratuit explicite**, TLS, région Europe et eviction désactivée. Si le fournisseur refuse/renvoie un format inexploitable, demander les deux valeurs REST manuellement. Aucun passage automatique au pay-as-you-go. Un **PING REST réel** doit réussir ; aucun repli mémoire PWA.
8. **Secrets** : génération indépendante de 32 octets pour les domaines applicatifs absents sur une nouvelle configuration : session, appareil, API admin, MAC licences, portail, signatures, SMTP, TOTP et sauvegardes. Pour une **base sans données**, préparation possible de la clé de chiffrement de facturation ; tous les drapeaux de facturation restent **OFF**. Les valeurs existantes restent inchangées. Sur une base utilisée, les replis historiques portail/signature sur le secret de session original sont préservés plutôt que remplacés par une nouvelle clé invalidant les liens/preuves. Les empreintes connues compromises bloquent le plan et nécessitent une rotation explicite.
9. **Licences** : import de la paire P-256 existante ou demande du fichier original. Une nouvelle autorité exige une confirmation explicite et synchronise les ancrages publics existants du dépôt. La clé doit correspondre aux ancrages Next/Electron. Un PEM P-256 chiffré peut être importé avec sa passphrase (saisie masquée, mémoire uniquement) ; le PEM local du keygen conserve son chiffrement, tandis que le serveur reçoit la représentation attendue en variable Sensitive. Les clés commerciales des clients ne sont jamais créées automatiquement.
10. **Fichiers** : profil serveur, profil desktop séparé et configuration du keygen écrits aux emplacements réellement lus par le code. SQLite existante inspectée avant génération de clés manquantes ; une base absente est créée au chemin réellement configuré depuis le template, sans écraser une base existante. Si un ancien `.env` contient PostgreSQL, demander sa migration et conserver une copie privée avant de créer le profil desktop.
11. **Clients packagés** : sur autorisation, aligner les défauts publics compilés de licence, mise à jour et liens publics sur les endpoints desktop validés (les endpoints existants distincts sont conservés) ; ajouter uniquement son hostname aux listes de téléchargement autorisées du client et du signer. Aucun secret dans ces modifications. Un `.env` seul ne configure pas les binaires déjà installés : **rebuild et distribution restent nécessaires**.
12. **SQL** : `migrate deploy`, `migrate status`, puis comparaison du schéma réel avec le schéma Prisma (`migrate diff --exit-code`). Base utilisée : confirmation `MIGRER` après vérification de sauvegarde/PITR. Drift/échec : arrêt ; jamais de `db push`, reset, seed démo destructif ou modification arbitraire de l’historique.
13. **Premier accès admin** : proposition explicite de créer une licence admin signée uniquement pour la première installation. Le jeton est dans un fichier local privé, pas dans le terminal. Aucune licence existante remplacée.
14. **Vercel production** : seconde lecture avant mutation, refus de conflit/changement concurrent, ajouts des seules variables absentes. Valeurs transmises par stdin, pas par arguments de commande. Jamais de suppression ni `--force`. Déploiement après succès SQL/synchronisation, puis contrôle `/api/health` du nouveau deployment via `vercel curl`. La sonde du domaine public est également contrôlée ; DNS/protection indisponibles apparaissent dans le rapport.
15. **Publication locale** : import d’un PEM Ed25519 original situé **hors du dépôt**, ou création explicitement autorisée d’un nouveau canal. Ajout de sa clé publique sans retirer les clés historiques ; mémorisation seulement du chemin/keyId. La commande `release:sign` utilise automatiquement cette configuration. La clé privée n’est jamais envoyée au Vercel PWA.
16. **Keygen Python** : recherche d’un Python >=3.10, vérification de `cryptography`, installation utilisateur proposée par le plan si manquante ; impossibilité d’installation indiquée, pas de faux succès.

Les CLI téléchargés à la demande sont fixés : `vercel@64.0.2`, `neonctl@8.4.4`, `upstash@1.5.0`. Le poste doit pouvoir accéder à npm et aux comptes fournisseurs. Le configurateur n’enregistre pas leurs jetons dans le projet ; les CLI officiels gèrent leurs sessions. La création Redis gratuite utilise la Developer API authentifiée, sans inscrire les accès dans les sources.

## Où vont les valeurs ?

| Destination | Contenu / lecteur |
|---|---|
| `.env` | Desktop/développement SQLite uniquement. Clés locales distinctes du serveur. |
| `.env.server.local` | Serveur PostgreSQL, secrets et paramètres canoniques. Injectés explicitement à Prisma et synchronisés dans Vercel production. |
| `.env.legacy-server.local` | Copie privée d’un ancien profil serveur trouvé dans `.env`, uniquement si sa migration a été autorisée. |
| `keys/private.pem`, `keys/public.pem` | Paire P-256 de l’émetteur lue par le keygen et son packaging public. |
| `keys/server_config.json` | `url=https://garageflows.fr`, `api_key` identique au `GARAGEFLOW_API_KEY` du profil serveur destiné à Vercel, `max_mechanic` ; chargés automatiquement par `keygen_ui.py`. Aucun collage manuel de la clé dans l’interface. |
| `keys/bootstrap-admin-license.json` | Première licence admin signée, uniquement sur création explicitement autorisée. Jeton sensible. |
| `GarageFlow-configuration/keygen-runtime.json` | Lanceur Python détecté, sans credential. |
| Coffre **hors dépôt** | PEM privé Ed25519 de publication ; défaut `~/.garageflows-publisher/update-signing.pem`. Les symlinks vers l’intérieur du dépôt sont refusés. |
| `GarageFlow-configuration/publisher.json` | Chemin du coffre, keyId et clé **publique**, pas de PEM privé. |
| `GarageFlow-configuration/report.json` | Étapes réussies/échouées et actions externes restantes, **sans secrets**. |
| `GarageFlow-configuration/repository-audit.md` | Analyse/inventaire local sans valeurs. |

`.env.server.local` n’est **pas chargé automatiquement par Next.js** : cela empêche les secrets serveur de supplanter le profil d’un build Electron. Les valeurs web réelles sont dans Vercel. Pour un autre hébergeur, importer le profil serveur dans son gestionnaire d’environnement sans le publier avec les sources.

Les destinations locales sensibles sont ignorées par Git et Vercel ; permissions POSIX `0600` (dossiers privés `0700`). Sous Windows, sécuriser aussi les ACL du compte. Ne jamais ajouter de force ces fichiers à Git. Les inconnues locales non canoniques sont conservées ; les paramètres connus incompatibles avec un profil ne sont retirés qu’après autorisation. Les commentaires `.env` sont remplacés par l’en-tête généré.

Dans un Electron **déjà installé**, les secrets session/MAC/SMTP et la clé interne sont gérés par le code sous userData ou en mémoire. Le configurateur ne les remplace pas par des clés partagées de production et ne prétend pas modifier à distance les postes.

## Commandes disponibles

```sh
npm run config                         # plan complet par défaut
node config --profile full
node config --diagnose-sql              # lecture seule : comparer PostgreSQL au schéma attendu
node config --profile desktop          # réglage ciblé local
node config --profile pwa               # réglage ciblé serveur
node config --profile licences         # réglage ciblé émetteur
node config --check --profile desktop   # lecture seule, hors ligne
node config --check --profile pwa --vercel
node config --check --profile licences --vercel
npm run config:audit
npm run test:config
npm run keygen                         # interface Python, configuration locale appliquée
npm run keygen -- --hwid                # CLI Python avec les mêmes paramètres
npm run release:sign -- --help          # wrapper qui réutilise le coffre configuré
```

Les profils ciblés restent des assistants à confirmations étape par étape ; le mode complet a une autorisation initiale pour la chaîne technique et ne redemande pas chaque commande sûre. Les valeurs dangereuses peuvent être corrigées dans les réglages avancés ; `GENERER` demande une génération explicite d’un secret symétrique, `SUPPRIMER` le retire du profil. Aucun remplacement automatique d’un secret non vide.

## Ce qui ne peut pas être configuré honnêtement tout seul

- **Secret Vercel Sensitive non relisible** : l’assistant détecte qu’il existe, ne confond pas son placeholder avec une absence et exige la valeur originale depuis le coffre ou confirmation de l’original local. Il vérifie sa présence/métadonnées, pas son contenu inaccessible. Une modification locale ultérieure est refusée pour éviter une rotation implicite.
- **Clé privée perdue** : impossible de la retrouver depuis une clé publique ou des données chiffrées. Nouvelle autorité/nouveau canal sur confirmation seulement ; les anciens clients/licences peuvent rester incompatibles.
- **Stockage durable Vercel** : les services actuels de sauvegarde et publication/upload des installateurs écrivent sur disque. Un stockage objet et une adaptation applicative sont nécessaires. Mettre `/tmp/backups` ne suffit pas ; un chemin local de stockage durable est refusé pour le profil Vercel. Les photos ont une voie legacy base64 lorsque le stockage fichier est désactivé, pas une intégration objet automatique.
- **garagesite3** : le serveur de publication/control-plane externe n’est pas dans ce checkout. Le signer local et les ancrages clients peuvent être préparés, pas déployer du code absent. Le rapport demande l’accès et la propagation publique/keyId nécessaires.
- **SMTP, identité légale, plateformes de facturation** : données et accès réels du garage, à fournir dans l’application. La préparation de clés ne crée pas ces comptes et n’active pas la facturation. Les clés historiques de SMTP/TOTP/facturation doivent être préservées pour relire les enregistrements existants.
- **Copilot LLM** : son provider réseau n’est pas implémenté. La clé Anthropic configure l’OCR existant ; le reste nécessite du code, pas une variable fictive.
- **Node/Python/Tkinter/permissions système, signature de code Windows, DNS, limites ou conditions fournisseurs** : intervention possible sur le poste/compte. Aucun mot de passe utilisateur ou paiement fourni à votre place.

Le résultat peut donc être **configuré avec actions externes restantes**, jamais « tout opérationnel » malgré une étape échouée ou non réalisable.

## Reprise et précautions

Les fichiers locaux sont écrits avant synchronisation ; une interruption peut avoir laissé des migrations ou quelques ajouts Vercel déjà appliqués. **Relancer `config`**, qui relit les configurations et conserve les clés. Aucun rollback destructif automatique. La licence admin candidate est enregistrée avant insertion pour permettre la reprise sans afficher le jeton.

Un verrou local empêche deux plans complets simultanés. Après un arrêt brutal, vérifier qu’aucun processus config ne tourne puis retirer uniquement `GarageFlow-configuration/config.lock` avant de reprendre. Ne jamais supprimer un verrou pendant une configuration active.

Conserver une sauvegarde chiffrée des secrets dans un coffre indépendant. Avant migration d’une base utilisée, vérifier PITR/sauvegarde chez le fournisseur. Les contrôles unitaires et les fournisseurs simulés ne constituent pas un déploiement réel sur vos comptes : la connexion et les sondes réelles sont effectuées lors de l’exécution autorisée sur votre poste.

## Arrêt à la vérification de drift SQL

`migrate deploy` et `migrate status` précèdent la comparaison du schéma. Une sortie non nulle de cette comparaison arrête le plan avant synchronisation Vercel et déploiement. Le configurateur distingue maintenant :

- **Code Prisma 2** : différence de schéma détectée ; il faut analyser les migrations/schéma, sans réinitialiser la base.
- **Autre code / code indisponible** : comparaison impossible (erreur technique), ce qui ne prouve pas un drift.

Après un arrêt, lancer `node config --diagnose-sql`. Ce diagnostic utilise explicitement `.env.server.local`, pas le profil SQLite `.env`. Il ne lance que `prisma migrate diff` : aucune migration, création, synchronisation cloud ou correction de données. Les sorties brutes du fournisseur restent masquées ; le code, son interprétation et un résumé structurel sont affichés. Le résumé ne montre que les tables/colonnes connues du contrat Prisma et les catégories de contraintes : ni URLs, ni valeurs par défaut, ni noms arbitraires provenant de la base. Un format non reconnu reste masqué au lieu de divulguer la sortie brute. Les codes de sortie 0/2/1 signifient respectivement conforme/drift/erreur technique. Un résultat non nul est donc attendu si le problème persiste. Ne pas contourner le contrôle par reset, suppression de base ou `db push`.

## Configuration automatique du serveur dans keygen_ui

`node config` (mode complet) sélectionne désormais directement `https://garageflows.fr` comme URL serveur. Il reprend la `GARAGEFLOW_API_KEY` existante du serveur ou, sur une nouvelle configuration autorisée, en génère une seule. La même valeur est écrite dans `.env.server.local` et `keys/server_config.json`, puis proposée au projet Vercel autorisé après succès des contrôles SQL. Une clé Vercel Sensitive non récupérable nécessite toujours son original ; aucune nouvelle clé ne la remplace silencieusement.

À la prochaine ouverture via `npm run keygen`, l’onglet Serveur lit automatiquement `url` et `api_key` dans ce JSON. Si le keygen est déjà ouvert, le fermer puis le rouvrir pour recharger les valeurs. Le fichier est créé avant les migrations : un arrêt SQL laisse donc les champs du keygen préremplis, mais ne prouve pas que le serveur distant possède ces valeurs ou que la connexion fonctionne. Une clé locale différente exige une confirmation d’alignement, jamais une rotation serveur automatique.
