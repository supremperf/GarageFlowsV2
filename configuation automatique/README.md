# GarageFlows — centre de configuration automatique

```powershell
node "configuation automatique/config.js"
```

```powershell
npm run config:auto
```

Les deux commandes lancent exactement le même système.

Le configurateur **cherche avant de générer, réutilise avant de remplacer, vérifie
avant de conclure et sauvegarde avant de modifier**. Il ne pose aucune question :
quand une décision ne peut pas être prise sans risque, il s'arrête sur cette
variable, explique pourquoi, et continue le reste du travail.

---

## 1. Ce qu'il fait, et ce qu'il ne fera jamais

### Il fait

| | |
|---|---|
| Inventorie | les 142 variables du contrat, leurs consommateurs réels dans le code, leur format et leur criticité |
| Découvre | les valeurs déjà présentes : fichiers `.env*`, environnement Windows, brouillons d'une configuration interrompue, projet Vercel, `keys/` |
| Génère | les secrets symétriques **absents**, avec `crypto.randomBytes` et le format attendu par chaque consommateur |
| Dérive | ce qui est calculable : `GF_PRODUCTION_DB_FINGERPRINT` depuis l'URL de production, `GF_PRIVATE_KEY` depuis `keys/private.pem` |
| Vérifie | les connexions réelles : PostgreSQL poolée **et** directe, `PING` Redis REST, rattachement du store Blob, schémas Prisma, autorité de licences |
| Synchronise | vers Vercel les variables requises **absentes**, dans les environnements que la politique autorise |
| Sauvegarde | chaque fichier avant modification, dans un dossier privé horodaté |
| Rapporte | un fichier JSON complet sans aucune valeur secrète, et un résumé lisible au terminal |

### Il ne fait jamais

- **Aucune rotation.** Une valeur existante est conservée. Les clés de
  chiffrement protègent des données déjà écrites : en créer une nouvelle rendrait
  ces données illisibles, et aucune relance ne les récupérerait.
- **Aucune connexion interactive.** Si une session fournisseur manque, il donne
  la commande exacte à lancer plutôt que d'ouvrir une invite qui bloquerait.
- **Aucune valeur inventée.** Une URL de base de données ou un mot de passe SMTP
  ne se devine pas. Ce qui manque est nommé, avec le moyen de l'obtenir.
- **Aucune suppression distante.** Les variables inconnues du contrat et celles
  détenues par une intégration Marketplace sont laissées intactes.
- **Aucun faux succès.** `SUCCESS` signale un contrôle réellement exécuté.

---

## 2. Les vingt étapes

| # | Étape | Écrit quelque chose ? |
|---:|---|---|
| 1 | Système d'exploitation et environnement de travail | non |
| 2 | Node.js et npm | non |
| 3 | Dépendances nécessaires aux contrôles réels | non |
| 4 | Analyse du dépôt et des lectures d'environnement | non |
| 5 | Manifeste des variables et politique de destination | non |
| 6 | Configurations déjà présentes sur ce poste | non |
| 7 | Authentifications des fournisseurs | non |
| 8 | Projet Vercel : identité, équipe, environnements | non |
| 9 | Variables existantes chez Vercel, par environnement | non |
| 10 | Plan : réutilisation, dérivation, génération | non |
| 11 | Autorité de licences et clés cryptographiques | non |
| 12 | Ressources externes manquantes et valeurs non automatisables | non |
| 13 | Ressources accessibles : stockage et rattachements | non |
| 14 | **Fichiers d'environnement locaux** | **oui**, après sauvegarde |
| 15 | **Synchronisation vers Vercel** | **oui**, création seulement par défaut |
| 16 | Vérification des variables distantes | non |
| 17 | Connexions réelles aux services | non |
| 18 | Schémas Prisma | non |
| 19 | Cohérence entre environnements | non |
| 20 | Rapport final | rapport seulement |

Seules les étapes 14 et 15 modifient quelque chose. Tout le reste observe.

---

## 3. Options

```powershell
npm run config:auto                      # configuration complète
npm run config:auto:simulation           # plan complet, aucune écriture
npm run config:auto:hors-ligne           # plan local, aucun accès réseau
npm run config:auto:aide                 # liste complète des options
npm run config:auto:rollback             # restaure la dernière sauvegarde
npm run test:config:auto                 # suite de tests du configurateur
```

### Modes

| Option | Effet |
|---|---|
| `--simulation` | calcule tout, n'écrit rien, ne mute rien chez Vercel |
| `--hors-ligne` | aucun accès réseau ; les contrôles de connexion sont rapportés comme non effectués, jamais comme réussis |
| `--fichiers-cloud` | écrit aussi `.env.development.local` et `.env.preview.local` |
| `--completer-facultatives` | inscrit les variables facultatives à leur valeur par défaut documentée |
| `--json` | n'affiche que le chemin du rapport et le verdict |

### Autorisations explicites — toutes refusées par défaut

| Option | Ce qu'elle autorise | Pourquoi ce n'est pas le défaut |
|---|---|---|
| `--generer-cles-chiffrement` | créer les clés de chiffrement **absentes** (SMTP, sauvegardes, TOTP, facturation) | activer une fonctionnalité de chiffrement est une décision d'exploitation ; et si des cryptogrammes existent déjà, seule la clé d'origine les relit |
| `--autoriser-remplacement-vercel` | mettre à jour une variable Vercel dont la valeur diffère | un remplacement est une rotation ; les rotations `critical` et `high` restent refusées même avec cette option |
| `--cle-licence-vercel` | écrire `GF_PRIVATE_KEY` dans le fichier serveur | provisionner l'autorité d'émission de licences transforme le déploiement en émetteur |
| `--creer-autorite-licence` | créer une paire ECDSA P-256 | uniquement s'il n'existe **aucune** autorité ; sinon on crée une seconde racine de confiance que les clients refusent |
| `--verifier-anthropic` | tester la clé via `GET /v1/models` | envoie la clé au fournisseur ; l'appel est un listage non facturé |
| `--sonde-vercel` | créer puis retirer une variable de sonde dans Development | prouve la capacité d'écriture réelle sans toucher à une variable applicative |

### Maintenance

| Option | Effet |
|---|---|
| `--rollback` | restaure les fichiers de la dernière sauvegarde, en refusant tout fichier modifié entre-temps par un autre processus |
| `--forcer-verrou` | reprend un verrou laissé par un processus disparu |
| `--forcer-ecriture` | écrit malgré une anomalie de sûreté du dépôt (à n'employer qu'après avoir lu le motif du refus) |

### Codes de sortie

| Code | Signification |
|---:|---|
| `0` | terminé ; aucune anomalie bloquante |
| `1` | erreur technique (`FAILED`) |
| `2` | option inconnue |
| `3` | verrou pris par une autre exécution |
| `4` | au moins un `BLOCKED` : une autorisation ou une ressource indispensable manque |

---

## 4. Les quatre catégories de variables

Le moteur classe chaque couple (variable, cible) avant d'agir.

**A — générable.** Secret symétrique produit localement par le CSPRNG du
système. La génération exige que l'**absence soit prouvée**, pas seulement
constatée dans un fichier local : si l'état de l'environnement Vercel n'a pas pu
être lu, la génération est refusée. Une clé liée à des données déjà écrites
(`GF_DB_MAC_SECRET`, `DEVICE_TOKEN_PEPPER`, `GF_SIGNATURE_SECRET`, clés de
chiffrement) exige en plus une base vérifiée sans donnée métier.

**B — récupérable.** La valeur existe déjà quelque part. Chaque candidate porte
son origine et son niveau de preuve :

| Niveau | Signification | Usage |
|---|---|---|
| `prouvee` | une connexion réelle ou une dérivation vérifiable l'a confirmée | utilisable sans réserve |
| `declaree` | elle vient d'un fichier de ce poste | crédible, non vérifiée |
| `brouillon` | elle vient d'une configuration **interrompue** | inutilisable tant qu'une sonde réelle ne l'a pas confirmée |

**C — fournisseur.** Seule une ressource externe réelle peut la fournir :
`DATABASE_URL`, `DIRECT_URL`, `UPSTASH_*`, identifiants SMTP, `ANTHROPIC_API_KEY`,
plateformes de facturation. Le configurateur cherche la ressource existante ; il
n'en crée aucune et n'invente aucune valeur.

**D — dérivable.** Calculable à partir d'une autre valeur vérifiable :

| Variable | Source | Calcul |
|---|---|---|
| `GF_PRODUCTION_DB_FINGERPRINT` | `DATABASE_URL` de production | SHA-256 de (hôte + chemin), sans identifiants — identique à `empreinteCibleBase()` de `src/lib/env.ts` |
| `GF_PRIVATE_KEY` | `keys/private.pem` | PEM encodé en base64, après contrôle de correspondance avec la clé publique embarquée |

---

## 5. Politique de destination

C'est la pièce qui empêche les dégâts. Sans elle, « synchroniser » voudrait dire
pousser tout le local vers les trois environnements.

### Fichiers locaux

| Fichier | Cible | Créé par défaut |
|---|---|---|
| `.env` | poste de développement (Electron, SQLite) | oui |
| `.env.server.local` | serveur / production PWA | oui, si des valeurs sont disponibles |
| `.env.development.local` | Vercel Development | seulement s'il existe déjà, ou avec `--fichiers-cloud` |
| `.env.preview.local` | Vercel Preview | seulement s'il existe déjà, ou avec `--fichiers-cloud` |

> **Pourquoi les deux derniers ne sont pas créés d'office.** `next dev` charge
> `.env.development.local` **avant** `.env`. Y écrire une URL PostgreSQL ferait
> basculer le développement local de SQLite vers la base cloud, sans que
> personne l'ait demandé. Et `.env.preview.local` n'est lu par aucun processus :
> ce serait un fichier de secrets sur le disque sans contrepartie.

### Cibles Vercel autorisées

| Variable | Cibles | Valeur partagée entre environnements ? |
|---|---|---|
| `DATABASE_URL`, `DIRECT_URL` | production, preview | **non** — une copie vers Preview ferait écrire dans la production |
| `NEXTAUTH_SECRET`, `DEVICE_TOKEN_PEPPER`, `GARAGEFLOW_API_KEY`, `GF_DB_MAC_SECRET` | production, preview | non — chaque environnement a sa propre base |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | production, preview | copiable |
| `NEXTAUTH_URL` | production uniquement | non — en Preview l'URL est dynamique (`VERCEL_URL`) ; une valeur fixe casserait les redirections de connexion |
| `GF_PRODUCTION_DB_FINGERPRINT` | production, preview, development | **oui, identique partout** — la garde d'isolation ne peut comparer que si tous les environnements connaissent la même empreinte |

### Jamais déployé

| Variable / famille | Destination réelle |
|---|---|
| `GF_PRIVATE_KEY` | `keys/` et fichier serveur local ; jamais vers Vercel sans `--cle-licence-vercel` |
| `GF_UPDATE_SIGNING_KEY`, `GF_UPDATE_SIGNING_KEY_FILE` | coffre hors dépôt (clé Ed25519 de publication) |
| `GF_EINVOICE_CREDENTIALS_KEY` | jamais côté client |
| `GF_INTERNAL_EXPORT_KEY` | généré à l'exécution par Electron, dans `userData` |
| `NEXT_PUBLIC_*` portant un nom de secret | **refusé** : Next.js inline ces variables dans le bundle navigateur |
| `GF_BACKUP_DIR`, `GF_PHOTOS_DIR` | poste local ; refusés pour une cible Vercel, dont le disque est éphémère |

---

## 6. Statuts du rapport

| Statut | Signification exacte |
|---|---|
| `SUCCESS` | contrôle réellement effectué (connexion ouverte, schéma validé, signature vérifiée) |
| `REUSED` | configuration existante conservée, sans aucune modification |
| `GENERATED` | secret créé localement, son absence ayant été prouvée |
| `SYNCHRONIZED` | variable écrite chez Vercel, puis relue pour confirmation |
| `WARNING` | anomalie non bloquante : la configuration fonctionne, un point mérite attention |
| `BLOCKED` | une autorisation ou une ressource indispensable manque |
| `FAILED` | erreur technique |
| `SKIPPED` | opération volontairement non effectuée, avec son motif |

Un contrôle de format ne vaut jamais `SUCCESS` quand une connexion devait être
testée : il vaut `WARNING`, et le rapport dit pourquoi le test n'a pas eu lieu.

---

## 7. Sécurité

### Aucune valeur dans les sorties

Toute chaîne destinée au terminal ou au rapport traverse `security/redact.js`.
Avant écriture, le rapport complet est **relu** : s'il contient encore une valeur
surveillée, il est refusé et l'emplacement fautif est nommé. Un test de la suite
relit le rapport produit par une exécution réelle et vérifie qu'aucune valeur des
fichiers locaux, des brouillons ou de `keys/private.pem` n'y figure.

Le masquage est sélectif, et c'est volontaire : `file:./dev.db` et un nom d'hôte
restent lisibles. Un diagnostic qui annonce « `[valeur masquée]` a répondu »
n'aide personne à savoir quelle base a répondu.

### Aucun secret en ligne de commande

La ligne de commande d'un processus est lisible par les autres processus de la
même session Windows. Les valeurs envoyées à Vercel passent par un fichier
temporaire privé, supprimé immédiatement, jamais par `argv`.

### Écritures atomiques

Fichier temporaire exclusif, permissions appliquées au descripteur **avant** le
renommage, `fsync`, puis remplacement atomique. Les liens symboliques sont
refusés comme destination : la cible réelle serait inconnue.

### Rapports

`configuation automatique/reports/` conserve les **20 derniers** rapports plus
`dernier-rapport.json`. Au-delà, les plus anciens sont supprimés : le
configurateur est fait pour être relancé souvent, et un dossier de plusieurs
centaines de fichiers rendrait introuvable celui qu'on cherche.

### Sauvegardes

`GarageFlow-configuration/sauvegardes/<horodatage>/`, dossier privé déjà ignoré
par le `.gitignore` du dépôt avec ce commentaire : « peuvent contenir des secrets
en clair ». Les rapports, eux, vivent dans `configuation automatique/reports/` :
ils ne contiennent aucune valeur.

### Verrou

Fichier créé en mode exclusif : sa création est atomique, il n'y a pas de fenêtre
entre « tester » et « prendre ». Un verrou dont le processus est mort est repris
automatiquement ; un verrou vivant refuse la seconde exécution.

---

## 8. Procédures de récupération

### Annuler la dernière exécution

```powershell
npm run config:auto:rollback
```

Restaure les fichiers de la dernière sauvegarde et vérifie le résultat par
relecture. Un fichier modifié par quelqu'un d'autre après notre écriture est
**refusé**, pas écrasé.

### Une valeur de production n'est pas relisible

C'est le comportement normal des variables Vercel de type *Sensitive*, et le
rapport l'indique en `REUSED`. Conséquence : le miroir local ne peut pas être
rempli pour ces variables. Pour obtenir une configuration serveur locale
complète, il faut fournir les valeurs d'origine — ou décider d'une rotation, qui
est une opération d'exploitation avec migration et fenêtre de bascule, hors du
périmètre de ce configurateur.

### Un identifiant a été exposé

`scripts/compromised-secrets.json` liste les empreintes des identifiants connus
comme publiés. Une valeur reconnue est **écartée des candidates**, même si elle
fonctionne encore : aucun contrôle ne rend sûr un identifiant publié. La marche à
suivre est de le révoquer chez le fournisseur, d'en émettre un nouveau, puis de
relancer le configurateur.

### L'autorité de licences diverge

Trois ancrages portent la clé publique : `electron/main.js` (`_PK`),
`src/lib/license/public-key.ts` (`_LINES`) et l'empreinte de référence
`REFERENCE_FP` du test de cohérence. Le configurateur les compare et
**n'en répare aucun**.

La raison tient en une phrase : `npm run keys:sync` aligne les trois sur
`keys/public.pem`, donc réécrit `REFERENCE_FP` — or cette empreinte documente
l'autorité qui a signé les **licences déjà distribuées**. L'effacer ferait perdre
la seule trace permettant de savoir quelles licences restent vérifiables. La
décision appartient à l'exploitant, pas à un outil de configuration.

### La base de données est injoignable

Le configurateur le rapporte en `FAILED` et ne génère aucun secret en
remplacement. Une URL parfaitement formée vers une base supprimée a exactement la
même apparence qu'une URL valide : c'est pourquoi la sonde ouvre réellement les
deux connexions, la poolée et la directe.

---

## 9. Prérequis des fournisseurs

| Fournisseur | Requis | Si absent |
|---|---|---|
| **Vercel** | CLI authentifié et projet lié (`.vercel/project.json`) | aucune lecture distante, aucune synchronisation ; `vercel login` puis `vercel link` sont indiqués dans le rapport |
| **Neon** | `neonctl` authentifié — **facultatif** | l'inventaire n'a pas lieu ; les URL proviennent du projet Vercel ou du fichier local. Aucune base n'est créée |
| **Upstash** | CLI `upstash` authentifié — **facultatif** | idem : aucune base Redis n'est créée (quota et facturation) |
| **Vercel Blob** | store connecté au projet **et** à l'environnement visé | le jeton seul ne suffit pas ; le rattachement se fait dans Vercel → Storage → store → Connect Project |
| **SMTP** | rien dans l'environnement | les paramètres sont saisis dans l'application et stockés en base, chiffrés par `GF_SMTP_CIPHER_KEY`. Aucun mot de passe n'est généré ni deviné |
| **Anthropic** | clé `sk-ant-…` — facultative | OCR de plaque et copilote inactifs. `GARAGEFLOW_LLM` n'est jamais basculé sur `anthropic` : activer le copilote est une décision de coût |
| **Facturation électronique** | rien | tout reste désactivé et verrouillé en `sandbox`. Une configuration autorisant une émission réelle est **refusée** |

### Dépendances locales des contrôles réels

| Dépendance | Sert à | Commande |
|---|---|---|
| `node_modules/prisma` | validation des schémas | `npm ci` |
| `src/generated/server-client` | sonde PostgreSQL | `npm run db:server:generate` |
| `@prisma/client` | inspection SQLite | `npm ci` |
| `@vercel/blob` | contrôle du stockage | `npm ci` |

Aucune n'est installée automatiquement : le rapport indique la commande et
marque le contrôle comme non effectué.

---

## 10. Ce qui n'est pas automatisable

| Sujet | Raison |
|---|---|
| Création d'une base ou d'un store | engage un quota, une facturation, parfois un contrat |
| Rotation d'un secret en service | exige une migration des données, une fenêtre de bascule et un retour arrière |
| Création de l'autorité de licences quand une existe | créerait une seconde racine de confiance que les clients déjà installés refusent |
| Valeur `Sensitive` de production | non relisible par conception ; seul son détenteur peut la fournir |
| Réalignement de `REFERENCE_FP` | effacerait la trace de l'autorité ayant signé les licences distribuées |
| Activation de la facturation électronique | une émission réelle envoie un document fiscal à une plateforme agréée |
| Mot de passe SMTP | stocké chiffré en base, saisi par l'exploitant |
| Sauvegardes durables sur Vercel | le système de fichiers est éphémère ; il faut un stockage objet et une adaptation applicative |

---

## 11. Organisation du code

```text
configuation automatique/
├── config.js                     point d'entrée : options, verrou, rapport, codes de sortie
├── config/
│   ├── manifest.js               manifeste unifié : contrat + politique + scan réel du code
│   └── destinations.js           où chaque variable a le droit d'aller
├── core/
│   ├── pipeline.js               les vingt étapes
│   ├── engine.js                 moteur de décision (catégories A/B/C/D)
│   ├── discovery.js              découverte des valeurs existantes et de leur preuve
│   ├── report.js                 journal, rapport JSON, résumé terminal
│   ├── backup.js                 sauvegardes horodatées et retour arrière
│   └── lock.js                   verrou exclusif et état de reprise
├── providers/
│   ├── vercel.js                 détection, lecture, synchronisation, sonde d'écriture
│   ├── postgres.js               connexions réelles, vacuité, empreinte de cible
│   ├── upstash.js                PING REST
│   ├── storage.js                Blob et chemins de disque
│   ├── smtp.js                   clé de chiffrement des identifiants
│   ├── anthropic.js              format et disponibilité de la clé
│   └── einvoicing.js             drapeaux, verrou sandbox
├── security/
│   ├── secrets.js                génération CSPRNG et contrôle de conformité
│   ├── redact.js                 masquage, dernier rempart avant toute sortie
│   └── license-authority.js      autorité ECDSA P-256 : vérifier, jamais remplacer
├── validators/
│   ├── variables.js              formats et règles du dépôt (config-core.validate)
│   ├── environments.js           cohérence entre environnements, isolation Preview
│   └── repository.js             .gitignore, exemples, liens symboliques, permissions
├── utils/
│   ├── env-file.js               édition chirurgicale des .env (documentation préservée)
│   ├── fsx.js                    écritures atomiques et privées
│   ├── exec.js                   exécution sans shell, sans secret en argv
│   └── ui.js                     affichage et statuts
├── reports/                      rapports (aucune valeur secrète)
└── tests/                        100 tests : node --test
```

### Réutilisation de l'existant

Le configurateur ne réécrit pas ce que le dépôt porte déjà. Il réutilise :

| Module du dépôt | Ce qu'il apporte |
|---|---|
| `scripts/garageflow-env-manifest.json` | le contrat des 142 variables |
| `scripts/config-policy.cjs` | la disposition de chaque variable |
| `scripts/config-core.cjs` | validation, encodage dotenv, écriture privée, correspondance de clé de licence |
| `scripts/lib/config-vercel-api.cjs` | décodage des réponses Vercel, classification d'échec sans fuite |
| `scripts/lib/config-vercel-env.cjs` | distinction « valeur relisible » / « métadonnée de protection » |
| `scripts/lib/config-cloud.cjs` | inventaire par cible, `protectedRecord()`, stores Blob |
| `scripts/lib/config-credentials.cjs` | identifiants connus exposés, cohérence des URL Neon |
| `scripts/config-services.cjs` | `PING` Redis, inspection PostgreSQL et SQLite |

Un test vérifie que la politique de destination reste cohérente avec le manifeste
du dépôt : si une variable y est ajoutée sans destination, la suite échoue.

---

## 12. Tests

```powershell
npm run test:config:auto
```

100 tests, répartis en cinq fichiers :

| Fichier | Couvre |
|---|---|
| `01-unitaires.test.js` | édition `.env` (aller-retour avec le parseur de l'application, doublons, valeurs mal formées, préservation, idempotence), génération et conformité des secrets, masquage, politique de destination, complétude des fiches |
| `02-moteur.test.js` | autorité de licences (réutilisation, refus de création, création sur dépôt neuf, dérivation de `GF_PRIVATE_KEY`), installation vierge, fichiers existants, secrets présents, secrets invalides, variables manquantes, récupération, dérivation, refus de génération sans preuve d'absence, autorisations explicites, découverte (espaces réservés, jetons temporaires, identifiants exposés, priorité des sources) |
| `03-synchronisation.test.js` | création dans Development / Preview / Production, refus de remplacement, intégration Marketplace, rotation critique, variable multi-environnements, échec d'authentification, PostgreSQL et Redis injoignables, endpoint Redis hors domaine, Blob non rattaché, isolation Preview, secret sous nom public, alias historiques |
| `04-robustesse.test.js` | verrou concurrent, verrou orphelin, verrou d'une autre machine, interruption et reprise, sauvegarde, retour arrière (fichier modifié, fichier créé, modification concurrente), refus d'un rapport contenant une valeur, verdict global, idempotence, rotation des rapports |
| `05-integration.test.js` | exécution réelle des vingt étapes, absence de `SUCCESS` de connexion hors ligne, absence de génération pour un environnement non lu, absence de toute valeur dans le rapport et dans la sortie terminale, stabilité des décisions entre deux exécutions, verrou de bout en bout, absence de `Math.random` dans tout le configurateur |

Les scénarios d'échec utilisent des instantanés de la forme exacte produite par
le fournisseur : aucun test ne mute une ressource distante, aucun n'écrit dans le
dépôt réel.
