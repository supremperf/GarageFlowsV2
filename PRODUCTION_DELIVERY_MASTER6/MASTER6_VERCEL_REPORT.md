---
doc-numbers: journal
---

# VERCEL — rapport MASTER 6

**Verdict : BLOCAGE LEVÉ.** Le refus de déploiement Preview de MASTER 5 a disparu, un Preview a été produit et vérifié. Un fait structurel est en revanche à connaître : **le projet n'est relié à aucun fournisseur Git**, donc un push GitHub ne déclenche aucun déploiement.

## 1. Compte, équipe, projet

| | |
|---|---|
| CLI | Vercel CLI 65.1.0 |
| compte | `6y9w75w777-8325` |
| équipe | `garage-flows` — plan **Hobby** |
| projet | **`app.garageflows.fr`** (`prj_D6TzGiDffWVBjXscUSSgk5re9ymP`) |
| créé le | 30 juillet 2026 |
| cadre | Next.js, racine `.`, Node.js 24.x |

`garage-flows` est le nom de l'**équipe**, pas d'un projet. L'équipe contient `app.garageflows.fr`, `garageflows.fr` et `www.garageflows.fr` ; seul le premier a été lié et touché.

## 2. Le blocage de MASTER 5, et sa cause réelle

MASTER 5 avait obtenu, deux fois :

```
status  ● Blocked
reason  The deployment was blocked because the commit author
        doesn't have permission to create deployments for this project.
```

**Cause établie en MASTER 6** : le dépôt local n'avait **aucun remote**. Vercel recevait des métadonnées d'auteur de commit sans pouvoir rattacher le dépôt à un compte, et le contrôle du plan Hobby refusait.

**Résolution** : la configuration du remote `origin` vers `https://github.com/supremperf/GarageFlowsV2.git` a suffi. Vercel résout alors le dépôt GitHub, le rattache au compte propriétaire (`supremperf` détient les deux), et le déploiement passe.

Aucun commit n'a été réécrit, aucune identité Git modifiée, aucune protection désactivée.

## 3. Le déploiement Preview — réel et vérifié

| | |
|---|---|
| identifiant | `dpl_C1FGbnHRpggCVpuL6L9XA2BHHyHi` |
| cible | `preview` |
| statut | **● Ready** |
| URL | `https://appgarageflows-gomy2ln6k-garage-flows.vercel.app` |
| durée | ~5 min (Building → Ready, suivi en continu) |

### Protection de déploiement

Tout accès anonyme renvoie **302 vers `vercel.com/sso-api`** : la Preview est protégée par **Vercel Authentication**, un réglage du projet. Ce n'est pas un défaut applicatif.

Les endpoints ont donc été exercés via `vercel curl`, qui authentifie la requête avec le compte autorisé — c'est bien le déploiement qui répond :

| Route | Statut | Corps |
|---|---:|---|
| `/api/health` | **200** | `{"status":"ok"}` |
| `/api/ping` | **200** | `{"ok":true}` |
| `/api/auth/csrf` | **200** | jeton CSRF émis |
| `/api/clients` | **401** | `{"error":"Non autorisé","code":"UNAUTHENTICATED"}` |
| `/login` | **200** | HTML rendu |

En-têtes : HSTS `max-age=63072000; includeSubDomains; preload`, `X-Frame-Options: DENY`, **aucun `unsafe-eval`**.

## 4. Fait structurel : aucune liaison Git

Toutes les variables `VERCEL_GIT_*` de l'environnement Preview sont **vides** :

```
VERCEL_GIT_PROVIDER=""   VERCEL_GIT_REPO_OWNER=""   VERCEL_GIT_REPO_SLUG=""
VERCEL_GIT_COMMIT_SHA="" VERCEL_GIT_COMMIT_REF=""   VERCEL_GIT_COMMIT_AUTHOR_LOGIN=""
```

Et `vercel project inspect` ne montre **aucune** section « Git Repository ».

### Conséquences, à connaître

1. **Un push sur GitHub `main` ne déclenche AUCUN déploiement Vercel.** Il n'y a ni déploiement automatique, ni Preview par branche, ni rattachement d'un déploiement à un commit du dépôt.
2. Les déploiements sont créés **depuis la CLI**, manuellement.
3. Le déploiement de production actuellement en ligne n'est donc **pas** issu d'un commit GitHub traçable.

**Pour que `main` déclenche la production**, il faut connecter le projet au dépôt (`vercel git connect`, ou Settings → Git dans l'interface) et désigner `main` comme branche de production. C'est une modification de configuration de votre projet : elle n'a **pas** été faite sans votre accord.

## 5. Variables d'environnement

```
npm run check:env-vercel
══ PRODUCTION — 16 variables chez Vercel
   10/10 variables REQUISES PAR LE CONTRAT : PRESENT
✅ Toutes les variables requises existent sous leur nom canonique ;
   aucun alias interdit chez Vercel.
EXIT=0
```

**Aucune variable n'a été créée, modifiée ni supprimée.** `GF_PRIVATE_KEY` reste absente de tous les environnements — voir `MASTER6_ECC_KEY_REPORT.md`.

L'environnement **Preview** est un staging complet et distinct : intégrations Neon PostgreSQL et Upstash Redis dédiées.

## 6. Production en ligne — vérifiée, non modifiée

| | |
|---|---|
| URL | **https://app.garageflows.fr** |
| déploiement | `appgarageflows-e41ch5ymm-garage-flows.vercel.app` — **● Ready**, Production |
| âge | antérieur à cette mission |
| état | **non remplacé, non supprimé, non promu** |

Vérifications HTTP réelles (hérité MASTER 5, rejouées) : `/login` **200** en 0,317 s, `/api/health` **200** `{"status":"ok"}`, `/` **307** → `/login`, `/api/clients` **401**, `/portal` **308** → `/clients`, TLS valide, région `fra1`, en-têtes conformes sans `unsafe-eval`.

## 7. Promotion en production — non effectuée

Aucune promotion n'a été tentée. Trois raisons, dans l'ordre :

1. **Le mandat l'exige implicitement** : « Ne déploie pas en production si une réserve critique rend le déploiement dangereux. » Les réserves restantes (installateur non signé, clé de licence introuvable) ne concernent pas le serveur web, mais le déploiement doit rester votre décision.
2. **Aucun déclenchement automatique** : sans liaison Git, le push ne déploie rien — il n'y a donc pas de promotion « par défaut » à encadrer.
3. **La production actuelle est saine** : la remplacer sans nécessité serait un risque gratuit.

### Séquence recommandée, si vous décidez de promouvoir

```
1. vercel git connect                     # si vous voulez le déploiement automatique
2. vercel deploy                          # Preview depuis le commit publié
3. vercel curl <url>/api/health           # vérifier avant de promouvoir
4. vercel promote <url>   ou   vercel deploy --prod
5. relever l'identifiant de déploiement et le commit déployé
```

## 8. Hygiène de téléversement

`.vercelignore` exclut `.env*`, `keys/`, `node_modules/`, `.next/`, `dist/`, `*.exe`, `artifacts/`, et — ajouté en MASTER 5 — les bases SQLite locales (avec exception explicite pour le modèle committé) ainsi que les dossiers de preuves et artefacts locaux.

Le `.env.local` créé par `vercel link` (jeton OIDC de courte durée) a été **supprimé** après usage.
