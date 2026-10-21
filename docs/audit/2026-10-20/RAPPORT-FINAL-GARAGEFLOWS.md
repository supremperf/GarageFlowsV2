# GarageFlows — Rapport final

**Date :** 2026-10-20 · **Branche :** `test-100-pourcent-valide` · **Dépôt :** `supremperf/GarageFlowsV2`

## Verdict

**INFRASTRUCTURE CONFIGURÉE · NON ENCORE DÉPLOYÉE · DEUX BLOCAGES FOURNISSEUR**

Ce n'est pas encore un logiciel exploitable par de vrais garages. Mais l'écart
restant est désormais court, borné et nommé — là où la mission a commencé sur une
configuration de production qu'un simple « Redeploy » suffisait à détruire.

## Ce qui a été réellement fait

| Domaine | Résultat |
|---|---|
| **Variables Vercel** | 12 en Production, 26 en Preview, 1 en Development. `check-env-vercel` production → **exit 0** |
| **Rotation PostgreSQL** | Rôle `gf_app` créé, droits accordés, **testé en lecture et écriture**, URL déclarées — **sans aucune coupure** |
| **Base Preview** | `gf-preview-db` créée (plan gratuit, région **UE**), 22 migrations appliquées, 48 tables |
| **Isolation Preview** | Prouvée par empreintes distinctes + garde fail-closed dans le code + **11 tests négatifs** |
| **Tests métier sur PostgreSQL réel** | **16/16** — CRUD, transactions, idempotence, rollback, isolation multi-tenant, concurrence |
| **Secrets** | 8 générés par CSPRNG, jamais affichés, transmis par stdin, jamais écrits sur disque |
| **Cron e-facturation** | Déclaré dans `vercel.json`, verrouillé par 7 tests |
| **Code** | `tsc` 0 · `eslint` 0 · **vitest 4341 réussis, 0 échec** |
| **Audit des routes** | 158 routes revues : **aucun contournement d'authentification, aucun IDOR** |
| **GitHub** | 4 commits poussés sur la branche de validation, scannés (aucune fuite) |

## Les deux blocages, précisément

**1. Upstash Preview** — le provisionnement exige une validation dans le
navigateur (conditions Marketplace). Neon acceptait `--yes`, Upstash non. Sans
Redis dédié, `validateEnv` refuse de démarrer un Preview, et c'est le bon
comportement : sans Redis partagé le rate-limit s'effondre en un seul bucket. Je
n'ai ni déployé un Preview voué à l'échec, ni affaibli la garde.

**2. Token Vercel Blob** — encore à sa valeur compromise. Sa révocation n'est pas
exposée par le CLI et demande la console Storage.

Tout le reste a été exécuté.

## Ce qui n'est pas validé, et ne sera pas présenté comme tel

Les cinq routes absentes de la production, la communication keygen → serveur,
l'exécution réelle du cron, la restauration d'une sauvegarde, les paiements et la
facturation électronique réelle : **NON TESTÉS**. Tous dépendent d'un déploiement
que je n'ai pas effectué — en production parce que votre autorisation n'a pas été
donnée, en Preview parce qu'Upstash le bloque.

Le détail route par route est dans `PREUVES-VALIDATION.md`.

## Suite immédiate

1. Finaliser Upstash dans le navigateur (lien dans `CONFIGURATION-UPSTASH.md`).
2. Je déclare les deux variables Redis Preview et déploie le Preview.
3. Je teste : cinq routes présentes, parcours keygen sur autorité de test,
   authentification, rate-limit, isolation contre la base réelle.
4. Sur votre feu vert : déploiement de production, puis révocation de
   `neondb_owner` et du token Blob.

## Appréciation

Le cœur métier est solide, et c'est le résultat le plus important de ces quatre
phases. L'inventaire transactionnel tient sur SQLite comme sur PostgreSQL réel,
y compris sous concurrence. La cryptographie des licences est correctement
implémentée, jusqu'au rejet de `alg=none`. L'isolation multi-tenant résiste sur
les 53 routes métier examinées.

Les défauts trouvés étaient presque tous d'une même famille : **des gardes
présentes mais inopérantes** — un contrôle de rotation qui ne s'exécutait pas, un
contrôle d'environnement aveugle au pire cas, une frontière de signature plus
permissive d'un côté que de l'autre, une traçabilité de build emprunant le commit
d'un autre dépôt. Du vert qui n'attestait rien. C'est plus insidieux qu'une
absence de contrôle, et c'est ce qui a permis à dix identifiants compromis de
rester en place sans que rien ne le signale.

Ils sont maintenant corrigés, et chacun est verrouillé par un test dont j'ai
vérifié qu'il échoue quand on réintroduit le défaut.
