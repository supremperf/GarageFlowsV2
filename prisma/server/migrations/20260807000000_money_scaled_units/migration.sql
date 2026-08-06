-- MIGRATION MONÉTAIRE — PHASE ADD + BACKFILL + VÉRIFICATION (PostgreSQL).
--
-- Objectif : représentation EXACTE des prix/coûts unitaires, taux et quantités
-- fractionnaires en ENTIERS de dix-millièmes (« TenThousandths », ×10 000) et des
-- totaux en CENTIMES. Conversion déterministe ROUND(ancien × échelle).
--
-- SÛRETÉ :
--  * additive (aucune suppression ici — voir la migration suivante _drop_floats) ;
--  * idempotente sur les ADD (IF NOT EXISTS) ;
--  * le backfill n'écrase jamais une valeur exacte déjà écrite par l'application
--    (les anciennes colonnes miroirs dérivaient des mêmes valeurs) ;
--  * VÉRIFICATION BLOQUANTE : si une seule ligne diverge de plus d'une demi-unité
--    d'échelle après conversion, la migration ÉCHOUE (RAISE EXCEPTION) — aucune
--    bascule sur des données corrompues.
-- Prérequis : SAUVEGARDE COMPLÈTE (pg_dump) — voir docs/MIGRATION-MONEY.md.

-- ── 1. AJOUT des colonnes exactes ───────────────────────────────────────────────
ALTER TABLE "Garage"            ADD COLUMN IF NOT EXISTS "hourlyRateTenThousandths" INTEGER NOT NULL DEFAULT 600000;
ALTER TABLE "Part"              ADD COLUMN IF NOT EXISTS "unitCostTenThousandths"   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Part"              ADD COLUMN IF NOT EXISTS "unitPriceTenThousandths"  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "JobPart"           ADD COLUMN IF NOT EXISTS "unitPriceTenThousandths"  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "JobPart"           ADD COLUMN IF NOT EXISTS "unitCostTenThousandths"   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "QuoteLine"         ADD COLUMN IF NOT EXISTS "quantityTenThousandths"   INTEGER NOT NULL DEFAULT 10000;
ALTER TABLE "QuoteLine"         ADD COLUMN IF NOT EXISTS "unitPriceTenThousandths"  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "QuoteLine"         ADD COLUMN IF NOT EXISTS "unitCostTenThousandths"   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "InvoiceLine"       ADD COLUMN IF NOT EXISTS "quantityTenThousandths"   INTEGER NOT NULL DEFAULT 10000;
ALTER TABLE "InvoiceLine"       ADD COLUMN IF NOT EXISTS "unitPriceTenThousandths"  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "InvoiceLine"       ADD COLUMN IF NOT EXISTS "unitCostTenThousandths"   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "LaborOperation"    ADD COLUMN IF NOT EXISTS "unitPriceTenThousandths"  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "LoanerReservation" ADD COLUMN IF NOT EXISTS "dailyRateTenThousandths"  INTEGER;
-- (totalHtCents / totalTtcCents / depositAmountCents : déjà ajoutés par 20260806100000_money_cents)

-- ── 2. BACKFILL déterministe (ROUND(ancien × échelle)) ─────────────────────────
UPDATE "Garage"         SET "hourlyRateTenThousandths" = ROUND(("hourlyRate"::numeric) * 10000)::int;
UPDATE "Part"           SET "unitCostTenThousandths"  = ROUND(("unitCost"::numeric)  * 10000)::int,
                            "unitPriceTenThousandths" = ROUND(("unitPrice"::numeric) * 10000)::int;
UPDATE "JobPart"        SET "unitPriceTenThousandths" = ROUND(("unitPrice"::numeric) * 10000)::int,
                            "unitCostTenThousandths"  = ROUND(("unitCost"::numeric)  * 10000)::int;
UPDATE "QuoteLine"      SET "quantityTenThousandths"  = ROUND(("quantity"::numeric)  * 10000)::int,
                            "unitPriceTenThousandths" = ROUND(("unitPrice"::numeric) * 10000)::int,
                            "unitCostTenThousandths"  = ROUND(("unitCost"::numeric)  * 10000)::int;
UPDATE "InvoiceLine"    SET "quantityTenThousandths"  = ROUND(("quantity"::numeric)  * 10000)::int,
                            "unitPriceTenThousandths" = ROUND(("unitPrice"::numeric) * 10000)::int,
                            "unitCostTenThousandths"  = ROUND(("unitCost"::numeric)  * 10000)::int;
UPDATE "LaborOperation" SET "unitPriceTenThousandths" = ROUND(("unitPrice"::numeric) * 10000)::int;
UPDATE "LoanerReservation" SET "dailyRateTenThousandths" = CASE WHEN "dailyRate" IS NULL THEN NULL ELSE ROUND(("dailyRate"::numeric) * 10000)::int END;
-- Totaux (filet : lignes créées avant le double-écriture des centimes)
UPDATE "WorkOrder"     SET "totalHtCents"  = COALESCE("totalHtCents",  ROUND(("totalHT"::numeric)  * 100)::int),
                           "totalTtcCents" = COALESCE("totalTtcCents", ROUND(("totalTTC"::numeric) * 100)::int);
UPDATE "PurchaseOrder" SET "totalHtCents"  = COALESCE("totalHtCents",  ROUND(("totalHT"::numeric)  * 100)::int);
UPDATE "LoanerReservation" SET "depositAmountCents" = COALESCE("depositAmountCents",
                           CASE WHEN "depositAmount" IS NULL THEN NULL ELSE ROUND(("depositAmount"::numeric) * 100)::int END);

-- ── 3. VÉRIFICATION BLOQUANTE (échec si divergence > 1/2 unité d'échelle) ──────
DO $gfmoney$
DECLARE bad integer;
BEGIN
  SELECT count(*) INTO bad FROM "Part"
   WHERE abs("unitCostTenThousandths"  - ("unitCost"::numeric)  * 10000) > 0.5
      OR abs("unitPriceTenThousandths" - ("unitPrice"::numeric) * 10000) > 0.5;
  IF bad > 0 THEN RAISE EXCEPTION 'money_scaled_units: % ligne(s) Part divergentes — migration bloquée', bad; END IF;

  SELECT count(*) INTO bad FROM "InvoiceLine"
   WHERE abs("quantityTenThousandths"  - ("quantity"::numeric)  * 10000) > 0.5
      OR abs("unitPriceTenThousandths" - ("unitPrice"::numeric) * 10000) > 0.5
      OR abs("unitCostTenThousandths"  - ("unitCost"::numeric)  * 10000) > 0.5;
  IF bad > 0 THEN RAISE EXCEPTION 'money_scaled_units: % ligne(s) InvoiceLine divergentes — migration bloquée', bad; END IF;

  SELECT count(*) INTO bad FROM "QuoteLine"
   WHERE abs("quantityTenThousandths"  - ("quantity"::numeric)  * 10000) > 0.5
      OR abs("unitPriceTenThousandths" - ("unitPrice"::numeric) * 10000) > 0.5
      OR abs("unitCostTenThousandths"  - ("unitCost"::numeric)  * 10000) > 0.5;
  IF bad > 0 THEN RAISE EXCEPTION 'money_scaled_units: % ligne(s) QuoteLine divergentes — migration bloquée', bad; END IF;

  SELECT count(*) INTO bad FROM "WorkOrder"
   WHERE "totalHtCents" IS NULL OR "totalTtcCents" IS NULL
      OR abs("totalHtCents"  - ("totalHT"::numeric)  * 100) > 0.5
      OR abs("totalTtcCents" - ("totalTTC"::numeric) * 100) > 0.5;
  IF bad > 0 THEN RAISE EXCEPTION 'money_scaled_units: % WorkOrder divergents/NULL — migration bloquée', bad; END IF;

  SELECT count(*) INTO bad FROM "PurchaseOrder"
   WHERE "totalHtCents" IS NULL OR abs("totalHtCents" - ("totalHT"::numeric) * 100) > 0.5;
  IF bad > 0 THEN RAISE EXCEPTION 'money_scaled_units: % PurchaseOrder divergents/NULL — migration bloquée', bad; END IF;
END
$gfmoney$;
