# GarageFlows — Configuration Upstash / Redis

**Date :** 2026-10-20

## Production

| Élément | Constat |
|---|---|
| Ressource | `upstash-kv-crimson-saddle` (Upstash for Redis), connectée à `app.garageflows.fr` |
| Variables | `UPSTASH_REDIS_REST_URL` et `UPSTASH_REDIS_REST_TOKEN` **déclarées** sur Vercel Production |
| Résidu | `upstashnewv5` est `Uninstalled` mais encore listée sur le projet — à nettoyer |

Le code lit les noms canoniques `UPSTASH_REDIS_REST_*`. L'intégration injecte en
plus `KV_REST_API_*`, `KV_URL` et `REDIS_URL`, **inconnus du manifeste** (constat
V-11) : ni déclarés, ni listés en `platformProvided`, ni en alias interdits. À
trancher — les déclarer en `platformProvided` (ce qu'ils sont) ou les bannir.

## Preview — **BLOQUÉ**

```
vercel integration add upstash-kv -e preview -n gf-preview-redis --no-env-pull
→ {"status":"action_required","reason":"integration_setup_required"}
```

Upstash exige une **finalisation dans le navigateur** (acceptation des conditions
Marketplace). Le CLI ne peut pas la réaliser : `--yes` n'est accepté que pour
`neon`. Ce n'est donc pas un défaut du projet ni un manque d'accès, mais une
contrainte du fournisseur.

Lien de finalisation (ressource et environnement pré-sélectionnés) :

```
https://vercel.com/garage-flows/~/integrations/checkout/upstash
  ?productSlug=upstash-kv&defaultResourceName=gf-preview-redis
  &source=cli&projectSlug=app.garageflows.fr&environment=preview
```

### Conséquence

`src/lib/env.ts` exige `UPSTASH_REDIS_REST_URL`/`_TOKEN` dès que
`NODE_ENV=production` — ce qui est le cas d'un déploiement Preview. **Le Preview
refusera donc de démarrer** tant que cette ressource n'existe pas.

Deux contournements ont été écartés, et pourquoi :

- **réutiliser le Redis de production en Preview** : les clés du rate-limit
  seraient partagées, et un Preview pourrait influencer la production. La
  consigne l'interdit explicitement ;
- **assouplir `validateEnv` pour Preview** : cela affaiblirait une garde qui
  protège contre un rate-limit dégradé en « un seul bucket » — précisément le
  défaut que le commentaire du fichier dit vouloir empêcher.

**Statut : NON CONFIGURÉ — une action navigateur de votre part est requise.**

## Tests Redis

**NON EXÉCUTÉS.** Connexion, écriture, lecture, expiration, rate-limit
multi-instance et isolation entre environnements seront testés dès que la
ressource Preview existera. Les tests d'intégration du dépôt
(`rate-limit-multi-instance.int.test.ts`) sont prêts et attendent
`TEST_REDIS_URL`.
