# Release Process

> **Document canonique : [`scripts/final-release-gate.mjs`](../../../scripts/final-release-gate.mjs)** — cette fiche de data room est
> un pointeur : le contenu fait foi à l'emplacement canonique (anti-divergence).

Fast checks par PR (CI), gate complet avant release : npm run release:gate (tsc, lint, 10 gardes, tests, PG/Redis réels, audit dépendances, build, budget perf). Windows : dist:win + Authenticode (validation externe).

## Publier une version — commande unique

`npm run release:publish` enchaîne, dans cet ordre et en s'arrêtant au premier
échec :

1. `node scripts/check-version.js` — validation SemVer et cohérence
   `package.json` ⇄ `package-lock.json`. **La porte ne le faisait pas** :
   `verify-artifact.mjs` ne compare que `manifest.packageVersion` à
   `pkg.version`, ce qui laisse passer une version non SemVer.
2. `npm run release:gate` — la porte complète (contrôles ci-dessus).
3. `npm run dist` — build desktop, `post-build.js`, `electron-builder`, puis
   `check:artifact-secrets` et `check:artifact-fuses` sur l'artefact **livré**.
   La porte n'inspectait que l'archive source : l'installateur `.exe` remis au
   client n'était contrôlé par aucune étape de `release:gate`.
4. `npm run release:sign` — signature du manifeste de mise à jour, avec
   vérification de cohérence version ⇄ nom de fichier ⇄ URL.

### Migrer la base cloud AVANT de déployer — étape MANUELLE, et pourquoi

**Ordre obligatoire** : la base d'abord, le code ensuite.

```
npm run db:server:deploy      # prisma migrate deploy --schema prisma/server/schema.prisma
vercel deploy --prod
```

**Pourquoi l'ordre compte.** Le client Prisma sélectionne **toutes** les
colonnes scalaires du schéma quand aucun `select` n'est donné. Une colonne
présente au schéma mais absente en base fait donc répondre **500** à toute route
qui lit la table — sans que rien ne l'ait annoncé. Déployer avant de migrer
ouvre cette fenêtre ; migrer avant de déployer ne casse rien, les migrations
étant additives (l'ancien code ignore simplement les nouvelles colonnes).

**Pourquoi ce n'est PAS automatisé** (essayé le 15/08/2026, ne fonctionne pas) :
un script `vercel-build` enchaînant `prisma migrate deploy && npm run build`
échoue avec `P1013 — the scheme is not recognized`. En effet
`DATABASE_URL` et `DIRECT_URL` sont déclarées **`type=sensitive`** dans le
projet Vercel, et les variables sensibles sont — par conception de la
plateforme — **indisponibles pendant le build** : elles n'existent qu'à
l'exécution. Automatiser la migration exigerait de retirer ce marquage, ou d'en
déposer une copie lisible au build : dans les deux cas, un identifiant de base
de production deviendrait lisible par n'importe quelle étape de build. Le
compromis n'en vaut pas la peine — l'étape reste manuelle et volontaire.

**Le fait que le build échoue est le garde-fou.** Si la migration ne passe pas,
le build s'arrête, le nouveau code n'est jamais promu et le déploiement
précédent reste en ligne. C'est ce qui s'est produit lors de l'essai : la
production n'a pas été touchée une seconde.

### Le canal PWA reste une étape SÉPARÉE

`release:publish` ne déploie **pas** la PWA, et il ne faut pas l'y chaîner : les
deux canaux ont des cycles distincts et un déploiement cloud raté ne doit pas
laisser un installateur à moitié publié. Après `release:publish`, déployer
explicitement :

```
vercel deploy --prod
```

Publier l'installateur ne met donc **jamais** la PWA à jour, et inversement. Les
correctifs qui touchent aux deux (par exemple la voie de retour de
synchronisation) exigent les deux commandes.
