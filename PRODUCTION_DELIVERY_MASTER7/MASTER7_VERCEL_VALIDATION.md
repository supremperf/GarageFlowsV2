---
doc-numbers: journal
---

# VALIDATION VERCEL — MASTER 7

Preuve : `MASTER7_EVIDENCE/logs/08-vercel.txt`. **Aucune valeur de variable d'environnement n'est affichée : seuls les noms le sont.**

---

## 1. Projet

| | |
|---|---|
| équipe / projet | `garage-flows` / `app.garageflows.fr` |
| identifiant | `prj_D6TzGiDffWVBjXscUSSgk5re9ymP` |
| créé le | 30 juillet 2026 |
| cadriciel | Next.js · Node.js 24.x |
| **liaison Git** | **AUCUNE** |

`vercel project inspect` ne présente **aucune section Git**. Conséquence directe, revérifiée en MASTER 7 : **un push sur `main` ne déclenche aucun déploiement**, et la branche de production n'est pas définie côté Vercel.

## 2. Variables d'environnement — noms seulement

**Production**, type `Secret` (valeurs masquées par Vercel) : `GF_BACKUP_KEY`, `GF_SIGNATURE_SECRET`, `GF_SMTP_CIPHER_KEY`, `GF_PORTAL_SECRET`, `DATABASE_URL`, `DIRECT_URL`, `EINVOICING_QUEUE_TOKEN`, `CRON_SECRET`, `GF_PRODUCTION_DB_FINGERPRINT`, `UPSTASH_REDIS_REST_TOKEN`, `UPSTASH_REDIS_REST_URL`, `NEXTAUTH_URL`, `GF_DB_MAC_SECRET`, `DEVICE_TOKEN_PEPPER`, `GARAGEFLOW_API_KEY`, `NEXTAUTH_SECRET`.

**Preview** : jeu parallèle, plus un ensemble de type `Config` injecté par les intégrations Neon et Upstash.

Trois constats :

1. **Aucune variable `PRIVATE_KEY` dans aucun environnement.** Confirmation indépendante que la clé privée de licence n'est plus configurée.
2. **Aucune variable Blob** (`vercel env ls | grep -ci blob` → 0), alors qu'un jeton Blob exposé est encore actif au niveau du **compte**. Le canal n'est donc pas en service côté projet — ce qui explique que le store soit vide et qu'une révocation ne casse vraisemblablement rien.
3. Les noms exposés dans l'historique public correspondent **exactement** au jeu `Config` de l'environnement **Preview**.

## 3. Déploiement de production en ligne

| | |
|---|---|
| âge | **3 jours** |
| URL | `https://appgarageflows-e41ch5ymm-garage-flows.vercel.app` |
| statut | **● Ready** |
| environnement | Production |

Ce déploiement est **antérieur à MASTER 7**. Aucune de mes modifications n'y est.

## 4. Production exercée — mesures HTTP réelles

| Route | Code | Temps |
|---|---:|---:|
| `GET /` | **307** → `/login` | 1,230 s |
| `GET /login` | **200** | 0,286 s |
| `GET /api/health` | **200** — `{"status":"ok"}` | 2,062 s |
| `GET /api/clients` | **401** | 0,590 s |
| `GET /portal` | **308** | 0,153 s |

Le point le plus important est le **401 sur `/api/clients`** : la production refuse bien une requête non authentifiée.

## 5. PostgreSQL, Redis, SMTP

| Service | État |
|---|---|
| **PostgreSQL** | `DATABASE_URL` et `DIRECT_URL` configurés en Production. **Je n'ai pas interrogé la base de production** : hors périmètre, et aucune donnée personnelle ne doit être lue. Le 200 sur `/api/health` atteste que l'application atteint ses dépendances. |
| **Redis** | `UPSTASH_REDIS_REST_URL` / `_TOKEN` configurés. La nouvelle instance est **distincte** de celle exposée dans l'historique, dont l'hôte ne résout plus (NXDOMAIN). |
| **SMTP** | `GF_SMTP_CIPHER_KEY` configuré : les identifiants sont chiffrés au repos. L'acheminement externe — SPF, DKIM, DMARC, réception réelle — **n'a pas été testé** : cela exige un serveur de test et une adresse destinataire autorisée, et aucun courriel commercial ou client ne doit être envoyé. |

## 6. Aucun déploiement n'a été effectué — et pourquoi

Le mandat demande de ne rien déployer avant validation des phases de sécurité, puis de déployer « après autorisation et validation ». **Deux raisons de ne pas déployer à ce stade :**

1. **La phase de sécurité n'est pas close.** Le jeton Vercel Blob exposé publiquement est **toujours actif**. Sa révocation exige une action humaine : la CLI Vercel refuse cette opération à un agent (`dangerous_operation_requires_user`).

2. **Le projet n'ayant aucune liaison Git**, un déploiement se ferait depuis la CLI et **remplacerait ce qui est actuellement en ligne et sain**. C'est une modification de production, irréversible en pratique, qui demande votre accord explicite.

**La production reste exactement dans l'état où MASTER 6 l'avait laissée.**

## 7. Si vous voulez le déploiement automatique

```
vercel git connect
```

ou *Settings → Git* dans l'interface, puis désigner `main` comme branche de production. **Non fait** : c'est une modification de configuration de votre projet, et elle changerait le comportement de tous les futurs push.

À noter si vous le faites : la branche par défaut du dépôt est `arena/84940ac2-garageflowsv2`, pas `main`. Il faudra désigner explicitement `main`.
