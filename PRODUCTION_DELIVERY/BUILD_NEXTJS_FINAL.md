---
doc-numbers: journal
---

# BUILD NEXT.JS ET SORTIE STANDALONE — état final MASTER 5

**Verdict : RÉSOLU.** Le build de production aboutit, la sortie autonome est complète, **le serveur autonome démarre et répond à de vraies requêtes HTTP**.

## 1. État MASTER 4

- `npm run build` : code 1 **à la première génération Prisma**, avant même `next build` ; `BUILD_ID` absent.
- `npm run verify:standalone` : code 1, dossier et serveur absents ; démarrage et routes `NOT RUN`.

## 2. Build de production

```
$ npm run build
> prisma generate && prisma generate --schema prisma/server/schema.prisma && node scripts/next-build.cjs

   ▲ Next.js 15.5.28
   ✓ Compiled successfully in 2.9min
   Linting and checking validity of types …
   Collecting page data …
   ✓ Generating static pages (18/18)
   Finalizing page optimization …
   Collecting build traces …
EXIT=0
```

`BUILD_ID` présent. 18 pages générées, middleware 59,7 ko, « First Load JS shared by all » 103 ko.
Preuve : `MASTER5_EVIDENCE/logs/12-next-build.txt`.

## 3. Sortie autonome — contenu vérifié

`scripts/post-build.js` (déclenché par `postbuild`) :

```
  ✅ server.js found        (6.6 KB) → .next/standalone/server.js
  ✅ static assets copied   (246 files) → .next/standalone/.next/static
  ✅ public dir copied       (10 files) → .next/standalone/public
  ✅ Prisma client copied   (13 files) → standalone node_modules/.prisma
  ✅ secrets retirés du package : .env (jamais distribués)
  ✅ Prisma schema + empty release template copied
  ✅ public.pem copied      → standalone/keys
  ✅ aucune clé privée dans standalone (0 purgée(s))
  ✅ icon.ico found
  ✅ release-manifest.json généré + inclus → standalone (artefact rattachable)
```

```
$ npm run verify:standalone
🔎 Sortie autonome : .next\standalone
✅ Sortie autonome complète (4 éléments vérifiés) — prête à être empaquetée.
```

### La racine de traçage, et pourquoi elle compte

`next.config.mjs` fixe explicitement `outputFileTracingRoot: PROJECT_ROOT`. Sans ce réglage, Next.js infère la « racine de workspace » en remontant les fichiers de verrouillage : un `package-lock.json` parasite dans le dossier utilisateur suffit à produire `.next/standalone/Desktop/GarageFlowsV2-…/server.js` — donc introuvable à `.next/standalone/server.js`, et un dossier IMBRIQUÉ embarqué dans l'installateur. Ce poste **contient** un tel `package-lock.json` parasite (`C:\Users\Mathys\`) : le réglage a donc été actif et nécessaire ici. Il reste verrouillé par `tests/next-config-standalone-root.test.cjs`.

## 4. Le serveur autonome démarre et répond — requêtes HTTP RÉELLES

Lancé en `NODE_ENV=production` sur le port 4133, contre un **PostgreSQL local jetable** (base créée puis supprimée) et l'instance **Upstash de Preview**.

```
 ✓ Ready in 399ms
```

| Requête | Statut | Temps | Observation |
|---|---:|---:|---|
| `GET /api/health` | **200** | 10 ms | `{"status":"ok"}` |
| `GET /login` | **200** | 133 ms | rendu de production réel |
| `GET /` | **307** | 20 ms | → `/login?callbackUrl=%2F` |
| `GET /api/ping` | **200** | 17 ms | |
| `GET /api/clients` (sans session) | **401** | 324 ms | API privée fermée |
| `GET /portal` | **308** | 6 ms | → `/clients` (redirection permanente, QR codes déjà imprimés) |
| `GET /clients` | **307** | 2 ms | → `/clients/login` |
| `GET /chemin-qui-nexiste-pas` | **307** | 20 ms | le middleware protège avant tout 404 |

En-têtes de sécurité relevés sur `/login` :

| En-tête | Valeur |
|---|---|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; …` |
| **`unsafe-eval` présent** | **false** — correctement restreint au développement |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |

```
RESULT=PASS
base de contrôle supprimée : gf_standalone_9bb73361052c
```

Preuve : `MASTER5_EVIDENCE/logs/37-standalone-http.txt`.

## 5. Un comportement *fail-closed* confirmé au passage

Le premier essai de démarrage a été **refusé par le produit lui-même** :

```
Failed to prepare server: Démarrage refusé — variables d'environnement invalides :
  UPSTASH_REDIS_REST_URL (doit être l'URL REST https:// (…upstash.io) — pas rediss:// ni une valeur malformée),
  TRUST_PROXY_HEADERS (proxy de confiance non déclaré en production PWA — définissez TRUST_PROXY_HEADERS=1
    (derrière un proxy fiable) sinon les limites de débit s'effondrent en un seul bucket).
```

Ce refus est le comportement correct, et il est consigné ici comme preuve positive : l'instrumentation n'autorise pas un démarrage de production sans limiteur de débit distribué valide ni déclaration explicite du proxy. Les redirections de `next.config.mjs` (`/portal` → `/clients`) fonctionnaient déjà à ce stade, le middleware s'exécutant avant l'instrumentation.

Le contrôle a ensuite été rejoué avec une URL REST Upstash valide (instance de **Preview**, jamais la production) et `TRUST_PROXY_HEADERS=1`.

## 6. Un défaut de portabilité corrigé dans la chaîne SBOM

`scripts/gen-production-sbom.mjs` appelait `spawnSync('npx', …)`. Sous Windows, `npx` est `npx.cmd` : l'appel échouait en `ENOENT`, et toute la chaîne `sbom:generate` / `sbom:verify` était inutilisable sur la **plateforme cible du produit**. Le script résout désormais le script JS de npm livré avec l'interpréteur courant (`node_modules/npm/bin/npx-cli.js`) et l'exécute avec `process.execPath` — aucun shell traversé, même chemin de code sur Linux, macOS et Windows.

## 7. Confirmation par la porte de release

```
▶ Build de production (next build)… OK (204s)
▶ Budget de performance (bundle client)… OK (1s)
```

Preuve : `MASTER5_EVIDENCE/logs/36-release-gate.txt`.
