-- Pierres tombales de suppression d'intervention (GF31-AUD-044).
--
-- La remontée `/api/sync/jobs` décrit une FENÊTRE de dates, et le cloud en
-- déduisait les suppressions par ABSENCE. Deux cas échappent à cette inférence :
--   1. le poste est hors ligne au moment de la suppression et, quand il
--      resynchronise, la date de l'intervention est sortie de la fenêtre ;
--   2. la remontée est tronquée (plus de 500 interventions), auquel cas toute
--      purge par inférence est suspendue à raison (GF31-AUD-017).
-- Dans les deux cas, l'intervention supprimée restait visible indéfiniment dans
-- la PWA du mécanicien, qui pouvait se déplacer sur une intervention annulée.
--
-- Cette table est écrite par le POSTE (SQLite) ; côté serveur elle n'existe que
-- pour la parité des deux schémas Prisma, vérifiée par un test. Aucune clé
-- étrangère vers Job : la ligne survit à la disparition de l'intervention,
-- c'est précisément son objet.
--
-- ADDITIF et IDEMPOTENT : table neuve, aucune donnée existante lue ni modifiée.
--
-- Rollback :
--   DROP TABLE IF EXISTS "JobTombstone";

CREATE TABLE IF NOT EXISTS "JobTombstone" (
  "jobId"     TEXT NOT NULL,
  "garageId"  TEXT NOT NULL,
  "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JobTombstone_pkey" PRIMARY KEY ("jobId")
);

CREATE INDEX IF NOT EXISTS "JobTombstone_garageId_deletedAt_idx"
  ON "JobTombstone"("garageId", "deletedAt");
