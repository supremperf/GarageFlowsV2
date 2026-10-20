# GarageFlows — Validation Preview

**Date :** 2026-10-20 · **Verdict : PREVIEW DÉPLOYÉ ET VALIDÉ**

Déploiement de référence : `appgarageflows-856a15gwj-garage-flows.vercel.app`
(branche `test-100-pourcent-valide`, protection par authentification Vercel active ;
les tests utilisent `vercel curl`, qui franchit cette protection légitimement).

## Infrastructure

| Élément | État |
|---|---|
| Base PostgreSQL `gf-preview-db` | ✅ plan gratuit, région UE (`fra1`), PostgreSQL 18.6 |
| Migrations | ✅ 22 appliquées sur base vide, 48 tables |
| Redis `gf-preview-redis` | ✅ connecté à **Preview seulement** (`-e preview`) |
| Variables Preview | 33, dont 9/10 du contrat |
| Isolation PostgreSQL | ✅ empreintes `777a6b42…` (prod) vs `5d93970c…` (preview) |
| Isolation Redis | ✅ `vital-duckling-77598` (prod) vs `humble-gelding-137819` (preview) |

`NEXTAUTH_URL` est volontairement absente : l'URL d'un Preview change à chaque
déploiement, et next-auth la déduit de `VERCEL_URL`. Une valeur fixe serait fausse.

## Déploiement — un défaut révélé puis corrigé

Le premier déploiement a **échoué**, et c'est un apport :

```
"reason": "deploy_failed",
"message": "Hobby accounts are limited to daily cron jobs.
            This cron expression (17 * * * *) would run more than once per day."
```

Le compte est en plan **Hobby** : un seul cron par jour. L'expression horaire
faisait échouer le **déploiement entier**, pas seulement le cron. Rien dans le
dépôt ne connaît le plan du compte — seul un déploiement réel pouvait le révéler.

Corrigé en `17 3 * * *`, et verrouillé par un test (`vercel-crons.test.ts`) qui
exige des champs heure et minute fixes. **Conséquence assumée** : une transmission
e-facturation en échec peut attendre jusqu'à 24 h. Le plan Pro lèverait la
contrainte — décision d'exploitation, pas défaut du code.

## Build — 169 routes API générées

```
Detected Next.js version: 15.5.27
ℹ  Build Vercel détecté — post-build desktop ignoré (sortie standalone non empaquetée)
Created all serverless functions in: 1.448s
Build Completed in /vercel/output [3m]
```

169 occurrences de `/api/` dans les logs : **toutes les routes sont générées**. Le
projet détecte Vercel et saute le post-build desktop — `output: 'standalone'`
n'empêche pas le déploiement, contrairement à ce qu'un diagnostic antérieur
supposait.

## Tests réels

### Les cinq routes absentes de la production — PRÉSENTES

| Route | Preview | Production |
|---|---|---|
| `/api/keygen/licenses` | **403** (existe, refuse sans clé) | **404** (absente) |
| `/api/internal/einvoicing/queue` | **405** (existe, POST seul) | absente |
| `/api/einvoicing/webhooks/[id]` | **405** (existe) | absente |

Un 405 prouve l'existence de la route ; un 404 son absence. **V-03 est résolu sur
cette branche** — il ne reste qu'à déployer en production.

### Keygen → serveur : VALIDÉ

| Appel | Résultat |
|---|---|
| Bonne clé API | **200** `{"ok":true,"count":0,"truncated":false,"licenses":[]}` |
| Mauvaise clé, même longueur | **403** |
| Sans en-tête `x-gf-key` | **403** |

Aucun jeton de licence n'est renvoyé, conformément à la conception de la route.
C'est la première validation de bout en bout du critère « le keygen communique
avec le serveur de licences ».

### Rate-limit distribué via Redis : VALIDÉ

Un appel à `/api/license/status` crée dans Redis Preview :

```
rl:license_status:a2be968cbe88f3347feed05b5c0718f3 = 1   (ttl 37)
```

La clé est **pseudonymisée** (SHA-256 tronqué) : aucune IP en clair, conformément
au commentaire du module. En saturant ce compteur au-delà du seuil (60/60 s), la
route répond **429 Too Many Requests** — le fail-closed fonctionne réellement.

> Réserve de méthode : un premier test par martèlement POST n'a produit aucun 429.
> Vérification faite, `vercel curl` ne transmettait pas le corps des requêtes — les
> 400 obtenus venaient de la plateforme, en texte brut, pas des handlers. **Le
> rate-limit n'était pas en cause, mon instrument de test l'était.**

### Redis — opérations complètes : 10/10

PING, SET, GET, EXPIRE, TTL lisible, **expiration effective**, DEL, clé supprimée
illisible, INCR atomique, incrémentation correcte. Instance laissée propre (0 clé).

### PostgreSQL Preview — 16/16

CRUD complet, transaction de décrément, idempotence du rejeu, rollback après
panne simulée, isolation multi-tenant, concurrence (5 engagements simultanés →
1 seul gagnant), cohérence du journal, cascade. Données fictives, nettoyées.

### En-têtes de sécurité

CSP complète, `Permissions-Policy`, `Referrer-Policy` présents sur les réponses
Preview, y compris sur un 429.

## Non testé en Preview

| Sujet | Raison |
|---|---|
| Parcours métier via l'interface | aucun compte applicatif en base Preview |
| Paiements | aucun bac à sable fournisseur configuré |
| Facturation électronique réelle | aucun compte de plateforme agréée |
| Exécution réelle du cron | un cron ne s'exécute que sur un déploiement de **production** |
| Routes POST via `vercel curl` | l'outil ne transmet pas le corps ; à tester avec un jeton de contournement de protection |

## Conclusion

L'environnement Preview est **configuré, isolé et fonctionnel**. L'isolation est
prouvée sur les deux ressources (PostgreSQL et Redis), par empreintes distinctes
et par la garde `verifierIsolationPreview` qui ne s'est pas déclenchée — donc la
base visée n'est pas celle de production.

La production reste sur son déploiement du 17/10, intacte.
