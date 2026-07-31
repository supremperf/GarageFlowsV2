# Guide de déploiement — Plan de contrôle cloud (control-plane)

> Document de data room (due diligence M&A). Décrit le déploiement du **plan de
> contrôle cloud** GarageFlow (dépôt `garagesite3` : licences, mises à jour,
> administration, vitrine) sur Vercel + PostgreSQL + Upstash Redis + Vercel Blob.
>
> Pour le client desktop Electron (build de l'installateur Windows), voir
> `docs/WINDOWS_BUILD_GUIDE.md`. Pour la cible web installable, voir
> `docs/PWA_DEPLOYMENT.md`. Références existantes reprises ici :
> `docs/PRODUCTION_DEPLOYMENT.md` (ce dépôt), `garagesite3/docs/DEPLOYMENT.md`,
> `garagesite3/docs/PRODUCTION_DEPLOYMENT.md`, `garagesite3/docs/DOMAINS.md`.

## 1. Périmètre et rappel d'architecture

Trois surfaces distinctes partagent une base métier commune (voir
`garagesite3/docs/DOMAINS.md`) :

| Domaine | Rôle | Dépôt | Hébergement |
|---|---|---|---|
| `garageflows.fr` | Vitrine marketing + back-office admin | `garagesite3` | Vercel |
| `api.garageflows.fr` | API centrale / control-plane (licences, mises à jour, admin) | `garagesite3` (même déploiement, 2ᵉ domaine) | Vercel |
| `app.garageflows.fr` | Application installable PWA | `GarageFlowsV2` (cible web) | Vercel ou hôte Node |

Ce guide couvre le déploiement de `garagesite3`, qui sert à la fois la vitrine et
l'API. C'est **l'actif cloud principal** : les sous-systèmes licences,
device-auth, publication de releases, crash-reporting, modules, notifications et
audit sont réels, adossés à Prisma/PostgreSQL, en politique *fail-closed*, et
couverts par **135 tests unitaires** (audit) / **140 tests** après les
changements de session (voir `verified-facts.md`).

> **Réserve d'honnêteté (à signaler à l'acquéreur).** L'API publique
> d'intégration `/api/v1/*` est un **bac à sable en mémoire NON persistant**
> (`src/lib/api/store.ts`) qui se réinitialise à chaque *cold start* serverless
> et n'est pas partagé entre instances. Elle **n'est pas destinée à la
> production**. Son déploiement ne requiert aucune infrastructure de données
> supplémentaire, mais elle ne doit pas être présentée comme une intégration
> tierce opérationnelle.

## 2. Prérequis externes (transferts de deal — hors code)

Ces éléments ne sont **pas dans le dépôt** et doivent être transférés
explicitement dans le cadre de la cession (blocages P0 — voir
`docs/ACQUISITION_READINESS_AUDIT.md`) :

- **Propriété des domaines** `garageflows.fr` (apex, `www`, `api`, `app`) chez le
  registrar, avec accès DNS.
- **Compte(s) Vercel** hébergeant les projets, ou capacité d'en créer de
  nouveaux et d'y transférer les domaines.
- **Clé privée Ed25519 de signature des mises à jour** (`UPDATE_SIGNING_PRIVATE_KEY`)
  — sans elle, aucun manifeste signé ne peut être servi et les clients refusent
  d'installer les mises à jour. Cette clé est un **secret externe**, absente du
  dépôt par conception.
- **Clé privée ECC P-256 de signature des licences** (`keys/private.pem` du dépôt
  desktop, git-ignorée) — nécessaire pour émettre de nouvelles licences.
- Comptes fournisseurs : PostgreSQL managé (Neon/Supabase), Upstash Redis, et
  éventuellement un fournisseur SMTP.

## 3. Provisionnement de l'infrastructure

### 3.1 PostgreSQL (Neon ou Supabase)

Le control-plane est la **source de vérité** des licences (13 modèles Prisma).

1. Créer une base PostgreSQL managée.
2. Récupérer **deux** URL :
   - `DATABASE_URL` — URL **poolée** (runtime applicatif). Sur Neon : hôte avec
     suffixe `-pooler`. Ajouter `?sslmode=require`.
   - `DIRECT_DATABASE_URL` — URL **directe** non poolée (migrations Prisma). Sur
     Neon : même hôte **sans** `-pooler`.
3. TLS obligatoire (`sslmode=require`).

### 3.2 Upstash Redis (rate limiting distribué)

1. Créer une base **Upstash Redis (REST)**.
2. Copier `UPSTASH_REDIS_REST_URL` et `UPSTASH_REDIS_REST_TOKEN`.
3. Rôle : compteurs atomiques (script Lua INCR+PEXPIRE+PTTL) partagés entre
   toutes les instances Vercel. **Politique fail-closed en production** : si
   Redis est absent ou en panne, les routes sensibles (`/api/license/activate`,
   `/api/license/check`, `/api/admin/*`) répondent **503** — il n'existe aucun
   repli mémoire silencieux en production
   (`src/lib/server/rate-limit-distributed.ts`).

### 3.3 Vercel Blob (upload des installateurs — optionnel)

1. Activer Vercel Blob sur le projet ; générer `BLOB_READ_WRITE_TOKEN`.
2. Rôle : upload direct des `.exe` d'installateur via l'admin
   (`/api/admin/blob-upload`). Sans le token, la route renvoie **501** et
   l'option « fournir un lien externe » reste disponible.

## 4. Variables d'environnement

Le détail complet (les deux dépôts) est dans `docs/ENVIRONMENT_VARIABLES.md`.
Variables **exigées en production** par `src/lib/env.ts` (le serveur **refuse de
démarrer** si l'une manque, est trop courte, ou est une valeur d'exemple) :

| Variable | Exigence | Rôle |
|---|---|---|
| `DATABASE_URL` | ≥ 20 car., poolée | PostgreSQL runtime |
| `DIRECT_DATABASE_URL` | — | PostgreSQL direct (migrations) |
| `NEXTAUTH_SECRET` | ≥ 16 car. | Secret de session (cookie `gf_session`) |
| `LICENSE_ADMIN_API_KEY` | ≥ 24 car. | Clé admin (`x-gf-key`) |
| `DEVICE_TOKEN_SECRET` | ≥ 32 car. | HMAC des jetons d'appareil |
| `HWID_HMAC_SECRET` | ≥ 32 car. | HMAC des HWID (jamais stockés en clair) |
| `UPSTASH_REDIS_REST_URL` | https://…, prod | Rate limiting distribué |
| `UPSTASH_REDIS_REST_TOKEN` | ≥ 16 car., prod | Idem |

Génération : `openssl rand -hex 32` (ou `-base64 32`). Aucun secret par défaut
n'existe dans le code.

Recommandées / optionnelles en production : `CRON_SECRET` (voir §7),
`UPDATE_SIGNING_KEY_ID` + `UPDATE_SIGNING_PRIVATE_KEY` (signature des mises à
jour), `BLOB_READ_WRITE_TOKEN`, `GARAGEFLOW_API_CORS_ORIGIN`, `SMTP_*`, et les
`NEXT_PUBLIC_*` de domaines/identité (voir `docs/ENVIRONMENT_VARIABLES.md`).

Sur Vercel : renseigner ces variables **scopées par environnement**
(Production / Preview / Development), jamais dans le dépôt. `.env.example` est
suivi par git et ne contient que des placeholders.

## 5. Migrations de la base

Les migrations s'exécutent **hors build** (jamais pendant `next build`, qui ne se
connecte pas à la base). Utiliser l'**URL directe** :

```bash
# Base vide → applique les migrations dans l'ordre
DIRECT_DATABASE_URL=… npx prisma migrate deploy
# Vérification : la table existe
#   SELECT count(*) FROM "Device";
```

- `migrate deploy` n'applique que les migrations du dépôt
  (`prisma/migrations/*`), dans l'ordre, et échoue sans rien casser si
  l'historique diverge.
- La CI rejoue **toutes** les migrations sur une base `postgres:16` vide à chaque
  push : une migration cassée casse la CI, pas la production.
- **Jamais** de `prisma db push` en production ; **jamais** d'édition d'une
  migration déjà déployée (toujours une nouvelle migration corrective).
- Sauvegarde/PITR avant toute migration destructive.

## 6. Déploiement Vercel

```bash
# depuis garagesite3/
vercel deploy --prod
```

Le build = `prisma generate && next build` (voir `package.json`). Étapes
post-déploiement :

1. Vérifier la sonde : `curl -fsS https://api.garageflows.fr/api/health` →
   `{"status":"ok"}` (ou `503 {"status":"degraded"}`).
2. Configurer Upstash si ce n'est pas déjà fait (sinon les routes sensibles
   répondent 503).
3. Publier une première release signée et vérifier côté client (un client qui
   embarque une clé publique refuse une mise à jour non signée).

### DNS (registrar de `garageflows.fr`)

| Enregistrement | Type | Cible |
|---|---|---|
| `garageflows.fr` (apex) | A / ALIAS | Vercel (projet garagesite3) |
| `www` | CNAME | `garageflows.fr` |
| `api` | CNAME | Vercel (même déploiement garagesite3) |
| `app` | CNAME | Vercel (projet GarageFlowsV2 cible web) |

HTTPS obligatoire partout (prérequis du Service Worker PWA + HSTS en production).

## 7. Rollback automatique des mises à jour (Vercel Cron)

Un rollback automatique basé sur les crashs existe et **est désormais planifié**
via `vercel.json` (ajouté en session, voir `verified-facts.md`) :

```json
{ "crons": [ { "path": "/api/cron/rollback-check", "schedule": "0 * * * *" } ] }
```

La route `/api/cron/rollback-check` est protégée en **fail-closed** par
`CRON_SECRET` (`src/lib/server/cron-auth.ts`) : sans en-tête d'autorisation
valide, elle refuse la requête. **Renseigner `CRON_SECRET`** dans les variables
Vercel pour activer l'authentification du cron.

> Note d'audit : l'audit initial signalait ce rollback comme *code-only, non
> planifié* (aucun `vercel.json`). Le `vercel.json` + l'auth `CRON_SECRET` ont
> été ajoutés depuis ; l'exécution réelle du cron reste à valider en
> préproduction.

## 8. Rollback (code / migration / données)

1. **Code** : redéployer la version précédente (Vercel « Rollback »). Les
   migrations appliquées restent compatibles (additives).
2. **Migration défaillante** :
   ```bash
   npx prisma migrate status
   npx prisma migrate resolve --rolled-back <nom_migration>
   # corriger la migration, puis redéployer
   npx prisma migrate deploy
   ```
3. **Données** : sauvegardes du fournisseur PostgreSQL (PITR recommandé). Après
   restauration, revalider `/api/health`.

## 9. Checklist avant mise en production

- [ ] Domaines + comptes Vercel + fournisseurs transférés (voir §2).
- [ ] Variables requises présentes (le démarrage échoue sinon).
- [ ] `npx prisma migrate deploy` vert sur la base cible.
- [ ] CI verte sur le commit déployé.
- [ ] `GET /api/health` → `{"status":"ok"}`.
- [ ] Test 429 : dépasser la limite d'activation → `Retry-After` présent.
- [ ] `CRON_SECRET` renseigné (rollback-check authentifié).
- [ ] Clés de signature (mises à jour Ed25519, licences ECC) en place et testées.
- [ ] Logs de production : aucun jeton, clé de licence, ni HWID brut (redaction
      active).

---
*Voir aussi : [`docs/ACQUISITION_READINESS_AUDIT.md`](./ACQUISITION_READINESS_AUDIT.md) pour l'audit complet de préparation à la cession.*
