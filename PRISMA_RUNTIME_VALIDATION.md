---
doc-numbers: journal
---

# Validation du runtime Prisma — MASTER 2

**Date : 22 octobre 2026 — Base : `150654535ca0b3b417e96be057ba674a119c512f`**  
**Verdict : BLOQUÉ — aucun moteur Prisma natif généré ou chargé.**

## 1. Environnement et cibles réelles

| Élément | Mesure |
|---|---|
| Node / npm d’exécution | 22.22.3 / 10.9.8 ; projet épinglé sur npm 11.16.0 |
| Plateforme | Linux x64, OpenSSL 3.5.6 |
| Prisma / client | 5.22.0 / 5.22.0 |
| Commit des moteurs | `605197351a3c8bdd595af2d2a9bc3025bca48ea2` |
| Générateur SQLite | `native`, `windows`, `debian-openssl-3.0.x` |
| Générateur serveur | `native`, `rhel-openssl-3.0.x`, `debian-openssl-3.0.x` |

Ces cibles sont cohérentes avec le desktop Windows et les runtimes Linux déclarés. Aucune cible n’a été ajoutée ou remplacée pour faire passer la génération.

## 2. Diagnostic TLS reproduit

Le diagnostic `scripts/diagnose-prisma-runtime.cjs` donne :

- DNS résolu pour `binaries.prisma.sh` et `registry.npmjs.org` ;
- HTTPS npm : statut 200, TLS établi et autorisé ;
- HTTPS Prisma : `ECONNRESET`, **TLS non établi**, aucun statut HTTP ;
- aucun proxy HTTP(S), miroir Prisma, chemin de moteur ou certificat additionnel configuré ;
- npm `strict-ssl=true`, 145 certificats racines Node ;
- aucune variable de contournement `noEngine` active dans le diagnostic.

Une réinitialisation avant la négociation TLS ne prouve pas un certificat invalide. Elle indique un blocage réseau/policy sur le chemin de l’hôte Prisma. Aucune validation de certificat n’a été désactivée.

## 3. Recherche d’un canal officiel

- Les caches Prisma inspectés ne contiennent aucun moteur natif.
- Le tarball officiel `@prisma/engines@5.22.0` contient 10 fichiers, 95 026 octets décompressés : JavaScript, scripts et licence, **aucun binaire de requête**.
- La release GitHub officielle `prisma/prisma` tag `5.22.0` a **0 asset**.
- `prisma/prisma-engines` expose **0 release GitHub** ; le commit attendu est néanmoins confirmé au 5 novembre 2024.
- Aucun paquet officiel `@prisma/query-engine-*` ou `@prisma/engines-<plateforme>` correspondant n’a été trouvé.
- `cargo`, `rustc` et un cache Cargo sont absents : compiler les sources officielles n’est pas une solution locale disponible.

Aucun moteur tiers, WASM, `/dev/null` ou binaire d’une autre version n’a été substitué.

## 4. Conséquences mesurées

- `npm run build` sort 1 pendant `prisma generate`, avant Next.js.
- La suite DB appelle le même hôte pour les fichiers SHA-256 du moteur Debian et échoue.
- Aucun `libquery_engine*.node`, `query-engine-*` ou `schema-engine-*` utilisable n’a été trouvé dans les caches et artefacts inspectés.
- Le standalone issu de la compilation isolée est refusé par `verify:standalone`.
- `/api/health` répond 503 : le client historique `noEngine` exige `prisma://` et ne valide pas SQLite.

## 5. Condition de clôture

1. Autoriser l’accès sortant à `binaries.prisma.sh` **ou** fournir un cache/miroir approuvé contenant les artefacts officiels et leurs SHA-256.
2. Exécuter `npm ci` puis les deux générations sans `noEngine`, sur un hôte propre.
3. Vérifier version/commit, plateforme et chargement de chaque moteur ; obtenir le moteur Windows sur la chaîne de packaging.
4. Exécuter les validations SQLite/PostgreSQL de `DATABASE_VALIDATION.md`, puis le build et le standalone officiels.

Preuves : `03-prisma-tls-diagnostic.txt`, `04-prisma-environment.txt`, `07-prisma-npm-channel.txt`, `08-prisma-github-channel.txt`, `09-prisma-fetch-internals.txt`, `18-official-and-partial-build.txt`, `30-standalone-server-local-config.txt` et `31-standalone-smoke.txt` dans `artifacts/verification/production-readiness-2026-10-22/`.
