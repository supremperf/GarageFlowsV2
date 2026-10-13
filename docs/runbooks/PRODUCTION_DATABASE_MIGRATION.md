# Runbook — migration de base PostgreSQL (production / staging)

## 0. Invariants déjà garantis par le dépôt (gardes CI)

- `check:pg-migrations` : **chaque `DROP COLUMN` est précédé d'un bloc de
  vérification bloquant** (bijection colonne par colonne) — une migration
  destructive sans preuve ne passe pas la CI.
- `check:migration-safety` : runner desktop fail-closed + ordre Electron
  sauvegarde → migration → fenêtre.
- `validate-server-db.js` : rejoue TOUTES les migrations sur une base **vide**
  + smoke test CRUD — exécuté en CI et dans le release gate.
- `prisma migrate deploy` n'applique que des migrations committées (jamais de
  diff improvisé en production).

## 1. Procédure nominale (staging d'abord, toujours)

```bash
# 1. SAUVEGARDE (obligatoire, vérifiée)
pg_dump "$DATABASE_URL" -Fc -f backup-$(date -u +%Y%m%dT%H%M%SZ).dump
pg_restore --list backup-*.dump | head   # la sauvegarde se lit

# 2. RÉPÉTITION sur STAGING (copie récente de prod)
DATABASE_URL="$STAGING_URL" DIRECT_URL="$STAGING_URL" npm run db:server:deploy
DATABASE_URL="$STAGING_URL" DIRECT_URL="$STAGING_URL" node scripts/validate-server-db.js

# 3. CONTRÔLES D'INTÉGRITÉ post-staging (comptes avant/après, invariants métier)
psql "$STAGING_URL" -c "SELECT count(*) FROM \"Invoice\""   # etc. par table critique

# 4. PRODUCTION (fenêtre de maintenance si opération verrouillante)
DATABASE_URL="$PROD_URL" DIRECT_URL="$PROD_URL" npx prisma migrate deploy --schema prisma/server/schema.prisma

# 5. VÉRIFICATION post-migration
psql "$PROD_URL" -c "SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 5"
# + sonde /api/health → 200, + un parcours de lecture métier

# 6. ROLLBACK (si nécessaire) : restaurer la sauvegarde du §1
pg_restore -d "$PROD_URL" --clean --if-exists backup-….dump
```

## 2. Interdits en production

- `prisma db push` (et surtout `--accept-data-loss`) — réservé au desktop
  SQLite et aux bases jetables de test.
- `prisma migrate reset` — détruit les données.
- Toute migration NON passée par staging + `validate-server-db`.

## 3. Points d'attention PostgreSQL managé (Neon ou équivalent)

- Utiliser l'URL **directe** (`DIRECT_URL`) pour les migrations, pas le pooler.
- Opérations longues (backfill) : privilégier les migrations en plusieurs
  étapes déjà pratiquées dans ce dépôt (ADD COLUMN → backfill → VERIFY → DROP),
  qui évitent les verrous longs.
- Neon : la fonctionnalité de **branche** permet un staging = copie de prod à
  coût quasi nul — c'est le support de répétition recommandé.

**Honnêteté** : aucune exécution contre un environnement Neon réel n'a été
faite par l'audit (pas d'accès). La procédure est prouvée sur PostgreSQL 16
local (migrations complètes sur base neuve, vertes) ; la répétition sur une
branche Neon de staging est une **validation externe** requise avant la
première migration de production.
