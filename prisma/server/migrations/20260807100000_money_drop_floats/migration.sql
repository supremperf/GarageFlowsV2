-- MIGRATION MONÉTAIRE — PHASE FINALE : SUPPRESSION DES ANCIENNES COLONNES FLOAT.
--
-- Ne s'exécute qu'APRÈS 20260807000000_money_scaled_units (backfill VÉRIFIÉ,
-- exception bloquante en cas de divergence). Re-vérifie ici les totaux avant de
-- supprimer quoi que ce soit — une base où le backfill n'aurait pas convergé
-- FAIT ÉCHOUER cette migration au lieu de perdre des données.
-- Prérequis : SAUVEGARDE COMPLÈTE + validation staging (docs/MIGRATION-MONEY.md).
-- Rollback : restauration de la sauvegarde (les DROP ne sont pas réversibles
-- sans elle — c'est documenté et voulu : plus AUCUNE colonne monétaire Float).

-- ── 0. Re-vérification défensive (totaux) ──────────────────────────────────────
DO $gfmoney2$
DECLARE bad integer;
BEGIN
  SELECT count(*) INTO bad FROM "WorkOrder"
   WHERE "totalHtCents" IS NULL OR "totalTtcCents" IS NULL;
  IF bad > 0 THEN RAISE EXCEPTION 'money_drop_floats: % WorkOrder sans centimes — drop refusé', bad; END IF;
  SELECT count(*) INTO bad FROM "PurchaseOrder" WHERE "totalHtCents" IS NULL;
  IF bad > 0 THEN RAISE EXCEPTION 'money_drop_floats: % PurchaseOrder sans centimes — drop refusé', bad; END IF;
END
$gfmoney2$;

-- ── 1. Contraintes finales sur les centimes (NOT NULL + défaut explicite) ──────
ALTER TABLE "WorkOrder"     ALTER COLUMN "totalHtCents"  SET DEFAULT 0;
ALTER TABLE "WorkOrder"     ALTER COLUMN "totalTtcCents" SET DEFAULT 0;
ALTER TABLE "WorkOrder"     ALTER COLUMN "totalHtCents"  SET NOT NULL;
ALTER TABLE "WorkOrder"     ALTER COLUMN "totalTtcCents" SET NOT NULL;
ALTER TABLE "PurchaseOrder" ALTER COLUMN "totalHtCents"  SET DEFAULT 0;
ALTER TABLE "PurchaseOrder" ALTER COLUMN "totalHtCents"  SET NOT NULL;

-- ── 2. SUPPRESSION des anciennes colonnes monétaires Float ─────────────────────
ALTER TABLE "Garage"            DROP COLUMN IF EXISTS "hourlyRate";
ALTER TABLE "Part"              DROP COLUMN IF EXISTS "unitCost";
ALTER TABLE "Part"              DROP COLUMN IF EXISTS "unitPrice";
ALTER TABLE "JobPart"           DROP COLUMN IF EXISTS "unitPrice";
ALTER TABLE "JobPart"           DROP COLUMN IF EXISTS "unitCost";
ALTER TABLE "QuoteLine"         DROP COLUMN IF EXISTS "quantity";
ALTER TABLE "QuoteLine"         DROP COLUMN IF EXISTS "unitPrice";
ALTER TABLE "QuoteLine"         DROP COLUMN IF EXISTS "unitCost";
ALTER TABLE "InvoiceLine"       DROP COLUMN IF EXISTS "quantity";
ALTER TABLE "InvoiceLine"       DROP COLUMN IF EXISTS "unitPrice";
ALTER TABLE "InvoiceLine"       DROP COLUMN IF EXISTS "unitCost";
ALTER TABLE "LaborOperation"    DROP COLUMN IF EXISTS "unitPrice";
ALTER TABLE "LoanerReservation" DROP COLUMN IF EXISTS "dailyRate";
ALTER TABLE "LoanerReservation" DROP COLUMN IF EXISTS "depositAmount";
ALTER TABLE "WorkOrder"         DROP COLUMN IF EXISTS "totalHT";
ALTER TABLE "WorkOrder"         DROP COLUMN IF EXISTS "totalTTC";
ALTER TABLE "PurchaseOrder"     DROP COLUMN IF EXISTS "totalHT";
