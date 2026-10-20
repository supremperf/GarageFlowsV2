# GarageFlows — Validation Preview

**Date :** 2026-10-20 · **Verdict : NON VALIDÉ — bloqué sur une dépendance fournisseur**

## Ce qui est en place

| Élément | État |
|---|---|
| Base PostgreSQL dédiée `gf-preview-db` | ✅ créée, plan gratuit, région UE (`fra1`), PostgreSQL 18.6 |
| Migrations | ✅ 22 appliquées sur base vide, 48 tables |
| Connectée à Preview **seulement** | ✅ vérifié : aucune variable Neon en Production |
| Isolation prouvée | ✅ empreintes de base différentes (`777a6b42…` / `5d93970c…`) |
| Garde d'isolation dans le code | ✅ `src/lib/env.ts` refuse un Preview visant la production |
| Secrets applicatifs Preview | ✅ 6 générés, empreintes toutes distinctes de la production |
| `DIRECT_URL` | ✅ construite depuis `DATABASE_URL_UNPOOLED` |
| Tests métier sur cette base | ✅ **16/16** (CRUD, transactions, idempotence, rollback, isolation, concurrence) |

## Ce qui bloque le déploiement

`UPSTASH_REDIS_REST_URL` et `UPSTASH_REDIS_REST_TOKEN` sont absentes de Preview :
le provisionnement Upstash exige une **finalisation dans le navigateur** que le
CLI ne peut pas réaliser (`--yes` n'est accepté que pour `neon`).

Or `src/lib/env.ts` exige ces variables dès que `NODE_ENV=production`, ce qui est
le cas d'un Preview. **Le déploiement refuserait donc de démarrer**, et c'est le
comportement correct : sans Redis partagé, le rate-limit s'effondrerait en un
seul bucket.

Je n'ai pas déployé pour ne pas produire un Preview en échec, et je n'ai pas
contourné la garde — l'affaiblir reviendrait à supprimer la protection qu'elle
apporte.

## Reprise après finalisation d'Upstash

    vercel integration list
    node scripts/check-env-vercel.mjs --environnement preview --projet app.garageflows.fr
    vercel deploy

À tester ensuite : présence des cinq routes absentes, parcours keygen avec une
autorité de test, authentification, rate-limit multi-instance, et le test négatif
d'isolation contre la base réelle.
