# GarageFlows — Configuration Vercel

**Date :** 2026-10-20 · Projet `app.garageflows.fr` (`prj_D6TzGiDffWVBjXscUSSgk5re9ymP`) · Équipe `garage-flows`

## Point de départ

`vercel env ls` retournait « No Environment Variables found » sur les **trois**
environnements, alors que l'application en service en utilisait. Les variables
étaient attachées au déploiement actif mais plus déclarées : sur Vercel elles
sont résolues à la création du déploiement, qui survit à leur suppression. La
configuration n'était donc **pas reproductible** — un simple « Redeploy »
produisait une application qui refuse de démarrer (`assertEnv` est compilé dans
`.next/server/instrumentation.js`).

## État après intervention

| Environnement | Variables | Contrôle `check-env-vercel` |
|---|---|---|
| **Production** | **12** | ✅ **exit 0** — 10/10 requises, aucun alias interdit |
| **Preview** | **26** | ❌ exit 1 — manquent `UPSTASH_REDIS_REST_URL`/`_TOKEN` (bloqué) et `NEXTAUTH_URL` |
| **Development** | 1 | `GF_PRODUCTION_DB_FINGERPRINT` (SQLite local, pas de ressource distante) |

### Production — les 10 variables du contrat

Toutes présentes, vérifiées par l'outil officiel du dépôt :

```
PRESENT  DATABASE_URL                    PRESENT  NEXTAUTH_SECRET
PRESENT  DEVICE_TOKEN_PEPPER             PRESENT  NEXTAUTH_URL
PRESENT  DIRECT_URL                      PRESENT  UPSTASH_REDIS_REST_TOKEN
PRESENT  GARAGEFLOW_API_KEY              PRESENT  UPSTASH_REDIS_REST_URL
PRESENT  GF_DB_MAC_SECRET                PRESENT  GF_PRODUCTION_DB_FINGERPRINT
✅ Toutes les variables requises existent sous leur nom canonique
```

Plus `CRON_SECRET` et `EINVOICING_QUEUE_TOKEN`, générés pour le cron.

**Choix de méthode.** Les secrets internes **déjà en service** et prouvés non
compromis ont été déclarés **à leur valeur existante**, pas régénérés. En générer
de neufs aurait invalidé toutes les sessions (`NEXTAUTH_SECRET`) et cassé
l'authentification du keygen (`GARAGEFLOW_API_KEY`) au prochain déploiement.
Seuls les secrets réellement **absents** ont été générés.

### Preview — séparation effective

19 variables proviennent de la base Neon `gf-preview-db` créée pour l'occasion,
connectée **à Preview seulement** — vérifié : aucune variable Neon n'apparaît en
Production. S'y ajoutent 6 secrets applicatifs **générés spécifiquement**, aux
empreintes toutes différentes de la production, et `DIRECT_URL` construite depuis
`DATABASE_URL_UNPOOLED`, nom sous lequel l'intégration la fournit.

### `NEXTAUTH_URL` en Preview — absence volontaire

Signalée manquante par le contrôle, mais une valeur fixe serait **fausse** :
l'URL d'un Preview change à chaque déploiement. next-auth la déduit de
`VERCEL_URL` quand la variable est absente. C'est une imprécision du contrat, qui
marque `NEXTAUTH_URL` requise sans distinguer les environnements — pas un défaut
de configuration.

## Réglages du projet — points ouverts

| Réglage | Valeur | Remarque |
|---|---|---|
| Node.js | **24.x** | `package.json` déclare `>=22.12.0 <23`. Vérifié : `node:sqlite` n'est utilisé que dans des tests, et la plage `<23` est une exigence du **lanceur de configuration Windows** (`docs/CONFIG.md`), pas du runtime PWA. Fixer Vercel sur 22.x est la correction juste ; relâcher `engines` affaiblirait un contrat utile. |
| Build Command | défaut | Le déploiement du 17/10 a exécuté `… && next build` alors que le `package.json` actuel finit par `node scripts/next-build.cjs` : confirme que le code déployé est antérieur. |
| Région des fonctions | `iad1` (USA) | Données personnelles de garages français hébergées hors UE. La base Preview a été créée en `fra1` ; la production reste en `us-east-2`. Arbitrage RGPD à votre main. |
| Connexion GitHub | **aucune** | `gh api repos/.../hooks` → aucun webhook. Les déploiements viennent du CLI. Un push ne déclenche rien, ce qui a protégé la production pendant toute la mission. |

## Tâches planifiées

`vercel.json` déclare un cron : `/api/internal/einvoicing/queue` à `17 * * * *`.
Verrouillé par `src/lib/__tests__/vercel-crons.test.ts` (7/7) : cible existante,
authentifiée, hors minute de pointe, couplage `CRON_SECRET` ⇄
`EINVOICING_QUEUE_TOKEN` déclaré au manifeste.

**Pas encore actif** : un cron ne s'exécute que sur un déploiement de
**production**. Il le deviendra au prochain déploiement.

## Hygiène

Les valeurs ont été transmises par **stdin** (`vercel env add`), jamais en
argument de ligne de commande, donc absentes de tout historique de shell. Les 7
secrets de production apparaissent en type **Secret** côté Vercel (valeur non
relisible). Aucune valeur n'a été affichée au cours de la mission.
