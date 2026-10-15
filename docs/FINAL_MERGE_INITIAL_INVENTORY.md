<!-- doc-status: historique -->
> **⚠️ DOCUMENT HISTORIQUE — instantané daté, ne fait plus foi.**
> Ne pas utiliser comme source de vérité pour un déploiement actuel.
> Source de vérité : **[./PRODUCTION-READINESS.md](./PRODUCTION-READINESS.md)**.

# GarageFlow — Inventaire initial de la fusion finale unifiée

> État **avant** toute modification, établi au démarrage de la fusion.
> Base = branche `hardening` ; fonctionnalité portée = branche `mechanic-licenses`.

## 1. Branches et topologie Git

| Élément | Valeur |
|---|---|
| Base imposée (hardening v4) | `origin/claude/garageflow-hardening-production-0acqfe` (`f9b91f9`) |
| Fonctionnalité à porter | `origin/claude/garageflow-mechanic-licenses-rq68dj` (`281a4c3`) |
| Ancêtre commun (merge-base) | `main` (`e3ac5f5`) |
| Branche de travail | `claude/garageflow-final-unified-merge-ub0l67` |

**Topologie vérifiée** : `hardening = main + 39 commits` ; `mechanic = main + 2 commits`.
Les deux branches divergent du **même** ancêtre `main`, ce qui rend possible une
**fusion 3-way** propre (et non une copie de fichiers). La branche de travail a été
avancée en fast-forward sur `hardening` (base), puis `mechanic` y a été fusionnée.

Les 2 commits mechanic portés :
- `199a18f feat(mechanic): licences mécanicien + espace mécanicien restreint (PWA + EXE)`
- `281a4c3 fix(mechanic): rejette un recordMac absent pour les clés mécanicien (F1)`

## 2. Empreintes de fichiers (fichiers suivis, hors `.git`)

| Métrique | hardening | mechanic | fusion (HEAD initial) |
|---|---:|---:|---:|
| Fichiers suivis | 592 | 581 | 623 |
| Fichiers de test (`*.test.ts(x)`, `__tests__/`) | 81 | 70 | 85 |
| Routes API (`app/api/**/route.ts`) | 125 | — | 139 |
| Modèles Prisma (desktop / serveur) | 40 / 40 | — | 40 / 40 |
| Routes de l'espace mécanicien (`app/api/mechanic*`) | 0 | — | 16 |

La fusion **ajoute** 42 fichiers mechanic sans en supprimer aucun de hardening.

## 3. Fichiers modifiés par chaque branche (depuis `main`)

- **hardening** : 104 fichiers (protections Electron, middleware NextAuth-first, chiffrement SMTP, clé publique canonique, migrations défensives, scripts/docs).
- **mechanic** : 47 fichiers (dont 39 nouveaux fichiers de fonctionnalité).
- **Intersection (fusion ligne-à-ligne requise)** : 8 fichiers
  `electron/main.js`, `prisma/schema.prisma`, `prisma/server/schema.prisma`,
  `scripts/keygen.py`, `scripts/keygen_db.py`, `scripts/keygen_ui.py`,
  `src/lib/migrations.ts`, `src/middleware.ts`.

## 4. Inventaire des migrations

- **SQLite (desktop)** — `src/lib/migrations.ts` : 148 entrées idempotentes id-clé
  (hardening 120-129 = index UNIQUE réparés + RepairTypePart/Part/JobPart ;
  mechanic renumérotées 130-148).
- **PostgreSQL (serveur)** — `prisma/server/migrations/` : 7 migrations
  (`…_init_server`, `…_link_license_garage`, `…_premium_modules`,
  `…_enterprise_portal`, `20260804000000_mechanic_licenses`,
  `…_link_repairtypepart_garage`, `…_add_part_jobpart_indexes`).

## 5. Modèles Prisma mécanicien (ajoutés par la fusion)

`LicenseKey` (+ champs mechanic : `parentLicenseId`, `mechanicId`, `mechanicHint`,
`assignedAt`, `assignedBy`, `suspendedAt`), `MechanicLicenseAssignment` (append-only),
`JobMechanicNote` (append-only), `MechanicActionAudit`. `JobPhoto.mechanicId` ajouté.

## 6. Routes API mécanicien (16, ajoutées)

Administration (staff) : `mechanic-licenses` (GET/POST), `[lid]/assign`,
`[lid]/status`, `[lid]/disconnect`, `[lid]/token`.
Espace mécanicien : `mechanic/me`, `mechanic/schedule`, `mechanic/logout`,
`mechanic/jobs/[id]`, `.../timer`, `.../photos`, `.../notes`,
`.../checklist/[itemId]`, `mechanic/photos/[...path]`, et `license/activate`
(chemin mécanicien ajouté).

## 7. Scripts et documentation critiques (présents — à conserver)

`.vercelignore`, `CONFIGURER-GARAGEFLOW.cmd`, `RESET-GARAGEFLOW.cmd`,
`scripts/configurer-api-garageflow.ps1`, `scripts/reset-garageflow.ps1`,
`scripts/garageflow-env-manifest.json` (1544 lignes), `scripts/fuse-config.js`,
`scripts/encrypt-smtp-secrets.js`, `docs/CONFIGURATION_ENVIRONNEMENT.md`,
`docs/RESTAURATION_GARAGEFLOW.md`, `docs/ROTATION_SECRETS.md`,
`AUDIT_RAPPORT.md`, `AUDIT_TRACKER.md`.

## 8. Dépendances et variables d'environnement

- Runtime : Node 22, Next.js, React, Prisma **5.16.x** (client desktop `@prisma/client`
  + client serveur `src/generated/server-client`), Vitest, `zod ^4`, `bcryptjs`, `jose`,
  `@electron/fuses`.
- Variables mécanicien / sécurité observées : `GF_MAX_MECHANIC_KEYS`, `GF_DB_MAC_SECRET`,
  `GF_LICENSE_SERVER`, `GF_PHOTOS_DIR`, `GF_SMTP_CIPHER_KEY`, `GF_SMTP_CIPHER_KEY_OLD`,
  `GF_MECHANIC_TIMER_AUTOCOMPLETE` (ajoutée §8), `ELECTRON`, `ELECTRON_DEV`,
  `NEXTAUTH_SECRET`, `TRUST_PROXY_HEADERS`, `UPSTASH_*`.

## 9. État de référence (baseline vérifiée sur l'arbre fusionné, avant corrections)

- `prisma validate` (desktop) : **valide**.
- `prisma validate` (serveur, avec `DATABASE_URL`/`DIRECT_URL`) : **valide**.
- `tsc --noEmit` : **0 erreur**.
- `vitest run` : **82 fichiers OK / 3 ignorés ; 869 tests OK / 26 ignorés ; 0 échec**.

Cette baseline verte prouve que la résolution de fusion compile et ne casse aucun
test existant, **avant** l'application des corrections du système mécanicien.
