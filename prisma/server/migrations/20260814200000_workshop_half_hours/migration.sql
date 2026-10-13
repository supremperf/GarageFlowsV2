-- Horaires d'atelier à la DEMI-HEURE (GF-021).
--
-- `workshopStartHour` / `workshopEndHour` sont des entiers : un atelier qui
-- ouvre à 8 h 30 ou ferme à 18 h 30 ne pouvait pas le déclarer. Deux colonnes de
-- MINUTES s'ajoutent, valant 0 par défaut — les garages existants conservent
-- donc exactement leurs horaires, à la minute près.
--
-- STRICTEMENT ADDITIF : aucune colonne existante n'est touchée, aucune donnée
-- réécrite. `NOT NULL DEFAULT 0` est sûr sur une table peuplée.
ALTER TABLE "Garage" ADD COLUMN IF NOT EXISTS "workshopStartMinute" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Garage" ADD COLUMN IF NOT EXISTS "workshopEndMinute"   INTEGER NOT NULL DEFAULT 0;
