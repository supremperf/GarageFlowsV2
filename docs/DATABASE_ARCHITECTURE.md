# Architecture des bases de données

GarageFlow utilise **deux schémas Prisma distincts** pour deux modes d'exécution
incompatibles par nature. Un seul code applicatif, deux clients générés, choix
à l'exécution.

## Vue d'ensemble

```
prisma/
├── schema.prisma              ← DESKTOP : SQLite (Electron, mono-poste)
│                                 client généré → @prisma/client (défaut)
├── garageflow-template.db     ← template SQLite commité (installations neuves)
├── migrations/                ← migrations SQLite historiques (partielles)
└── server/
    ├── schema.prisma          ← SERVEUR : PostgreSQL (PWA multi-instance)
    │                             client généré → src/generated/server-client
    └── migrations/            ← migrations PostgreSQL reproductibles
        ├── migration_lock.toml   (provider = postgresql)
        └── 20260730120000_init_server/
```

Les deux schémas déclarent **exactement les mêmes modèles** (métier atelier +
`LicenseKey` + `LicenseDevice` + `LicenseDeviceEvent`). Seuls diffèrent le
`provider`, la sortie du générateur et les `binaryTargets`.

## Sélection du client à l'exécution (`src/lib/db.ts`)

| `DATABASE_URL`      | Client utilisé                       | Mode                    |
|---------------------|--------------------------------------|-------------------------|
| `file:…`            | `@prisma/client` (SQLite)            | Electron / dev local    |
| `postgresql://…`    | `src/generated/server-client`        | Serveur / PWA / Vercel  |

Il est donc **structurellement impossible** d'utiliser le client SQLite contre
PostgreSQL (l'ancien conflit « provider sqlite + URL postgres » qui rendait la
PWA indéployable). En complément, `src/lib/env.ts` **refuse le démarrage** d'un
serveur PWA de production sur SQLite.

## Desktop (Electron) — SQLite

- Base locale : `<userData>/garageflow.db`, injectée par `electron/main.js`
  (`DATABASE_URL=file:…`, `ELECTRON=1`).
- Création : copie du template commité `garageflow-template.db` (ou
  `prisma db push` en dernier recours).
- Évolution du schéma : migrations SQL idempotentes de `src/lib/migrations.ts`
  (86 entrées), appliquées au démarrage via `POST /api/internal/migrate`
  (protégé par `X-Internal-Key`), suivies dans la table `_gf_migrations`.
- Aucune dépendance à PostgreSQL, aucun réseau requis pour les données locales.

## Serveur / PWA — PostgreSQL

- `DATABASE_URL` : URL **poolée** (Neon/Supabase « -pooler », PgBouncer…).
- `DIRECT_URL`   : URL **directe** (non poolée) utilisée par `prisma migrate`.
- Migrations : `prisma/server/migrations/` — reproductibles sur base vide,
  vérifiées en CI à chaque commit.

## Commandes

| Commande                     | Effet                                                        |
|------------------------------|--------------------------------------------------------------|
| `npm run db:desktop:generate`| Génère le client SQLite (défaut `@prisma/client`)            |
| `npm run db:desktop:push`    | Synchronise une base SQLite de dev                           |
| `npm run db:desktop:validate`| Valide le schéma desktop                                     |
| `npm run db:server:generate` | Génère le client PostgreSQL (`src/generated/server-client`)  |
| `npm run db:server:validate` | Valide le schéma serveur                                     |
| `npm run db:server:migrate`  | `prisma migrate dev` (développement, crée une migration)     |
| `npm run db:server:deploy`   | `prisma migrate deploy` (production)                         |
| `npm run db:server:check`    | Base neuve : migrations + statut + smoke test CRUD complet   |

`npm run build` et `postinstall` génèrent **les deux** clients.

## Vérification d'une installation PostgreSQL neuve

```bash
DATABASE_URL=postgresql://… DIRECT_URL=postgresql://… npm run db:server:check
```

Le script (`scripts/validate-server-db.js`) échoue (exit ≠ 0) si :
- l'URL n'est pas PostgreSQL ;
- une migration ne s'applique pas (`prisma migrate deploy`) ;
- il reste des migrations en attente (`prisma migrate status`) ;
- la contrainte `@@unique([licenseId, hwidHash])` ou la cascade
  licence → appareils n'est pas effective.

Aucune modification manuelle de la base n'est nécessaire après
`prisma migrate deploy` — c'est prouvé par ce script et par les tests
d'intégration (`src/lib/__tests__/license-devices.postgres.int.test.ts`).

## Ajouter une évolution de schéma

1. Modifier **les deux** schémas (`prisma/schema.prisma` et
   `prisma/server/schema.prisma`) pour garder les modèles identiques.
2. Desktop : ajouter l'entrée SQL idempotente correspondante dans
   `src/lib/migrations.ts` (installations existantes) et régénérer le template
   (`prisma db push` sur un fichier neuf, commité).
3. Serveur : `npm run db:server:migrate -- --name ma_migration` (crée le
   dossier de migration PostgreSQL), puis vérifier `npm run db:server:check`
   sur une base vide.
4. La CI échoue si les schémas ne se valident pas, si une migration ne
   s'applique pas ou si les clients ne se génèrent pas.
