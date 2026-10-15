-- GF-PLAN-004 / GF-PLAN-005 — photo de profil et archivage du mécanicien.
--
-- STRICTEMENT ADDITIVE : cinq colonnes nullables et un index. Aucune donnée
-- existante n'est lue, réécrite ni supprimée, aucune colonne n'est retirée, et
-- rien n'est rendu obligatoire. Une version applicative antérieure continue donc
-- de fonctionner contre cette base : elle ignore simplement les colonnes.
--
-- ── Photo ────────────────────────────────────────────────────────────────────
-- `Mechanic.avatar` (existante, NOT NULL) reste les INITIALES de repli affichées
-- quand aucune photo n'existe ; elle n'est pas touchée. Les colonnes ci-dessous
-- portent la vraie photo :
--   avatarPath      clé de STOCKAGE générée par le serveur — jamais un nom de
--                   fichier fourni par le client (aucun chemin relatif possible) ;
--   avatarMime      type réel, déterminé par les octets magiques et non par
--                   l'en-tête annoncé par le navigateur ;
--   avatarHash      empreinte du contenu NETTOYÉ, utilisée comme jeton
--                   d'invalidation de cache dans l'URL servie ;
--   avatarUpdatedAt horodatage de la dernière modification, pour la
--                   synchronisation incrémentale poste ⇄ cloud.
--
-- ── Archivage ────────────────────────────────────────────────────────────────
-- `archivedAt` NULL = mécanicien ACTIF. Un mécanicien archivé sort du planning
-- et ne peut plus recevoir d'intervention, mais ses interventions, notes,
-- photos, temps et audits passés restent intacts et lisibles — ce qu'une
-- suppression aurait détruit ou orphelinés.

ALTER TABLE "Mechanic" ADD COLUMN "avatarPath" TEXT;
ALTER TABLE "Mechanic" ADD COLUMN "avatarMime" TEXT;
ALTER TABLE "Mechanic" ADD COLUMN "avatarHash" TEXT;
ALTER TABLE "Mechanic" ADD COLUMN "avatarUpdatedAt" TIMESTAMP(3);
ALTER TABLE "Mechanic" ADD COLUMN "archivedAt" TIMESTAMP(3);

-- Le planning ne lit que les mécaniciens ACTIFS d'un garage : c'est la requête
-- la plus fréquente du module.
CREATE INDEX IF NOT EXISTS "Mechanic_garageId_archivedAt_idx" ON "Mechanic"("garageId", "archivedAt");
