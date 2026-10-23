---
doc-numbers: journal
---

# VERCEL ET DÉPLOIEMENT — état final MASTER 5

**Verdict mixte.** La **production est en ligne, saine et vérifiée** par de vraies requêtes HTTP. Le **nouveau déploiement Preview est BLOQUÉ par une permission de plateforme Vercel** — cause identifiée, correctif en une action manuelle, aucun contournement appliqué.

## 1. Compte, équipe et projet

| Élément | Valeur |
|---|---|
| CLI | Vercel CLI 65.1.0 (Node.js 22.23.2) |
| compte authentifié | `6y9w75w777-8325` |
| équipe | `garage-flows` — **plan Hobby** |
| projet cible | **`app.garageflows.fr`** (`prj_D6TzGiDffWVBjXscUSSgk5re9ymP`) |
| organisation | `team_t49LR1PNAwDSvWJtWGhYD66w` |
| lien local | `.vercel/project.json` créé par `vercel link` sur le projet **existant** (aucune création) |

**Précision de périmètre** : l'énoncé de mission désignait « le projet Vercel cible : garage-flows ». `garage-flows` est le nom de **l'ÉQUIPE**, pas d'un projet. L'équipe contient trois projets : `app.garageflows.fr`, `garageflows.fr`, `www.garageflows.fr`. Seul `app.garageflows.fr` a été lié et vérifié ; les deux autres n'ont pas été touchés.

## 2. Production en ligne — vérifications HTTP réelles

| Contrôle | Résultat |
|---|---|
| `GET https://app.garageflows.fr/` | **307** → `https://app.garageflows.fr/login?callbackUrl=%2F` — 1,089 s (connexion TLS incluse) |
| `GET https://app.garageflows.fr/login` | **200**, 9 450 octets — **0,284 s**, `X-Vercel-Cache: HIT` |
| `GET https://app.garageflows.fr/api/health` | **200** `{"status":"ok"}` |
| HTTPS / TLS | valide (`ssl_verify_result = 0`) |
| région | `fra1` (`X-Vercel-Id: fra1::…`) |
| `Server` | `Vercel` |

En-têtes relevés sur `/login` — identiques à ce que déclare `next.config.mjs` :

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; … frame-ancestors 'none'; base-uri 'self'; form-action 'self'
Strict-Transport-Security: max-age=63072000; includeSubDomains
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
X-Nextjs-Prerender: 1
```

Aucun `unsafe-eval` : la CSP de production est bien la variante durcie.

Le déploiement en ligne est antérieur à cette mission (`appgarageflows-e41ch5ymm-garage-flows.vercel.app`, statut `● Ready`, environnement Production, durée de build 3 min, auteur `6y9w75w777-8325`). **Il n'a pas été modifié, ni remplacé, ni supprimé.**

## 3. Variables d'environnement

```
$ npm run check:env-vercel
══ PRODUCTION — 16 variables chez Vercel
   10/10 variables REQUISES PAR LE CONTRAT : PRESENT
✅ Toutes les variables requises existent sous leur nom canonique ; aucun alias interdit chez Vercel.
EXIT=0
```

Détail et analyse des deux absences fonctionnelles (`GF_PRIVATE_KEY`, `GARAGEFLOW_LLM`/`ANTHROPIC_API_KEY`) : `ENV_AUDIT_FINAL.md`.

Un environnement **Preview** complet est provisionné et séparé : intégration **Neon PostgreSQL** et intégration **Upstash Redis**, avec des secrets applicatifs distincts. C'est cet environnement qui a servi aux tests PostgreSQL et Redis réels — **jamais la production**.

**Aucune variable n'a été créée, modifiée ni supprimée.**

## 4. Le projet n'est connecté à AUCUN fournisseur Git

Toutes les variables `VERCEL_GIT_*` de l'environnement Preview sont vides :

```
VERCEL_GIT_PROVIDER=""     VERCEL_GIT_REPO_OWNER=""   VERCEL_GIT_REPO_SLUG=""
VERCEL_GIT_COMMIT_SHA=""   VERCEL_GIT_COMMIT_REF=""   VERCEL_GIT_COMMIT_AUTHOR_LOGIN=""
```

Les déploiements sont donc créés **depuis la CLI**, pas par intégration Git. Il n'y a ni déploiement automatique sur `push`, ni Preview par branche, ni rattachement d'un déploiement à un commit du dépôt amont.

## 5. BLOCAGE — le Preview a été créé puis refusé

Deux tentatives, même résultat :

```
$ vercel deploy --yes
  Inspect   https://vercel.com/garage-flows/app.garageflows.fr/BgEV5uhPrWLnHfbfPsAmhn4cMY3G
  Preview   https://appgarageflows-gt4l5xbbp-garage-flows.vercel.app

$ vercel inspect https://appgarageflows-gt4l5xbbp-garage-flows.vercel.app
    target  preview
    status  ● Blocked
    reason  The deployment was blocked because the commit author doesn't have
            permission to create deployments for this project.
```

### Cause établie

L'équipe est en plan **Hobby**, qui refuse un déploiement dont **l'auteur du commit Git** n'est pas rattaché au compte Vercel. Le déploiement de production antérieur avait réussi parce que, à ce moment-là, **le dossier n'était sous aucun dépôt Git** : aucune métadonnée d'auteur n'était transmise, donc aucun contrôle d'auteur n'était appliqué.

Depuis l'initialisation du dépôt dédié (autorisée, et nécessaire pour rétablir le contrôle de sécurité GF-DUR-044, le `buildId` de l'artefact et le `baseCommit` du manifeste de readiness), la CLI transmet l'auteur `Mathys <molliardmathys@gmail.com>`, que Vercel ne rattache pas au compte.

### Correctif

Une action manuelle d'une minute : ajouter `molliardmathys@gmail.com` aux adresses du compte Vercel (Settings → Account → Emails), ou y connecter le compte GitHub correspondant. Le déploiement Preview repart alors **en conservant la traçabilité du commit**.

### Ce qui a été refusé

Déployer depuis une copie dépourvue de `.git` pour échapper au contrôle d'auteur. Cela aurait fonctionné — c'est la méthode du déploiement actuel — mais aurait produit un artefact **non rattachable à un commit**, c'est-à-dire exactement le défaut de traçabilité corrigé pendant cette mission.

## 6. Conséquences du blocage

Trois vérifications prévues restent **non exécutées**, et aucune n'est présentée comme réussie :

| Vérification | État |
|---|---|
| parcours Playwright authentifiés contre une Preview (90 tests) | **BLOCKED** — double prérequis : Preview déployée **et** licence GF2 signée (voir `LICENCES_CRYPTO_FINAL.md §5`) |
| isolation des données entre Preview et Production vérifiée en service | **BLOCKED** — les variables Preview et Production sont distinctes et ont été constatées comme telles, mais aucune Preview servante n'a pu être interrogée |
| essai de charge (`scripts/loadtest.mjs`) contre une Preview | **NON EXÉCUTÉ** |

## 7. Promotion en production : non effectuée, et non demandée

Conformément à l'arbitrage retenu — « Preview d'abord, puis demander » — **aucune promotion en production n'a été tentée**. La production reste le déploiement antérieur, vérifié sain au §2.

Lorsque le Preview sera débloqué, la séquence recommandée est :

1. `vercel deploy` → vérifier `/api/health`, `/login`, les redirections et les en-têtes sur l'URL de Preview ;
2. exécuter les parcours authentifiés si une licence de test est disponible ;
3. **demander l'autorisation** avant `vercel promote` ou `vercel deploy --prod` ;
4. conserver l'identifiant du déploiement et le commit déployé dans les preuves.

## 8. Hygiène de téléversement corrigée

`.vercelignore` excluait déjà `.env*`, `keys/`, `node_modules/`, `.next/`, `dist/`, `*.exe`, `artifacts/`. Deux ajouts :

- **bases SQLite locales** `prisma/*.db` (+ journaux WAL/SHM), avec l'exception explicite `!prisma/garageflow-template.db` — le modèle committé reste requis par `scripts/post-build.js`. Les bases `dev.db` et `e2e.db` étaient téléversées vers la plateforme de build : inutile et contraire à l'hygiène ;
- **preuves et artefacts locaux** : `MASTER4_EVIDENCE/`, `MASTER5_EVIDENCE/`, `release/`, `e2e/shots/`, `playwright-report/`, `test-results/`, `.tmp-*/`.

Par ailleurs, `vercel link` a créé un `.env.local` porteur d'un jeton OIDC de courte durée ; ce fichier a été **supprimé** du dossier projet après usage. `vercel link` ajoute aussi `.vercel` et `.env*` à `.gitignore` à chaque exécution — c'est ce comportement qui avait fini par masquer `.env.example` (voir `VITEST_FINAL.md §3.2`).
