-- MIGRATION MONÉTAIRE — PHASE FINALE : SUPPRESSION DES ANCIENNES COLONNES FLOAT.
--
-- Ne s'exécute qu'APRÈS 20260807000000_money_scaled_units (backfill VÉRIFIÉ,
-- exception bloquante en cas de divergence). CHAQUE colonne supprimée est
-- RE-VÉRIFIÉE ici, individuellement, pendant que l'ancienne colonne existe
-- encore : présence de la colonne exacte cible, divergence ≤ 1/2 unité
-- d'échelle, cohérence des NULL (deux sens) pour les colonnes optionnelles.
-- La moindre anomalie lève une EXCEPTION : PostgreSQL exécute ce fichier dans
-- UNE transaction — l'échec annule TOUT (aucun DROP après échec, base intacte).
-- Prérequis : SAUVEGARDE COMPLÈTE + validation staging (docs/MIGRATION-MONEY.md).
-- Rollback : restauration de la sauvegarde (les DROP ne sont pas réversibles
-- sans elle — c'est documenté et voulu : plus AUCUNE colonne monétaire Float).

-- ── 0. RE-VÉRIFICATION PAR COLONNE (bloquante) ─────────────────────────────────
-- Une ligne du tableau VALUES = une colonne supprimée plus bas = une preuve.
-- (table, ancienne colonne Float, colonne exacte cible, échelle, optionnelle)
DO $gfdrop$
DECLARE
  spec record;
  has_old boolean;
  has_new boolean;
  bad integer;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('Garage'::text,        'hourlyRate'::text,    'hourlyRateTenThousandths'::text, 10000::numeric, false),
      ('Part',                'unitCost',            'unitCostTenThousandths',         10000, false),
      ('Part',                'unitPrice',           'unitPriceTenThousandths',        10000, false),
      ('JobPart',             'unitPrice',           'unitPriceTenThousandths',        10000, false),
      ('JobPart',             'unitCost',            'unitCostTenThousandths',         10000, false),
      ('QuoteLine',           'quantity',            'quantityTenThousandths',         10000, false),
      ('QuoteLine',           'unitPrice',           'unitPriceTenThousandths',        10000, false),
      ('QuoteLine',           'unitCost',            'unitCostTenThousandths',         10000, false),
      ('InvoiceLine',         'quantity',            'quantityTenThousandths',         10000, false),
      ('InvoiceLine',         'unitPrice',           'unitPriceTenThousandths',        10000, false),
      ('InvoiceLine',         'unitCost',            'unitCostTenThousandths',         10000, false),
      ('LaborOperation',      'unitPrice',           'unitPriceTenThousandths',        10000, false),
      ('LoanerReservation',   'dailyRate',           'dailyRateTenThousandths',        10000, true),
      ('LoanerReservation',   'depositAmount',       'depositAmountCents',               100, true),
      ('WorkOrder',           'totalHT',             'totalHtCents',                     100, false),
      ('WorkOrder',           'totalTTC',            'totalTtcCents',                    100, false),
      ('PurchaseOrder',       'totalHT',             'totalHtCents',                     100, false)
    ) AS t(tbl, old_col, new_col, scale, is_nullable)
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = spec.tbl AND column_name = spec.old_col
    ) INTO has_old;
    IF NOT has_old THEN
      -- Ancienne colonne déjà absente (base neuve ou drop déjà appliqué et
      -- vérifié) : rien à prouver ni à supprimer pour cette colonne.
      CONTINUE;
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = spec.tbl AND column_name = spec.new_col
    ) INTO has_new;
    IF NOT has_new THEN
      RAISE EXCEPTION 'money_drop_floats: "%"."%" existe mais la colonne exacte "%" est ABSENTE — DROP REFUSÉ (transaction annulée)',
        spec.tbl, spec.old_col, spec.new_col;
    END IF;

    IF spec.is_nullable THEN
      -- Cohérence des NULL dans les DEUX sens + divergence quand renseigné.
      EXECUTE format(
        'SELECT count(*) FROM %I WHERE (%I IS NOT NULL AND (%I IS NULL OR abs(%I - (%I::numeric) * %s) > 0.5)) OR (%I IS NULL AND %I IS NOT NULL)',
        spec.tbl, spec.old_col, spec.new_col, spec.new_col, spec.old_col, spec.scale, spec.old_col, spec.new_col
      ) INTO bad;
    ELSE
      EXECUTE format(
        'SELECT count(*) FROM %I WHERE %I IS NULL OR abs(%I - (%I::numeric) * %s) > 0.5',
        spec.tbl, spec.new_col, spec.new_col, spec.old_col, spec.scale
      ) INTO bad;
    END IF;
    IF bad > 0 THEN
      RAISE EXCEPTION 'money_drop_floats: % ligne(s) divergentes sur "%"."%" (cible "%") — DROP REFUSÉ (transaction annulée, base inchangée)',
        bad, spec.tbl, spec.old_col, spec.new_col;
    END IF;
  END LOOP;
END
$gfdrop$;

-- ── 1. Contraintes finales sur les centimes (NOT NULL + défaut explicite) ──────
-- Sûres : la vérification ci-dessus a prouvé l'absence de NULL sur ces colonnes
-- pour toute base contenant encore les anciennes colonnes ; sur base neuve les
-- colonnes sont créées NOT NULL par le schéma.
ALTER TABLE "WorkOrder"     ALTER COLUMN "totalHtCents"  SET DEFAULT 0;
ALTER TABLE "WorkOrder"     ALTER COLUMN "totalTtcCents" SET DEFAULT 0;
ALTER TABLE "WorkOrder"     ALTER COLUMN "totalHtCents"  SET NOT NULL;
ALTER TABLE "WorkOrder"     ALTER COLUMN "totalTtcCents" SET NOT NULL;
ALTER TABLE "PurchaseOrder" ALTER COLUMN "totalHtCents"  SET DEFAULT 0;
ALTER TABLE "PurchaseOrder" ALTER COLUMN "totalHtCents"  SET NOT NULL;

-- ── 2. SUPPRESSION des anciennes colonnes monétaires Float ─────────────────────
-- Chaque DROP ci-dessous correspond à UNE ligne vérifiée dans le bloc 0.
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
