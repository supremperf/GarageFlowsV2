---
doc-numbers: journal
---

# Configuration — développement, staging et production

Document vérifié le 22 octobre 2026. Les valeurs secrètes ne sont volontairement pas présentes. La matrice complète et régénérable se trouve dans `docs/CONFIG_REPOSITORY_AUDIT.md` ; le contrat machine est `scripts/garageflow-env-manifest.json`.

## 1. Versions et installation locale

Prérequis :

- Node 22 dans la plage `>=22.12.0 <23` ;
- npm conforme au `packageManager` (`npm@11.16.0`) ;
- Python avec les dépendances verrouillées du projet pour le keygen ;
- accès aux artefacts Prisma officiels pour générer les moteurs natifs.

Commandes normales sur un poste de développement :

```bash
npm ci
npm run setup
npm run config:check
npm run check:consistency
npm run build
```

Dans le sandbox d’audit, `npm ci` et `npm run build` ont été interrompus par le téléchargement Prisma. `npm run setup` a néanmoins été exécuté réellement après correction : `.env` en `600`, secret local fort généré sans l’afficher, base locale préservée.

`npm run setup` est un bootstrap **local**, pas une procédure de déploiement production.

## 2. Fichiers et emplacements

| Profil | Emplacement attendu | Remarque |
|---|---|---|
| développement local | `.env` ignoré | permissions restrictives ; ne pas committer |
| serveur/PWA | `.env.server.local` ou variables Vercel | PostgreSQL et Redis requis selon validation |
| Electron | configuration générée dans `userData` | secrets propres à l’installation |
| keygen | `keys/private.pem`, `keys/public.pem`, `keys/server_config.json` | autorité privée hors dépôt et hors artefact |
| publication | coffre + chemin/keyId dans configuration publisher | clé Ed25519 privée hors dépôt |

`keys/public.pem` est public et peut être embarqué. `keys/private.pem` ne doit jamais se trouver dans le standalone, `win-unpacked` ou l’installateur.

## 3. Variables minimales par profil

Les validations exactes peuvent évoluer avec le code : `npm run config:check` et l’instrumentation de démarrage font foi pour l’environnement contrôlé. Ne créer aucune valeur factice pour obtenir un démarrage.

### PWA / serveur de production

| Variable | Exigence |
|---|---|
| `DATABASE_URL` | PostgreSQL durable ; SQLite/local refusé par la validation PWA de production |
| `DIRECT_URL` | connexion directe PostgreSQL lorsque requise par migrations/outillage |
| `NEXTAUTH_SECRET` | secret fort unique à l’environnement |
| `NEXTAUTH_URL` | URL HTTPS réelle du service |
| `DEVICE_TOKEN_PEPPER` | secret fort distinct, utilisé pour les jetons d’appareils |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | rate limiting distribué multi-instance |
| `TRUST_PROXY_HEADERS` | `1` uniquement derrière un proxy de confiance correctement configuré |
| `GF_DB_MAC_SECRET` | intégrité des enregistrements de licence ; rotation planifiée uniquement |

Le smoke a confirmé qu’un démarrage PWA de production incomplet est refusé. Il n’a pas validé une configuration PWA réelle.

### Electron / SQLite

- `DATABASE_URL` SQLite et chemins de données sont gérés pour le poste ; ne pas imposer l’URL PostgreSQL du serveur ;
- `GF_APP_DATA`, `GF_BACKUP_DIR`, `GF_PHOTOS_DIR` suivent le profil desktop et les règles de stockage ;
- `GF_LICENSE_SERVER`, `GF_UPDATE_SERVER`, `GF_UPDATE_CHANNEL` doivent désigner les services réellement approuvés ;
- `GF_INTEGRITY_MODE` et `GF_ANTIDEBUG` ne dispensent pas des fuses et contrôles de l’artefact final ;
- les secrets internes d’export/requêtes sont par installation et ne doivent pas être partagés avec le serveur public.

### Fonctions optionnelles mais à secrets distincts

| Fonction | Variables principales |
|---|---|
| portail | `GF_PORTAL_SECRET` |
| SMTP chiffré | `GF_SMTP_CIPHER_KEY`, éventuellement `GF_SMTP_CIPHER_KEY_OLD` pendant migration |
| TOTP chiffré | `GF_TOTP_ENC_KEY`, éventuellement `GF_TOTP_ENC_KEY_OLD` |
| sauvegarde | `GF_BACKUP_KEY`, `GF_BACKUP_DIR` selon profil |
| facturation électronique | `GF_EINVOICE_CREDENTIALS_KEY`, version de clé, file et options `EINVOICING_*` |
| OCR capture | `ANTHROPIC_API_KEY` et réglages `GF_SCREENSHOT_*` si la fonction est activée |
| limitation de débit | familles `RATE_LIMIT_*` selon les valeurs documentées |
| tests externes | `TEST_POSTGRES_URL`, `TEST_REDIS_URL`, `GF_E2E_*` uniquement sur environnement de test |

Le provider LLM du Copilot n’est pas implémenté par `resolveLlmProvider()`. Ajouter une clé Anthropic ne rend pas le Copilot opérationnel.

## 4. Matrice des 146 variables

L’inventaire généré classe actuellement :

- 67 variables `application` ;
- 11 `platform` ;
- 24 `manual` ;
- 39 `unused` ;
- 2 `runtime` ;
- 1 `keygen` ;
- 2 `publisher`.

`unused` signifie qu’aucune référence littérale/consommateur déclaré n’est retenu par la politique : ajouter une valeur n’active pas une fonction. `manual` concerne un outil ou une opération particulière, pas une variable à copier en production par défaut.

Commandes :

```bash
npm run config:audit
npm run config:check
npm run check:env-consistency
```

`config:audit` réécrit `docs/CONFIG_REPOSITORY_AUDIT.md`. Il faut le relancer après ajout/retrait de fichiers pour maintenir les comptes d’inventaire.

## 5. Rotation et conservation

Avant toute rotation :

1. identifier les données chiffrées ou signées qui dépendent de la clé ;
2. sauvegarder et tester une restauration sur environnement isolé ;
3. prévoir l’ancienne clé de déchiffrement (`*_OLD`) si le code le requiert ;
4. définir le périmètre exact des postes/serveurs et la procédure de retour arrière ;
5. obtenir l’autorisation explicite pour la production.

Ne jamais régénérer l’autorité de licence pour « réparer » une configuration. Une nouvelle autorité peut invalider les licences existantes. Ne jamais réaligner arbitrairement l’historique de migrations.

## 6. Scripts de configuration à privilèges

Le dépôt contient des scripts PowerShell de configuration/reset/rotation et un configurateur automatique. Ils peuvent modifier des ressources réelles.

- utiliser d’abord les modes `--check`, `--simulation` ou hors ligne lorsque disponibles ;
- ne pas utiliser le mode complet de reconstruction sur une base existante sans sauvegarde, journal et autorisation ;
- ne jamais lancer `prisma db push --force-reset` ;
- ne pas assimiler `db push` à une stratégie de migration de production ;
- ne pas exécuter `env:configure` contre Vercel/Neon sans cible et périmètre confirmés.

Aucun de ces scripts de mutation n’a été lancé contre la production pendant cet audit.

## 7. État restant à configurer hors sandbox

- PostgreSQL/Neon et Redis/Upstash de staging puis production ;
- URL HTTPS, DNS et proxy de confiance ;
- SMTP et test de réception ;
- stockage durable des sauvegardes sur Vercel, avec adaptation applicative si nécessaire ;
- comptes de facturation électronique et webhooks ;
- service de mise à jour et identité de publication ;
- certificat de signature Windows et fuses de l’artefact ;
- réconciliation des notices tierces avec le paquet distribué.

Ces éléments ne peuvent pas être validés par des valeurs inventées.
