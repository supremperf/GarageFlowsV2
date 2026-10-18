# Configuration de l'environnement — GarageFlow

> **Document stable — remplace les anciennes notes `RESET_GARAGEFLOW_Vxxx`.**
> Ce guide décrit *comment* configurer et vérifier l'environnement. La liste de
> référence des variables se trouve dans
> [VARIABLES_ENVIRONNEMENT.md](VARIABLES_ENVIRONNEMENT.md) ; la rotation des
> secrets dans [ROTATION_SECRETS.md](ROTATION_SECRETS.md).

Aucune valeur secrète ne figure dans ce dépôt ni dans cette documentation. Tous
les exemples utilisent des **placeholders**.

---

## 1. Architecture à trois bases de données

GarageFlow s'exécute dans deux mondes incompatibles par nature (poste unique
hors-ligne vs. service web multi-instance). Un **seul code**, trois cibles de
base de données selon le contexte. L'aiguillage se fait **à l'exécution, d'après
le schéma (`scheme`) de l'URL** `DATABASE_URL` (voir `src/lib/db.ts`).

| Cible | Variable | Valeur / forme | Utilisée par | Rôle |
|---|---|---|---|---|
| **SQLite desktop** | `DATABASE_URL` | `file:./dev.db` | Electron, dev local | Base locale mono-poste, aucun réseau. Client `@prisma/client` (SQLite). |
| **Neon POOLÉ** | `DATABASE_URL` | `postgresql://…-pooler…` | PWA / serveur (Vercel) | Requêtes applicatives runtime via pooler (PgBouncer). Client `src/generated/server-client`. |
| **Neon DIRECT** | `DIRECT_URL` | `postgresql://…` (non poolée) | `prisma migrate` | Migrations reproductibles (connexion directe, sans pooler). |

**Règle d'aiguillage :** si `DATABASE_URL` commence par `file:` → client SQLite ;
si elle commence par `postgresql://` → client PostgreSQL généré. Il est donc
**structurellement impossible** d'utiliser le client SQLite contre PostgreSQL.
En complément, `src/lib/env.ts` **refuse le démarrage** d'un serveur PWA de
production adossé à SQLite.

> **Interdiction absolue :** jamais de `file:` / SQLite en production web. Un
> déploiement Vercel doit recevoir des URL PostgreSQL Neon (`DATABASE_URL`
> poolée + `DIRECT_URL` directe) et rien d'autre.

Voir aussi [DATABASE_ARCHITECTURE.md](DATABASE_ARCHITECTURE.md) pour les deux
schémas Prisma et les commandes `db:*`.

---

## 2. Fichiers `.env` réellement utilisés

- Un **seul** fichier `.env` est généré à la racine par
  `scripts/setup-dev.js` (lancé automatiquement via `postinstall` et `predev`,
  ou manuellement `npm run setup`).
- `setup-dev.js` **sort immédiatement** si la variable `VERCEL` est présente :
  sur un build Vercel, la base est PostgreSQL et les variables proviennent de la
  plateforme. Créer un `.env` `file:./dev.db` y serait au mieux inutile
  (`process.env` prime), au pire trompeur.
- En dev, le fichier reçoit `DATABASE_URL="file:./dev.db"` et un
  `NEXTAUTH_SECRET` **aléatoire par installation** (jamais écrasé s'il est déjà
  fort ; jamais affiché ; `.env` mis en `chmod 600`).
- `setup-dev.js` **répare** aussi un `DATABASE_URL` historiquement erroné
  (`file:./prisma/dev.db`, `file:prisma/dev.db`) en le réécrivant vers
  `file:./dev.db` — Prisma résout un `file:` relatif **au dossier du schéma**
  `prisma/`, donc la bonne valeur est bien `file:./dev.db`.
- `.env.example` sert de modèle documentaire (placeholders vides). Les fichiers
  `.env` et `keys/*.json` ne sont **pas** suivis par git.

---

## 3. Première configuration

Objectif : générer/compléter les variables locales et les secrets manquants,
sans jamais écraser une valeur forte existante.

```bash
npm run env:configure
```

Sous Windows, l'outil interactif équivalent est
`scripts/configurer-api-garageflow.ps1` (lançable via le double-clic
`CONFIGURER-GARAGEFLOW.cmd`). Il s'appuie sur le manifeste
`scripts/garageflow-env-manifest.json` pour connaître, pour chaque variable, son
scope, son caractère obligatoire en production, son format et si elle est
générable.

Ce que fait la configuration :

- génère les secrets **auto-générables** absents (voir colonne « Générable »
  dans [VARIABLES_ENVIRONNEMENT.md](VARIABLES_ENVIRONNEMENT.md)) ;
- **ne touche jamais** aux secrets externes (URL Neon, tokens Upstash, clés
  privées) : ils doivent être fournis par l'opérateur ;
- ne persiste ni n'exporte les secrets à portée `desktop-runtime`
  (`GF_INTERNAL_EXPORT_KEY`), générés en mémoire par Electron à chaque process.

---

## 4. Vérification et réparation

Un contrôle non destructeur, sans écriture, est disponible :

```bash
npm run env:check
```

Il correspond à l'exécution de `scripts/configurer-api-garageflow.ps1` en mode
`-CheckOnly` : l'outil **vérifie** la présence, le format et la cohérence des
variables (par ex. `DATABASE_URL` desktop = `file:`, `DATABASE_URL` serveur =
PostgreSQL poolée, `DIRECT_URL` directe, décodage 32 octets de `GF_BACKUP_KEY`,
etc.) **sans rien modifier**. Il signale ce qui manque ou ne respecte pas le
format, puis vous relancez `npm run env:configure` pour réparer.

Ordre recommandé : `env:check` (diagnostic) → corriger/`env:configure` →
`env:check` de nouveau (doit être vert).

---

## 5. Points de vigilance production

- `DATABASE_URL` (poolée) et `DIRECT_URL` (directe) sont **sensibles** côté
  Vercel : une fois enregistrées, elles ne se relisent pas en clair. Validez les
  URL PostgreSQL **avant** l'envoi, confirmez leur présence
  (`vercel env ls production`), puis contrôlez `GET /api/health` **après**
  redéploiement.
- Aucune variable n'a de **repli codé en dur** : une valeur absente ou générique
  fait échouer le démarrage en production, jamais un contournement silencieux.
- Toute modification de variable Vercel exige un **redéploiement** pour prendre
  effet.
