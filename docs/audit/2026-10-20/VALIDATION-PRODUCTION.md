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
