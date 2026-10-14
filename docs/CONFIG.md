# Config — assistant de configuration GarageFlow

## Démarrage

Depuis la racine du dépôt, avec **Node.js 22 et npm** :

```sh
npm run config
```

Ou `node config` / `./config` sous Linux/macOS. Sous Windows, double-cliquer sur **`config.cmd`**. Le fichier demandé **`config`** est à la racine et ne contient aucun secret.

L'assistant est en français. Il fonctionne avant `npm ci` pour configurer les variables ; Prisma et l'application doivent être installés pour initialiser/migrer les bases. Neon et Vercel sont exécutés à la demande via des versions fixées de leurs CLI officiels (`neonctl@8.4.4`, `vercel@64.0.2`). Une connexion Internet aux fournisseurs et à npm est nécessaire sur le poste qui exécute l'assistant.

## Profils et destination des valeurs

| Profil | Destination locale | Usage |
|---|---|---|
| `desktop` | `.env` | Electron/dev, SQLite `file:./dev.db`, secrets locaux et paramètres du client |
| `pwa` | `.env.server.local` | PWA PostgreSQL/Redis ; synchronisation Vercel production si choisie |
| `licences` | `.env.server.local` | PWA + control-plane, clé privée de licences et clé d'administration |

`.env.server.local` est **volontairement non chargé automatiquement par Next.js**. Cela empêche le profil serveur de supplanter `.env` pendant un build Electron. `config` injecte explicitement ce profil dans Prisma ; les variables du déploiement web sont installées **dans le projet Vercel**, pas dans un fichier déployé. Pour un autre hébergeur, importer ce fichier dans son gestionnaire de secrets/environnement, sans le publier avec les sources.

Tous ces fichiers sont déjà ignorés par `.gitignore` et `.vercelignore`. Les valeurs de `.env.example` ne sont jamais modifiées. Ne jamais transmettre les fichiers locaux par chat ni les ajouter de force à Git. Permissions des fichiers : `0600` sous POSIX ; sous Windows, restreindre les ACL du dossier au compte utilisateur. Faire une sauvegarde chiffrée des secrets dans un coffre : perdre une clé de chiffrement peut rendre des données définitivement illisibles.

## Ce que l'assistant automatise

1. **Sélection du profil.** Les paramètres serveur ne sont pas exportés dans le profil desktop. Les variables documentées sont lues depuis `.env.example` ; le délai Upstash, déjà consommé par le code, est également pris en charge.
2. **Vercel :** `login`, `link`, sélection interactive du projet/équipe, lecture des métadonnées et récupération de la configuration de **production avant toute génération**. Les valeurs existantes sont conservées, ou réimportées après confirmation en cas de conflit local. Pas de modification des environnements Preview/Development.
3. **Neon :** authentification officielle dans le navigateur, choix organisation/projet/branche/base/rôle, récupération des **deux vraies URLs** (poolée et directe) via le CLI. Pas de reconstruction approximative du hostname. Les ressources existantes sont utilisées ; l'assistant ne crée pas de projet payant à votre insu. Si le compte est vide, créer un projet dans Neon puis relancer.
4. **Secrets manquants :** génération indépendante par `crypto.randomBytes(32)` pour session, pepper d'appareil, API admin, MAC licences, portail, signatures, SMTP, sauvegardes et exports internes, selon le profil. Une valeur non vide, même invalide, n'est **jamais remplacée automatiquement** : la validation demande une correction explicite.
5. **Paramètres facultatifs :** limites de débit et valeurs sûres par défaut. Facturation électronique désactivée par défaut. Réglages avancés par nom exact : versions minimales, délai de migration des jetons, proxy, endpoints Electron, anciennes clés SMTP, etc.
6. **Validation avant sauvegarde :** PostgreSQL pour le serveur / SQLite pour le desktop, URL directe non poolée, HTTPS, Redis et pepper requis, formats des clés AES, versions, dates et limites, clé privée de licence correspondant aux ancrages publics du dépôt.
7. **Synchronisation Vercel :** une seconde lecture détecte les changements pendant l'assistant. Seules les variables **absentes** sont ajoutées, avec les secrets transmis sur **stdin**, pas dans les arguments de commande. Aucune suppression et aucun `--force`. Les secrets sont marqués Sensitive ; leur présence est vérifiée après ajout, pas leur contenu lorsqu'il n'est pas relisible.
8. **SQLite :** proposition d'exécuter `scripts/setup-dev.js` existant.
9. **PostgreSQL :** `prisma migrate deploy --schema prisma/server/schema.prisma` uniquement après saisie de `MIGRER`. `DATABASE_URL` et `DIRECT_URL` du profil sont injectées explicitement. Pas de `db push`, reset ni seed destructif.
10. **Déploiement :** `vercel deploy --prod --yes` uniquement après une synchronisation aboutie et saisie de `DEPLOYER`. Un redéploiement est nécessaire pour rendre de nouvelles variables effectives dans les fonctions.

## Ce qui demande votre autorisation ou une valeur externe

Une connexion dans le navigateur est une autorisation de compte, pas une source universelle de tous les secrets.

- **Neon / Vercel :** vous devez autoriser leurs CLI officiels et sélectionner les bonnes ressources. `config` ne stocke pas vos jetons de fournisseur ; les CLI gèrent leurs propres sessions.
- **Upstash Redis :** si les variables REST sont déjà présentes dans Vercel, elles sont réutilisées. Sinon, connecter Redis depuis Vercel Marketplace ou créer une base dans `console.upstash.com`, puis saisir l'URL **REST HTTPS** et le token dans le terminal. La création de compte/base, les conditions et une éventuelle facturation ne sont pas automatisées. Pas de repli mémoire en PWA production.
- **Anthropic :** clé API facultative, demandée uniquement si vous voulez l'OCR/IA. Ce n'est pas le mot de passe du compte. Saisie locale sans écho.
- **Variables Vercel Sensitive :** Vercel ne restitue pas leurs valeurs. L'assistant détecte leur existence, interdit de les remplacer par de nouvelles clés et exige soit la confirmation de la valeur locale, soit une saisie de la **valeur originale depuis votre coffre**. Sans original, il s'arrête. Les métadonnées sont comparées avant synchronisation ; il n'affirme jamais avoir comparé le contenu d'une valeur non relisible.
- **Domaine :** l'URL publique HTTPS est demandée. DNS, possession du domaine et certificats ne sont pas configurés automatiquement ; les vérifier dans Vercel/chez votre registrar.
- **SMTP :** `GF_SMTP_CIPHER_KEY` peut être générée, mais le serveur SMTP/login/mot de passe restent des réglages du garage dans l'application. Pour une base existante, importer la clé d'origine avant sauvegarde. Pour une rotation, utiliser `GF_SMTP_CIPHER_KEY_OLD` et la procédure `scripts/encrypt-smtp-secrets.js --yes --rotate` : l'assistant ne rechiffre pas les données.
- **Facturation électronique :** aucun drapeau n'est activé automatiquement et `GF_EINVOICE_CREDENTIALS_KEY` n'est pas générée automatiquement. Pour une nouvelle configuration, fournir une clé de 32 octets en base64 via les réglages avancés (ou saisir `GENERER` comme valeur puis confirmer explicitement sa génération) ; pour une installation existante, importer impérativement l'original. Les comptes/identifiants des plateformes sont configurés dans l'application. Une activation explicite sans clé valide est refusée.
- **Publication des mises à jour :** `GF_UPDATE_SIGNING_KEY` appartient au coffre du serveur **garagesite3**, dans un autre dépôt. Elle est exclue de tous les profils de ce dépôt et jamais envoyée à ce Vercel. La configuration des endpoints/canal Electron est accessible en profil desktop. Voir `docs/SECURITY-HARDENING.md` et `scripts/sign-release-manifest.mjs` pour la chaîne de publication.

**Base déjà utilisée :** avant d'accepter des secrets générés parce qu'ils sont absents du poste, retrouver ceux réellement utilisés en production. Une absence de variable sur un poste ne prouve pas qu'une clé n'a jamais existé. L'assistant ne peut pas récupérer une clé perdue à partir de données chiffrées.

## Clé privée du serveur de licences

Le profil `licences` importe automatiquement `keys/private.pem` s'il existe, sinon demande le chemin d'un PEM local. `GF_PRIVATE_KEY` contient le PEM encodé en base64, comme l'attend `/api/admin/licenses/generate`. La clé doit être une **ECDSA P-256** et correspondre à `src/lib/license/public-key.ts`.

Pour une **nouvelle autorité seulement**, une option explicite permet de créer une paire et synchroniser les ancrages publics avec le script existant `sync-public-key.mjs`. Elle exige de saisir `NOUVELLE-AUTORITE` et refuse d'écraser des fichiers de clés existants. Cette opération modifie des fichiers publics du dépôt : examiner le diff avant livraison. Elle ne met **ni les clients déjà installés ni garagesite3** à jour. Une nouvelle paire ne répare pas un parc utilisant une ancienne clé.

Ne pas utiliser cette option pour contourner la perte d'une clé de production. `config` ne fait aucune rotation automatique.

## Commandes utiles

```sh
node config --profile desktop
node config --profile pwa
node config --profile licences

# Lecture seule, hors ligne (aucun secret affiché)
node config --check --profile desktop
node config --check --profile pwa --vercel
node config --check --profile licences --vercel

# Cible auto-hébergée, doit déclarer un proxy réellement fiable
node config --check --profile pwa

npm run test:config
```

Le contrôle local vérifie les valeurs et formats, **pas** les droits réels du compte, la connectivité, le DNS ni le bon fonctionnement des fonctionnalités. L'assistant n'annonce les migrations ou le déploiement terminés que si la commande concernée réussit.

## Reprise après interruption

Les valeurs locales sont enregistrées avant synchronisation. En cas d'échec pendant les ajouts Vercel, certains ajouts peuvent déjà avoir réussi : **relancer `config`**, qui relit la configuration et complète les absences sans remplacer les valeurs existantes. Les variables locales inconnues de l’assistant sont conservées à la sauvegarde ; les variables incompatibles avec le profil choisi ne sont retirées qu’après autorisation explicite. Les commentaires locaux sont remplacés par l’en-tête généré. Côté Vercel, les variables non gérées et les intégrations tierces sont laissées intactes.

Un conflit Vercel, un format inattendu ou une erreur fournisseur arrête l'opération. Les sorties brutes des commandes sont masquées pour éviter la fuite de credentials dans un message d'erreur. Vérifier le compte/projet et ses droits dans le tableau de bord, sans publier de capture contenant des secrets.
