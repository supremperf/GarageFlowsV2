# GarageFlows — Validation Production

**Date :** 2026-10-20 · **Verdict : CONFIGURATION VALIDÉE · DÉPLOIEMENT NON EFFECTUÉ**

## Configuration — validée par l'outil officiel

    node scripts/check-env-vercel.mjs --environnement production --projet app.garageflows.fr
    → exit 0
    ══ PRODUCTION — 12 variables chez Vercel
    ✅ Toutes les variables requises existent sous leur nom canonique ;
       aucun alias interdit chez Vercel.

Les 10 variables du contrat sont déclarées, dont `DATABASE_URL` et `DIRECT_URL`
reconstruites sur le rôle **roté** `gf_app`.

## Service — jamais interrompu

| Contrôle | Avant | Après rotation |
|---|---|---|
| `/api/health` | 200 | **200** |
| `/api/version` | 200, `schemaVersion: 214` | **200** |

La rotation a créé un **nouveau rôle** au lieu de changer le mot de passe
existant : le déploiement en cours, qui porte les anciennes variables figées,
continue de fonctionner. Aucune coupure, et le retour arrière reste possible.

## Déploiement — volontairement NON EFFECTUÉ

Le déploiement de production actuel date du 17/10 et porte du code **antérieur**
(Next.js 14.2.35, cinq routes manquantes). Le redéployer depuis
`test-100-pourcent-valide` apporterait les corrections, mais :

1. votre autorisation explicite est requise, et elle n'a pas été donnée pour la
   production ;
2. le Preview n'a pas pu être testé (Upstash bloqué) — déployer en production
   sans avoir validé en Preview inverserait l'ordre que vous avez fixé ;
3. c'est ce redéploiement qui activera le cron et exercera réellement les
   nouvelles variables : il doit être observé, pas lancé puis oublié.

## Après votre feu vert

    vercel deploy --prod
    curl -s https://app.garageflows.fr/api/version
    curl -s -o /dev/null -w '%{http_code}' https://app.garageflows.fr/api/keygen/licenses

La dernière doit passer de **404** à **403** : la route existe alors, et refuse
un appel sans clé.

Puis seulement, la révocation de `neondb_owner` (voir `PROCEDURE-RETOUR-ARRIERE.md`).

## Reste non couvert en production

`BLOB_READ_WRITE_TOKEN` demeure à sa valeur **compromise** : sa révocation n'est
pas exposée par le CLI Vercel et demande un passage par la console Storage.

---

# Addendum — DÉPLOIEMENT DE PRODUCTION EFFECTUÉ (20/10)

**Déploiement :** `dpl_9LRvSHXQV2FMkqCKv7aS7RYuqwgz`
(`appgarageflows-qrov5558g`) · branche `test-100-pourcent-valide`, commit `a2609ba`.

## Préalable vérifié avant de déployer

Ce déploiement fait basculer la production de `neondb_owner` vers `gf_app`, dont
les droits avaient été accordés **explicitement** (le `GRANT` de rôle ayant été
refusé par Neon). Un droit manquant aurait cassé la production.

Testé en transaction **annulée**, donc sans aucune trace — **10/10** : connexion,
lecture (garages, licences, factures, pièces), `INSERT` garage, `INSERT` client
avec clé étrangère, `UPDATE`, `DELETE`, et vérification qu'aucune donnée ne
subsiste.

## Promotion — une étape qu'il fallait connaître

`vercel deploy --prod` a réussi, mais l'alias `app.garageflows.fr` est resté sur
le déploiement du 17/10 : le **rollback effectué plus tôt épingle l'alias**, et
les déploiements suivants ne le reprennent pas automatiquement. Les trois routes
attendues restaient en 404.

Résolu par `vercel promote` — sans quoi le déploiement aurait semblé réussi tout
en ne servant rien.

## Vérification post-déploiement

| Contrôle | Avant | Après |
|---|---|---|
| `/api/health` | 200 | **200** |
| `/api/ping` | 200 | **200** |
| `/api/version` | 200, `schemaVersion: 214` | **200**, idem |
| `/api/keygen/licenses` | **404** | **403** (existe, refuse sans clé) |
| `/api/internal/einvoicing/queue` | **404** | **405** (existe, POST seul) |
| `/api/einvoicing/webhooks/[id]` | **404** | **405** (existe) |
| `/api/clients` | 401 | **401** `UNAUTHENTICATED` |
| `/api/admin/licenses` | 403 | **403** |

**V-03 est résolu en production.** 169 routes API dans le build.

## Rotation PostgreSQL — effective en production

`/api/health` appelle `dbReachable()` et renvoie **503** si la base est
injoignable. Il répond **200** : la production tourne donc réellement sous le
rôle `gf_app`, avec un mot de passe qui n'a jamais touché le disque.

## Keygen → serveur — VALIDÉ EN PRODUCTION

```
GET /api/keygen/licenses   (en-tête x-gf-key)
→ 200  {"ok":true,"count":11,"truncated":false,"licenses":[…]}
```

**11 licences réellement lues** depuis la base de production. La
`GARAGEFLOW_API_KEY` déclarée est donc la bonne, et le critère « le keygen
communique avec le serveur de licences » est satisfait de bout en bout.

> Un premier test avait renvoyé 403 : l'invocation `curl` passait par le shell et
> l'en-tête était mal transmis. Avec `fetch`, 200. L'instrument était en cause.

## Cron — enregistré, mais sans effet pour l'instant

L'enregistrement est **prouvé indirectement** : Vercel a **refusé** l'expression
`17 * * * *` (« Hobby accounts are limited to daily cron jobs ») puis **accepté**
`17 3 * * *`. Il lit donc bien le `vercel.json`.

En revanche la route cible répond aujourd'hui :

```
POST /api/internal/einvoicing/queue  → 409 {"ok":false,"code":"FEATURE_DISABLED"}
```

Les drapeaux `EINVOICING_*` ne sont pas déclarés en production : la fonctionnalité
d'émission est désactivée, et le contrôle du drapeau précède celui du jeton. **Le
cron s'exécutera donc sans rien faire** jusqu'à l'activation de la facturation
électronique — ce qui est cohérent, aucune plateforme agréée n'étant configurée.

Ce n'est pas un défaut, mais il faut le savoir : voir un cron « configuré » ne
signifie pas qu'il produit un effet.

## Reste ouvert

| Point | Nature |
|---|---|
| `BLOB_READ_WRITE_TOKEN` compromis | révocation via la console Storage ; le CLI n'expose aucune rotation. Portée limitée : trois stores vides, et Blob n'est lu que par l'outillage |
| Révocation de `neondb_owner` | désormais possible : la production tourne sous `gf_app`. Préférer `ALTER ROLE … PASSWORD` à `DROP ROLE` (ce rôle possède le schéma) |
| Drapeaux `EINVOICING_*` | à déclarer le jour où une plateforme agréée est contractée |
| `keys/server_config.json` | porte une `api_key` d'empreinte `7c2b0d0e` alors que le serveur attend `7076985d` : le keygen **local** échouerait encore. À aligner sur le poste de signature |
| Exécution réelle du cron | premier déclenchement à 3 h 17 ; à relever dans les journaux |
