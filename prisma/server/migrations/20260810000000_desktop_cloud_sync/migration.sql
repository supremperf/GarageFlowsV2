-- Synchronisation POSTE (Electron/SQLite) → CLOUD (PostgreSQL).
--
-- 1) LicenseKey."cloudSyncedAt" : horodatage du dernier accusé de réception du
--    serveur pour une attribution de clé mécanicien. Utile côté poste ; présent
--    ici pour garder les deux schémas strictement identiques.
-- 2) PortalSnapshot : contenu du portail client publié par un poste. Sans lui,
--    un lien portail émis depuis l'EXE s'ouvrait sur « Token invalide », les
--    données de l'intervention n'existant que dans le SQLite du poste.
--
-- ADDITIF et IDEMPOTENT : aucune donnée existante n'est lue, modifiée ou
-- supprimée. Rollback :
--   DROP TABLE IF EXISTS "PortalSnapshot";
--   ALTER TABLE "LicenseKey" DROP COLUMN IF EXISTS "cloudSyncedAt";

ALTER TABLE "LicenseKey" ADD COLUMN IF NOT EXISTS "cloudSyncedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "PortalSnapshot" (
    "id"        TEXT NOT NULL,
    "garageId"  TEXT NOT NULL,
    "jobId"     TEXT NOT NULL,
    "payload"   TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PortalSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PortalSnapshot_garageId_idx"  ON "PortalSnapshot"("garageId");
CREATE INDEX IF NOT EXISTS "PortalSnapshot_jobId_idx"     ON "PortalSnapshot"("jobId");
CREATE INDEX IF NOT EXISTS "PortalSnapshot_expiresAt_idx" ON "PortalSnapshot"("expiresAt");
