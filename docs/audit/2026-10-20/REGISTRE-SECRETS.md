# GarageFlows — Registre des secrets

**Date :** 2026-10-20 · **Branche :** `test-100-pourcent-valide`

> Ce document ne contient **aucune valeur**. Les empreintes sont des SHA-256
> tronquées à 12 caractères, à sens unique : elles identifient une *version* de
> secret sans permettre de la reconstituer.

## Légende des sources

| Source | Signification |
|---|---|
| **en service** | valeur préexistante, déclarée telle quelle sur Vercel — en générer une neuve aurait cassé un service en cours |
| **généré** | créé pendant cette mission par `crypto.randomBytes` (CSPRNG) |
| **fournisseur** | émis par Neon ou Upstash, récupéré via l'API Vercel Marketplace |

## Production

| Variable | Source | Empreinte | Longueur | Enregistrée | Validée |
|---|---|---|---|---|---|
| `NEXTAUTH_SECRET` | en service | *(préexistante)* | — | ✅ Vercel | ✅ `/api/license/status` 200 |
| `GARAGEFLOW_API_KEY` | en service | *(préexistante)* | — | ✅ Vercel | ⏳ après redéploiement |
| `DEVICE_TOKEN_PEPPER` | en service | *(préexistante)* | — | ✅ Vercel | ⏳ |
| `GF_DB_MAC_SECRET` | en service | *(préexistante)* | — | ✅ Vercel | ⏳ |
| `NEXTAUTH_URL` | en service | *(non secret)* | — | ✅ Vercel | ✅ |
| `UPSTASH_REDIS_REST_URL` | fournisseur | *(non secret)* | — | ✅ Vercel | ⏳ |
| `UPSTASH_REDIS_REST_TOKEN` | fournisseur | *(préexistante)* | — | ✅ Vercel | ⏳ |
| `CRON_SECRET` | **généré** | `3c6fb5e5715f` | 64 | ✅ Vercel | ⏳ au 1er cron |
| `EINVOICING_QUEUE_TOKEN` | **généré** | `3c6fb5e5715f` | 64 | ✅ Vercel | ⏳ |
| `GF_PRODUCTION_DB_FINGERPRINT` | **calculé** | `777a6b42d0d8` | 64 | ✅ 3 env. | ✅ test d'isolation |
| `DATABASE_URL` | **roté** | rôle `gf_app`, mdp `1ef6f71f0eb6` | 40 | ✅ Vercel | ✅ 21 garages lus, écriture OK |
| `DIRECT_URL` | **roté** | idem | 40 | ✅ Vercel | ✅ migrations appliquées |

`CRON_SECRET` et `EINVOICING_QUEUE_TOKEN` partagent **volontairement** la même
empreinte : Vercel envoie `Authorization: Bearer $CRON_SECRET` et la route compare
à `EINVOICING_QUEUE_TOKEN` sans repli. Divergence ⇒ 401 silencieux.

## Preview — valeurs TOUTES distinctes de la production

| Variable | Source | Empreinte | Longueur | Enregistrée |
|---|---|---|---|---|
| `NEXTAUTH_SECRET` | **généré** | `85f4fb5e152c` | 64 | ✅ |
| `DEVICE_TOKEN_PEPPER` | **généré** | `f4688be7ee03` | 64 | ✅ |
| `GF_DB_MAC_SECRET` | **généré** | `bdeecddb0d6f` | 64 | ✅ |
| `GARAGEFLOW_API_KEY` | **généré** | `a51f2bcf198d` | 64 | ✅ |
| `CRON_SECRET` | **généré** | `ace8fbb3ac0e` | 64 | ✅ |
| `EINVOICING_QUEUE_TOKEN` | **généré** | `ace8fbb3ac0e` | 64 | ✅ |
| `DATABASE_URL` | fournisseur | base `gf-preview-db` | — | ✅ (intégration) |
| `DIRECT_URL` | fournisseur | dérivée de `DATABASE_URL_UNPOOLED` | — | ✅ |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | fournisseur | — | — | ❌ **bloqué** (navigateur) |

Aucune empreinte Preview ne coïncide avec son homologue de production : la
séparation est donc effective, pas seulement déclarée.

## Méthode de génération

`crypto.randomBytes(48).toString('base64url')` → 64 caractères, 384 bits
d'entropie. Pour le mot de passe PostgreSQL : 40 caractères tirés d'un alphabet
alphanumérique via `randomBytes`, avec rejet des octets ≥ 248 pour éviter le
biais modulo.

Jamais employés : `Math.random()`, une date, un nom de projet, un hash d'une
donnée publique, une valeur codée en dur.

## Hygiène observée

- Aucune valeur n'a été affichée, journalisée ni écrite dans un fichier du dépôt.
- Les valeurs ont été transmises à Vercel via **stdin** (`vercel env add`), donc
  jamais exposées dans une ligne de commande ni dans un historique de shell.
- Le mot de passe de `gf_app` a été généré, utilisé et déclaré **dans un unique
  processus** : il n'a jamais touché le disque.
- Les fichiers temporaires qui ont contenu des secrets ont été supprimés
  (`C:/tmp/gfprev/.env.preview`, `secrets.json`).
- Une tentative d'écriture des identifiants de production dans un fichier a été
  **refusée par la politique de la session** : approche corrigée, sans fichier.

## Reste à traiter

| Point | Nature |
|---|---|
| `BLOB_READ_WRITE_TOKEN` encore compromis | révocation chez Vercel Blob — non exposée par le CLI |
| Révocation de `neondb_owner` | après validation du redéploiement (voir `PROCEDURE-RETOUR-ARRIERE.md`) |
| `.env` local | contient encore les identifiants compromis : à mettre à jour ou à retirer du poste |
