# Config — configuration complète GarageFlow

## Ouvrir et lancer

**Windows : double-cliquer sur `config.cmd`** (souvent affiché « config » lorsque les extensions sont masquées). Linux/macOS : `./config` ou `node config`. Depuis le dépôt :

```sh
npm run config
```

Le fichier **`config` à la racine lance désormais le mode complet par défaut**, pas une suite de réglages manuels. **Node.js >=22.12.0 et <23, et npm** sont les seuls prérequis du lanceur ; si Node est absent, le lanceur Windows le signale et conserve le message à l’écran. Il ne lance pas un installateur système privilégié sans autorisation.

Une fois le plan affiché, saisir **`AUTORISER`**. Ensuite, les étapes techniques s’enchaînent. Les demandes supplémentaires concernent des accès, la sélection d’une cible ambiguë, des secrets non récupérables ou une opération risquée : création de ressource, remplacement explicite d’autorité, première licence admin, migration d’une base utilisée, nouveau canal pour un parc existant. La première génération de clés sur une installation neuve/base vide est couverte par `AUTORISER`, sans saisie de valeurs de clés. Aucun compte, mot de passe fournisseur ou domaine n’est inventé.

## Analyse du dépôt et couverture

**[CONFIG_REPOSITORY_AUDIT.md](CONFIG_REPOSITORY_AUDIT.md)** contient l’inventaire transversal et la décision pour **variables canoniques lors de sa génération (le décompte courant est fourni par `node config --list`)** : applicative, plateforme, runtime Electron, keygen, publication, maintenance/manuelle ou sans consommateur.

Le configurateur prend en charge **54 paramètres applicatifs**, y compris ceux absents du template initial : `GF_APP_URL`, `GF_TOTP_ENC_KEY`, anciennes clés TOTP, plafonds mécanicien, délai Redis et paramètres de stockage. Une variable déclarée historiquement mais sans consommateur n’est pas fabriquée : elle n’aurait aucun effet. Les variables OS/tests/debug/reset ne sont pas déployées en production.

```sh
node config --list   # couverture courante : noms, profils et destinations, aucune valeur
npm run config:audit  # réactualise l’inventaire ; aucun accès cloud
```

L’inventaire lit les fichiers texte de l’ensemble des sources suivies/non ignorées et les références littérales d’environnement. Ce n’est pas une certification de chaque comportement métier ni un test des services externes. Les binaires sont identifiés, pas désassemblés. Les rapports ne contiennent pas de valeurs secrètes.

## Plan complet exécuté

1. **Inventaire du dépôt** : rapport local sans secrets et classification de tout le contrat d’environnement.
2. **Dépendances** : si nécessaires, `npm ci` depuis le lockfile ; génération des deux clients Prisma. Le setup desktop est neutralisé pendant l’installation des dépendances cloud, puis exécuté avec son propre profil.
3. **Vercel** : session existante réutilisée ou connexion officielle ; sélection/confirmation explicite du projet et de l’équipe ; récupération de production **avant génération des secrets**. Pas de modification de Preview/Development. Un override Electron, un NODE_ENV non production ou un nom de secret exposé publiquement bloque le plan avant déploiement.
4. **Neon/PostgreSQL** : session existante ou authentification officielle ; choix automatique lorsqu’une seule ressource existe, sinon sélection guidée ; création possible d’un projet/base/rôle en Europe si le compte est vide, uniquement après autorisation. Les deux véritables URLs sont récupérées. Les URLs manquantes sont sauvegardées immédiatement dans `.env.server.local`, avant les licences et migrations : un arrêt ultérieur ne les fait plus perdre. Une sélection différente d’une `DATABASE_URL` existante est refusée. Pour un PostgreSQL non-Neon existant, l’URL directe manquante est demandée sans deviner son hostname.
5. **Inspection SQL en lecture seule** : connectivité, tables et présence de **données métier** — les registres `_prisma_migrations`/`_gf_migrations` sont ignorés. Sur une base neuve, toutes les clés absentes sont générées sans saisie ; sur une base réellement utilisée, une clé absente n’est jamais régénérée à l’aveugle : importer l’original depuis le coffre, déclarer explicitement un domaine **jamais configuré** (`NONUTILISE`) ou demander explicitement `GENERER` avec confirmation.
6. **URL serveur automatique** : `https://garageflows.fr` est la cible du mode complet, sans saisie d’URL pour une nouvelle configuration. Une cible existante différente exige confirmation ; aucun secret/API key n’est changé à cette étape. `GF_APP_URL` reçoit cette URL lorsqu’elle est absente. Cela ne crée ni DNS ni domaine Vercel : le domaine doit appartenir à l’opérateur et pointer sur le projet autorisé. Les conflits avec des valeurs Vercel existantes restent bloquants, sans écrasement silencieux.
7. **Upstash** : session officielle réutilisée ou accès demandé (email + clé Developer API, pas le mot de passe du compte), récupération automatique de l’endpoint REST et du token. S’il n’existe pas de Redis, création possible sur autorisation avec **plan gratuit explicite**, TLS, région Europe et eviction désactivée. Si le fournisseur refuse/renvoie un format inexploitable, demander les deux valeurs REST manuellement. Aucun passage automatique au pay-as-you-go. Un **PING REST réel** doit réussir ; aucun repli mémoire PWA.
8. **Secrets** : génération indépendante de 32 octets pour les domaines applicatifs absents sur une nouvelle configuration : session, appareil, API admin, MAC licences, portail, signatures, SMTP, TOTP et sauvegardes. Pour une **base sans données**, préparation possible de la clé de chiffrement de facturation ; tous les drapeaux de facturation restent **OFF**. Les valeurs existantes restent inchangées. Sur une base utilisée, les replis historiques portail/signature sur le secret de session original sont préservés plutôt que remplacés par une nouvelle clé invalidant les liens/preuves. Les empreintes connues compromises bloquent le plan et nécessitent une rotation explicite.
9. **Licences** : import automatique de la paire P-256 locale existante ; sur une première installation à base vide, génération et enregistrement automatiques de la paire, puis synchronisation des ancrages publics. Une autorité locale existante dont le privé manque exige l’original ; aucune nouvelle paire ne la remplace automatiquement. Le remplacement d’une autorité connue reste soumis à confirmation explicite. La clé doit correspondre aux ancrages Next/Electron. Un PEM P-256 chiffré peut être importé avec sa passphrase (saisie masquée, mémoire uniquement) ; le PEM local du keygen conserve son chiffrement, tandis que le serveur reçoit la représentation attendue en variable Sensitive. Les clés commerciales des clients ne sont jamais créées automatiquement.
10. **Fichiers** : profil serveur, profil desktop séparé et configuration du keygen écrits aux emplacements réellement lus par le code. SQLite existante inspectée avant génération de clés manquantes ; une base absente est créée au chemin réellement configuré depuis le template, sans écraser une base existante. Une SQLite neuve issue du modèle (aucune ligne métier) reçoit automatiquement ses clés locales dans `.env`. Si un ancien `.env` contient PostgreSQL, demander sa migration et conserver une copie privée avant de créer le profil desktop.
11. **Clients packagés** : sur autorisation, aligner les défauts publics compilés de licence, mise à jour et liens publics sur les endpoints desktop validés (les endpoints existants distincts sont conservés) ; ajouter uniquement son hostname aux listes de téléchargement autorisées du client et du signer. Aucun secret dans ces modifications. Un `.env` seul ne configure pas les binaires déjà installés : **rebuild et distribution restent nécessaires**.
12. **SQL** : `migrate deploy`, `migrate status`, puis comparaison du schéma réel avec le schéma Prisma (`migrate diff --exit-code`). Base utilisée : confirmation `MIGRER` après vérification de sauvegarde/PITR. Drift/échec : arrêt ; jamais de `db push`, reset, seed démo destructif ou modification arbitraire de l’historique.
13. **Premier accès admin** : proposition explicite de créer une licence admin signée uniquement pour la première installation. Le jeton est dans un fichier local privé, pas dans le terminal. Aucune licence existante remplacée.
14. **Vercel production** : seconde lecture avant mutation, refus de conflit/changement concurrent, ajouts des seules variables absentes. Valeurs transmises par stdin, pas par arguments de commande. Jamais de suppression ni `--force`. Déploiement après succès SQL/synchronisation, puis contrôle `/api/health` du nouveau deployment via `vercel curl`. La sonde du domaine public est également contrôlée ; DNS/protection indisponibles apparaissent dans le rapport.
15. **Publication locale (avant migrations/déploiement)** : sur une installation dont la première autorité vient d’être générée automatiquement, création/enregistrement de la première clé Ed25519 **hors du dépôt**, sans copier-coller. Sinon, réutilisation/import de l’original ou création explicitement autorisée d’un nouveau canal. Ajout de sa clé publique sans retirer les clés historiques ; mémorisation seulement du chemin/keyId. La commande `release:sign` utilise automatiquement cette configuration. La clé privée n’est jamais envoyée au Vercel PWA.
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
| `GarageFlow-configuration/generated-keys.json` | Reçu de première création : empreinte **publique** de licence et état de préparation du premier signer, jamais de clé privée. Permet une reprise sans régénération. |
| `GarageFlow-configuration/report.json` | Étapes réussies/échouées et actions externes restantes, **sans secrets**. |
| `GarageFlow-configuration/repository-audit.md` | Analyse/inventaire local sans valeurs. |

`.env.server.local` n’est **pas chargé automatiquement par Next.js** : cela empêche les secrets serveur de supplanter le profil d’un build Electron. Les valeurs web réelles sont dans Vercel. Pour un autre hébergeur, importer le profil serveur dans son gestionnaire d’environnement sans le publier avec les sources.

Les destinations locales sensibles sont ignorées par Git et Vercel ; permissions POSIX `0600` (dossiers privés `0700`). Sous Windows, sécuriser aussi les ACL du compte. Ne jamais ajouter de force ces fichiers à Git. Les inconnues locales non canoniques sont conservées ; les paramètres connus incompatibles avec un profil ne sont retirés qu’après autorisation. Les commentaires `.env` sont remplacés par l’en-tête généré.

Dans un Electron **déjà installé**, les secrets session/MAC/SMTP et la clé interne sont gérés par le code sous userData ou en mémoire. Le configurateur ne les remplace pas par des clés partagées de production et ne prétend pas modifier à distance les postes.

## Commandes disponibles

```sh
npm run config                         # plan complet par défaut
node config --profile full
node config --list                     # inventaire en lecture seule, sans valeurs
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

## Génération automatique des clés — `node config`

Pour une **première installation**, lancer simplement `node config` (ou double-cliquer `config.cmd`), puis autoriser le plan avec `AUTORISER`. Aucune commande OpenSSL, valeur de clé, choix de format ou copier-coller n'est nécessaire pour les secrets locaux ci-dessous. Les connexions officielles Vercel/Neon/Upstash précèdent l'inspection de la base : cela évite de remplacer par erreur des secrets distants déjà existants.

| Usage | Génération et sauvegarde |
|---|---|
| Sessions, pepper d'appareil, portail, signatures, MAC/HMAC-SHA256, API interne GarageFlow | Secret indépendant de **32 octets aléatoires cryptographiques (256 bits)**, encodé en base64 ou hex selon le contrat ; `.env.server.local`. La même clé API est appliquée à `keys/server_config.json`. |
| SMTP, sauvegardes, TOTP, identifiants de facturation | Clés dédiées de 32 octets ; sauvegarde dans le profil compatible. La clé de facturation est préparée sur base serveur vide, sans activer la fonctionnalité. |
| Desktop | Secrets locaux distincts enregistrés dans `.env`, pas les clés privées de l'émetteur. Sur une SQLite **sans donnée métier**, toutes les clés desktop absentes sont créées sans aucune saisie. |
| Licence | Paire **P-256** dans `keys/private.pem` et `keys/public.pem`, privé encodé pour le serveur, ancrages Next/Electron synchronisés automatiquement. Les clients déjà installés et garagesite3 ne sont pas modifiés : propagation de la clé publique/reconstruction nécessaires pour la nouvelle autorité. |
| Signature des mises à jour | Première clé **Ed25519** au chemin `~/.garageflows-publisher/update-signing.pem`, hors dépôt ; clé publique ajoutée sans retirer les anciennes, chemin/keyId appliqués au lanceur `release:sign`. Préparée avant SQL/déploiement pour conserver les clés lors d'une interruption. |

### Ce qui est considéré comme « base vide »

Seules les tables **métier** comptent. Les registres de migrations `_gf_migrations` (SQLite desktop, baseline du modèle livré) et `_prisma_migrations` (PostgreSQL) sont ignorés, exactement comme `sqlite_%`. Sans cette distinction, une base **neuve** créée depuis `prisma/garageflow-template.db` paraissait déjà « contenir des données » à cause de ses 214 lignes de registre, et le plan réclamait des clés originales (`NEXTAUTH_SECRET`, `GF_DB_MAC_SECRET`, `GF_BACKUP_KEY`, `GF_TOTP_ENC_KEY`…) qui n'avaient jamais existé. Le comportement correct est désormais : base neuve ou sans ligne métier → génération automatique complète ; base contenant réellement des données métier → original du coffre, `NONUTILISE` (déclaration explicite, génération d'une nouvelle clé) ou `GENERER` (confirmation explicite). Une confirmation refusée arrête le plan sans écrire de remplacement.

### Variable existant chez Vercel sans être relisible (`Sensitive`)

Une variable `Sensitive` illisible **existe déjà**. La remplacer constitue une
rotation ; télécharger à nouveau le dépôt ne prouve pas que la production est neuve.

| Situation | Ce que fait `config` |
|---|---|
| Valeur locale avec reçu du même projet et de la même version distante | Réutilisée, sans question ni rotation. |
| Valeur locale sans reçu fiable, ou URL récupérée de Neon | Confirmation groupée que ce sont les **originales de ce projet**, sans remplacement. Choisir une autre base Neon ne récupère pas la connexion de production. |
| Empreinte locale différente du reçu de ce projet/version | Une autorisation explicite de remplacement est exigée. |
| Secret symétrique illisible absent localement, plan complet | Résolution différée jusqu’à l’inspection SQL réelle de la cible confirmée. Base sans données métier : génération 256 bits et remplacement automatiques. Base utilisée : accord groupé explicite, sinon valeurs originales nécessaires. |
| Même secret dans un profil expert sans inspection SQL | Accord groupé explicite avant génération et remplacement. Aucun accord implicite déduit des fichiers du PC. |
| Secret réellement absent du profil et de Vercel | Génération par le plan habituel après contrôle de la base, puis sauvegarde locale et ajout à Vercel. |
| `DATABASE_URL` / `DIRECT_URL` | Récupération des vraies connexions via Neon (projet/branche/base/rôle existants), ou saisie des originales si cet accès est indisponible. Aucune URL inventée, aucun nouveau projet créé dans cette récupération. |
| Mot de passe SMTP, clé d’API externe, clé privée perdue | Non générable comme identifiant de service ou comme récupération d’autorité : fournir l’original ou suivre une procédure de rotation explicite. |

Le remplacement Vercel utilise `env rm`, puis `env add --sensitive`.
**Ces deux opérations ne sont pas atomiques** : un échec après suppression peut
laisser la variable absente. Le profil local sauvegardé avant la synchronisation
conserve la nouvelle valeur pour une relance. Aucun reçu de succès n’est écrit
si la vérification finale échoue. Présence et métadonnées sont relues ; cela
atteste l’écriture, pas une relecture du contenu Sensitive.

Le fichier **`GarageFlow-configuration/secrets-receipt.json`** (`0600`, ignoré par
Git) ne contient aucune valeur secrète : empreintes SHA-256, identifiants
équipe/projet et version distante. Un reçu absent, illisible, ancien sans ces
métadonnées, d’un autre projet ou correspondant à une variable modifiée ne
permet pas l’adoption automatique. Pour une valeur déjà illisible et jamais
envoyée par cet outil, la première concordance repose sur la confirmation de
l’opérateur, pas sur une comparaison que Vercel ne permet pas.

### Où chaque clé générée est écrite

Le plan complet termine par l'étape **`récapitulatif-des-clés-et-destinations`** qui affiche, pour chaque clé créée durant l'exécution, ses destinations réelles (noms uniquement, jamais de valeur) et les enregistre dans `GarageFlow-configuration/report.json` (`keys[]`).

| Clé générée | Destinations |
|---|---|
| `NEXTAUTH_SECRET` | `.env` (desktop) et/ou `.env.server.local` + Vercel production (Sensitive) |
| `DEVICE_TOKEN_PEPPER`, `GF_PORTAL_SECRET`, `GF_EINVOICE_CREDENTIALS_KEY` | `.env.server.local` + Vercel production (Sensitive) |
| `GARAGEFLOW_API_KEY` | `.env.server.local` + `keys/server_config.json` (keygen) + Vercel production (Sensitive) |
| `GF_DB_MAC_SECRET`, `GF_SIGNATURE_SECRET`, `GF_BACKUP_KEY`, `GF_SMTP_CIPHER_KEY`, `GF_TOTP_ENC_KEY` | `.env` (desktop) et/ou `.env.server.local` + Vercel production (Sensitive) ; `GF_BACKUP_KEY` sert aussi aux sauvegardes chiffrées |
| `GF_PRIVATE_KEY` (P-256, non symétrique) | `.env.server.local` (base64) + `keys/private.pem` + `keys/public.pem` + ancrages publics Next/Electron |
| Clé Ed25519 de publication | coffre **hors dépôt** uniquement ; clé publique + keyId dans `GarageFlow-configuration/publisher.json` et `electron/update-verify.js` |

Vercel reçoit les variables **absentes** de l'environnement production (ajout simple) et, lorsque c'est décidé nommément (valeur générée pour une clé introuvable, ou écart local autorisé), le **remplacement** d'une variable non relisible — jamais une suppression « au cas où ». Tout est transmis en Sensitive. Les clés desktop restent distinctes de celles du serveur et ne sont jamais envoyées à Vercel.

**SHA-256 est un algorithme de hash/HMAC, pas une clé à taper.** Config génère le secret aléatoire utilisé par l'algorithme ; les empreintes publiques sont calculées automatiquement. Les fichiers sensibles sont ignorés par Git/Vercel et protégés en `0600` sous POSIX ; les premières écritures de clés refusent un fichier déjà existant, même en cas de création concurrente. Sous Windows, les ACL restent à sécuriser sur le poste.

Une relance **conserve et réutilise** les secrets enregistrés, et peut reprendre une synchronisation publique interrompue avec exactement la même paire. Une clé de publication déjà initialisée puis perdue n'est pas régénérée automatiquement. Si la base contient des données, si une clé publique/configuration d'émetteur existe sans le privé, ou si le reçu de création diverge, l'outil exige les originaux ou s'arrête : générer des valeurs différentes ne récupérerait pas les données/licences. Les champs `*_OLD` sont réservés aux vraies clés historiques et ne sont jamais remplis avec du hasard.

Les clés d'API **Anthropic, Vercel, Neon, Upstash** sont délivrées par leurs fournisseurs : config réutilise les sessions/accès autorisés et récupère les connexions disponibles, mais ne fabrique pas de faux jetons. Les profils ciblés restent des modes experts ; la première génération sans choix de source de licence est automatisée dans le mode complet par défaut.

## Toutes les variables `.env` : accès et vérification

`node config --list` (Windows : `config.cmd --list`) vérifie que chaque nom du template a une décision et affiche les profils/destinations **sans aucune valeur**. Un nom nouveau non déclaré fait sortir la commande avec le code 1. Le contrat courant comprend 48 noms du template : 46 paramètres applicatifs, `GF_INTERNAL_EXPORT_KEY` générée par le runtime Electron, et `GF_UPDATE_SIGNING_KEY` réservée au coffre de publication. Les paramètres applicatifs du manifeste absents du template sont également proposés : 54 au total, répartis entre les profils compatibles, jamais tous copiés dans le client.

Le mode complet propose explicitement **« Personnaliser les variables facultatives du serveur »**, puis la même option pour le desktop, même si la configuration est déjà valide. Les réglages serveur précèdent l'inspection de la base et la génération de clés ; une correction ne peut pas changer silencieusement une cible déjà inspectée. Le mode ciblé propose ses **réglages avancés**. Saisir le nom exact, sa valeur, puis Entrée au prochain nom pour terminer. Entrée conserve une valeur existante ; `SUPPRIMER` la retire. Les clés restent masquées et leur modification requiert confirmation.

Deux commandes évitent de saisir les noms un par un : **`GENERER`** (ou `GENERER-TOUT`) génère d'un coup toutes les clés symétriques encore absentes du profil, avec la liste des destinations et une confirmation unique ; **`LISTE`** réaffiche les variables du profil. `GENERER` est également accepté comme **valeur** d'un secret symétrique (confirmation par clé). Dans tous les cas, `GENERER` ne remplace jamais une valeur déjà enregistrée et ne sert pas à récupérer une clé perdue : les champs historiques `*_OLD` ne sont jamais remplis automatiquement.

Les variables personnalisées déjà présentes dans le fichier du profil sont conservées et proposées dans ces réglages ; leurs valeurs sont masquées. Elles ne sont **pas synchronisées automatiquement vers Vercel**. Les variables système, runtime, de publication, les alias obsolètes et celles d'un autre profil ne deviennent pas des secrets applicatifs. `--check --profile …` refuse les paramètres connus hors profil ; il n'efface rien. Le mode complet et les profils ciblés exigent une autorisation avant retrait de paramètres incompatibles.

Les chemins Windows de sauvegardes/photos et les URL SQLite `file:` sont normalisés en `/` à l'écriture, y compris les chemins UNC. Les mots de passe personnalisés contenant des guillemets ou des antislashs utilisent un délimiteur dotenv compatible ; les caractères `$` restent littéraux. Les valeurs multilignes/NUL ou une combinaison de guillemets non représentable sans ambiguïté sont refusées, jamais tronquées. Les PEM passent par l'import de fichier/base64 prévu. Les endpoints HTTP publics refusent identifiants intégrés, query et fragment ; les identifiants des URL PostgreSQL restent autorisés.

`--list` signale aussi les overrides Next.js présents (`.env.local`, `.env.production`, etc.) : **config ne les modifie pas**, et ils peuvent primer sur `.env`. Leur présence ne doit pas être confondue avec une configuration du profil géré. `.env.server.local` reste une destination explicite, pas un fichier chargé automatiquement par Next.js.

Les commandes Windows avec arguments ne font plus de pause finale bloquante et conservent le code de sortie de Node ; le double-clic sans arguments garde la pause pour lire le résultat. Un contrôle `--check` réussi signifie uniquement « syntaxe/contrat du profil valide » : aucune connexion, licence réelle, migration ou disponibilité cloud n'est prouvée par ce contrôle.

## Ce qui ne peut pas être configuré honnêtement tout seul

- **Secret Vercel Sensitive non relisible** : l’assistant détecte qu’il existe et ne confond jamais son placeholder avec une absence. Il le RÉSOUT (valeur locale conservée, URL de base récupérée auprès de Neon, clé symétrique manquante générée puis remplacée après inspection SQL vide dans le plan complet, ou après autorisation explicite) — voir la section dédiée ci-dessus. Ce qu’il ne peut pas faire : retrouver une valeur que personne n’a conservée **et** qui doit correspondre à un service externe ; celle-là reste à fournir, et aucune valeur inventée ne la remplace.
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

Après un arrêt, lancer `node config --diagnose-sql`. Ce diagnostic utilise explicitement `.env.server.local`, pas le profil SQLite `.env`. Si une URL manque, il propose la connexion Neon officielle puis la sélection explicite de l’organisation, du projet, de la branche, de la base et du rôle existants. Il récupère les deux URLs réelles et enregistre uniquement les paramètres manquants dans le fichier local, sans remplacer les autres secrets/commentaires. La session CLI existante est réutilisée ; une session absente nécessite la connexion navigateur. Aucun projet ni base ne peut être créé dans ce mode. La comparaison SQL ne lance que `prisma migrate diff` : aucune migration, synchronisation Vercel ou correction de données. Les sorties brutes du fournisseur restent masquées ; le code, son interprétation et un résumé structurel sont affichés. Le résumé ne montre que les tables/colonnes connues du contrat Prisma et les catégories de contraintes : ni URLs, ni valeurs par défaut, ni noms arbitraires provenant de la base. Un format non reconnu reste masqué au lieu de divulguer la sortie brute. Les codes de sortie 0/2/1 signifient respectivement conforme/drift/erreur technique. Un résultat non nul est donc attendu si le problème persiste. Ne pas contourner le contrôle par reset, suppression de base ou `db push`.

## Configuration automatique du serveur dans keygen_ui

`node config` (mode complet) sélectionne désormais directement `https://garageflows.fr` comme URL serveur. Il reprend la `GARAGEFLOW_API_KEY` existante du serveur ou, sur une nouvelle configuration autorisée, en génère une seule. La même valeur est écrite dans `.env.server.local` et `keys/server_config.json`, puis proposée au projet Vercel autorisé après succès des contrôles SQL. Une clé Vercel Sensitive non récupérable nécessite toujours son original ; aucune nouvelle clé ne la remplace silencieusement.

À la prochaine ouverture via `npm run keygen`, l’onglet Serveur lit automatiquement `url` et `api_key` dans ce JSON. Si le keygen est déjà ouvert, le fermer puis le rouvrir pour recharger les valeurs. Le fichier est créé avant les migrations : un arrêt SQL laisse donc les champs du keygen préremplis, mais ne prouve pas que le serveur distant possède ces valeurs ou que la connexion fonctionne. Une clé locale différente exige une confirmation d’alignement, jamais une rotation serveur automatique.

### URLs PostgreSQL absentes lors du diagnostic

Lancer `node config --diagnose-sql`, accepter la récupération Neon proposée, puis sélectionner la base **existante**. Le programme obtient la connexion poolée (`DATABASE_URL`) et la connexion directe (`DIRECT_URL`) depuis Neon, sans exposer leurs valeurs. L’enregistrement local des seules URLs manquantes est une opération explicitement autorisée ; la base reste en lecture seule. Une annulation, une sélection incompatible avec une URL déjà présente ou un compte sans projet accessible arrête la récupération sans créer de ressource. Une URL existante non-Neon n’est jamais remplacée par une ressource Neon : utiliser son fournisseur d’origine.

Cela récupère les connexions PostgreSQL, **pas les secrets applicatifs perdus** (chiffrement, licences, API admin). Ceux-ci doivent rester dans leurs fichiers/coffres originaux.

## Chemin automatique des clés et correction du drift JobPart

La clé privée est recherchée automatiquement dans `<dossier-du-dépôt>/keys/private.pem` (sur Windows, le chemin absolu utilise le dossier courant du dépôt, sans nom d’utilisateur codé en dur). Si elle existe, aucune saisie de source/chemin n’est demandée : la paire P-256 est vérifiée contre la clé publique embarquée **avant** l’import. Le fichier original reste inchangé, y compris s’il est chiffré. Sinon, la saisie propose ce chemin comme valeur par défaut ; les chemins collés entre guillemets sont acceptés. Les sorties attendues du keygen restent `keys/private.pem`, `keys/public.pem` et `keys/server_config.json`.

Le drift confirmé sur `JobPart.unitPriceTenThousandths` et `JobPart.unitCostTenThousandths` provenait des `DEFAULT 0` conservés par la migration monétaire PostgreSQL alors que le contrat Prisma exige des snapshots explicites. La nouvelle migration `20261014000000_jobpart_snapshot_defaults` retire uniquement ces deux DEFAULT. Les champs restent `Int` obligatoires, sans défaut côté Prisma. Les migrations historiques/checksums ne sont pas modifiés, aucune colonne n’est supprimée et aucun montant n’est réécrit par ce correctif.

Après mise à jour de `config` et ajout du dossier de migration `prisma/server/migrations/20261014000000_jobpart_snapshot_defaults`, relancer `node config`. Le plan régénère les clients Prisma, applique la nouvelle migration puis vérifie le drift avant déploiement. Un simple `--diagnose-sql` reste en lecture seule et ne peut pas appliquer le correctif. Tout autre drift reste bloquant ; pas de reset ni de contournement. Le correctif a été vérifié par validation/DMMF Prisma 5.22 WASM et rejeu des 22 migrations dans PostgreSQL embarqué PGlite, avec vérification des defaults et préservation de snapshots monétaires de test ; cela ne constitue pas une exécution sur le compte Neon de l’opérateur.
