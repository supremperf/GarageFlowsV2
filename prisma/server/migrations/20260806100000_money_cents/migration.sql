-- Migration monétaire (ADDITIVE, non destructive) — colonnes en CENTIMES entiers.
--
-- Objectif : éliminer le Float comme SOURCE DE VÉRITÉ des totaux monétaires
-- persistés, sans casser l'existant. On AJOUTE des colonnes `*Cents` (entiers),
-- on les BACKFILL depuis les colonnes Float (arrondi au centime), et l'application
-- écrit désormais les centimes comme source de vérité (Float = miroir dérivé).
--
-- Les colonnes Float sont CONSERVÉES pendant la transition (compatibilité,
-- signatures, sauvegardes). Leur retrait éventuel est une étape SÉPARÉE, exécutée
-- par l'opérateur APRÈS vérification sur données réelles (voir docs/MIGRATION-MONEY.md).
-- Aucune donnée n'est supprimée ici. `IF NOT EXISTS` → rejouable sans effet de bord.

-- 1) Ajout des colonnes (nullable, additif)
ALTER TABLE "WorkOrder"         ADD COLUMN IF NOT EXISTS "totalHtCents"       INTEGER;
ALTER TABLE "WorkOrder"         ADD COLUMN IF NOT EXISTS "totalTtcCents"      INTEGER;
ALTER TABLE "PurchaseOrder"     ADD COLUMN IF NOT EXISTS "totalHtCents"       INTEGER;
ALTER TABLE "LoanerReservation" ADD COLUMN IF NOT EXISTS "depositAmountCents" INTEGER;

-- 2) Backfill depuis les colonnes Float (arrondi bancaire au centime le plus
--    proche). On ne touche QUE les lignes non encore converties (idempotent).
UPDATE "WorkOrder"
   SET "totalHtCents"  = ROUND(("totalHT"::numeric)  * 100)::int,
       "totalTtcCents" = ROUND(("totalTTC"::numeric) * 100)::int
 WHERE "totalHtCents" IS NULL OR "totalTtcCents" IS NULL;

UPDATE "PurchaseOrder"
   SET "totalHtCents" = ROUND(("totalHT"::numeric) * 100)::int
 WHERE "totalHtCents" IS NULL;

UPDATE "LoanerReservation"
   SET "depositAmountCents" = ROUND(("depositAmount"::numeric) * 100)::int
 WHERE "depositAmount" IS NOT NULL AND "depositAmountCents" IS NULL;

-- 3) VÉRIFICATION (à exécuter manuellement après migration — voir MIGRATION-MONEY.md) :
--    Toute ligne dont l'écart |cents - round(float*100)| > 0 signale une anomalie.
--    SELECT count(*) FROM "WorkOrder"
--     WHERE "totalHtCents"  <> ROUND(("totalHT"::numeric)*100)::int
--        OR "totalTtcCents" <> ROUND(("totalTTC"::numeric)*100)::int;
--    (Attendu : 0.)
