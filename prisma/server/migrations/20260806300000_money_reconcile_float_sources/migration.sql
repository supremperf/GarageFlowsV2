-- RÉCONCILIATION DES SOURCES MONÉTAIRES — PRÉALABLE OBLIGATOIRE À
-- 20260807000000_money_scaled_units.
--
-- ── Le défaut corrigé ────────────────────────────────────────────────────────
-- `money_scaled_units` recalcule les colonnes monétaires ENTIÈRES depuis les
-- anciennes colonnes Float, SANS CONDITION :
--     UPDATE "X" SET "yTenThousandths" = ROUND(("y"::numeric) * 10000)::int;
-- Il postule donc que le Float est la source de vérité de CHAQUE ligne.
--
-- Ce postulat est faux depuis que le schéma serveur a cessé de déclarer ces
-- colonnes Float : Prisma Client ne peut plus les écrire. Toute ligne créée
-- depuis porte le montant UNIQUEMENT dans la colonne entière, l'ancienne colonne
-- conservant NULL ou son DÉFAUT (0 pour les montants, 1 pour les quantités).
-- Sur ces lignes, le recalcul remplace un montant réel par une valeur dérivée du
-- vide — et le contrôle intégré à `money_scaled_units` ne le voit pas, puisque
-- le résultat est alors cohérent avec sa source. La perte serait silencieuse.
--
-- Constaté sur la base de production le 15/08/2026 : 37 lignes concernées
-- (LaborOperation.unitPrice ×32, InvoiceLine.unitPrice ×2, InvoiceLine.quantity
-- ×1, LoanerReservation.dailyRate ×1, LoanerReservation.depositAmount ×1).
--
-- ── Ce que fait cette migration ─────────────────────────────────────────────
-- Elle écrit UNIQUEMENT dans les anciennes colonnes Float, et seulement là où
-- celles-ci ne portent aucune information (NULL, ou défaut de colonne) alors que
-- la colonne entière porte une valeur. AUCUNE colonne entière n'est modifiée :
-- aucun montant ne change, on rend seulement les deux représentations
-- concordantes.
--
-- Conséquences voulues :
--   • le recalcul de `money_scaled_units` reproduit à l'identique les entiers
--     existants (aucune perte) tout en comblant normalement les lignes
--     anciennes où seul le Float était renseigné ;
--   • la vérification par colonne de `money_drop_floats` passe, les deux
--     représentations concordant, et les Float sont supprimés comme prévu.
--
-- Les colonnes remplies ici sont donc TRANSITOIRES : `money_drop_floats` les
-- supprime deux migrations plus loin.
--
-- ── Sûreté ──────────────────────────────────────────────────────────────────
-- Idempotente (les prédicats ne matchent plus après exécution). Sans effet sur
-- une base neuve, où les colonnes entières n'existent pas encore à ce stade :
-- chaque couple est ignoré si l'une des deux colonnes est absente. PostgreSQL
-- exécute ce fichier dans UNE transaction — le moindre échec annule tout.

-- ── 1. Réconciliation ────────────────────────────────────────────────────────
-- (table, ancienne colonne Float, colonne entière, échelle, marque du « vide »)
-- Marque du vide : 'null' → Float NULL ; 'zero' → Float = 0 (montants) ;
--                  'un'   → Float = 1 (quantités, dont le défaut est 1).
DO $gfreconcile$
DECLARE
  spec record;
  has_old boolean;
  has_new boolean;
  cond text;
  touchees integer;
  total integer := 0;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('Garage'::text,        'hourlyRate'::text,    'hourlyRateTenThousandths'::text, 10000::numeric, 'zero'::text),
      ('Part',                'unitCost',            'unitCostTenThousandths',         10000, 'zero'),
      ('Part',                'unitPrice',           'unitPriceTenThousandths',        10000, 'zero'),
      ('JobPart',             'unitPrice',           'unitPriceTenThousandths',        10000, 'zero'),
      ('JobPart',             'unitCost',            'unitCostTenThousandths',         10000, 'zero'),
      ('QuoteLine',           'quantity',            'quantityTenThousandths',         10000, 'un'),
      ('QuoteLine',           'unitPrice',           'unitPriceTenThousandths',        10000, 'zero'),
      ('QuoteLine',           'unitCost',            'unitCostTenThousandths',         10000, 'zero'),
      ('InvoiceLine',         'quantity',            'quantityTenThousandths',         10000, 'un'),
      ('InvoiceLine',         'unitPrice',           'unitPriceTenThousandths',        10000, 'zero'),
      ('InvoiceLine',         'unitCost',            'unitCostTenThousandths',         10000, 'zero'),
      ('LaborOperation',      'unitPrice',           'unitPriceTenThousandths',        10000, 'zero'),
      ('LoanerReservation',   'dailyRate',           'dailyRateTenThousandths',        10000, 'null'),
      ('LoanerReservation',   'depositAmount',       'depositAmountCents',               100, 'null'),
      ('WorkOrder',           'totalHT',             'totalHtCents',                     100, 'zero'),
      ('WorkOrder',           'totalTTC',            'totalTtcCents',                    100, 'zero'),
      ('PurchaseOrder',       'totalHT',             'totalHtCents',                     100, 'zero')
    ) AS t(tbl, old_col, new_col, scale, vide)
  LOOP
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = spec.tbl AND column_name = spec.old_col) INTO has_old;
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = spec.tbl AND column_name = spec.new_col) INTO has_new;
    -- Base neuve : la colonne entière n'existe pas encore (créée par
    -- money_scaled_units) — rien à réconcilier. Base déjà purgée de ses Float :
    -- rien non plus.
    IF NOT has_old OR NOT has_new THEN
      CONTINUE;
    END IF;

    cond := CASE spec.vide
      WHEN 'null' THEN format('%I IS NULL AND %I IS NOT NULL', spec.old_col, spec.new_col)
      WHEN 'un'   THEN format('%I = 1 AND %I <> 10000',        spec.old_col, spec.new_col)
      ELSE             format('%I = 0 AND %I <> 0',            spec.old_col, spec.new_col)
    END;

    EXECUTE format('UPDATE %I SET %I = (%I::numeric) / %s WHERE %s',
                   spec.tbl, spec.old_col, spec.new_col, spec.scale, cond);
    GET DIAGNOSTICS touchees = ROW_COUNT;
    total := total + touchees;
    IF touchees > 0 THEN
      RAISE NOTICE 'money_reconcile: % ligne(s) réconciliée(s) sur "%"."%" depuis "%"',
        touchees, spec.tbl, spec.old_col, spec.new_col;
    END IF;
  END LOOP;
  RAISE NOTICE 'money_reconcile: % ligne(s) au total', total;
END
$gfreconcile$;

-- ── 2. CONTRÔLE BLOQUANT ─────────────────────────────────────────────────────
-- Plus aucune ligne ne doit présenter « Float vide / entier renseigné ». Si
-- l'une subsiste, `money_scaled_units` détruirait un montant : on refuse
-- d'avancer et la transaction est annulée (base inchangée).
DO $gfreconcile_check$
DECLARE
  spec record;
  has_old boolean;
  has_new boolean;
  cond text;
  restant integer;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('Garage'::text,        'hourlyRate'::text,    'hourlyRateTenThousandths'::text, 'zero'::text),
      ('Part',                'unitCost',            'unitCostTenThousandths',         'zero'),
      ('Part',                'unitPrice',           'unitPriceTenThousandths',        'zero'),
      ('JobPart',             'unitPrice',           'unitPriceTenThousandths',        'zero'),
      ('JobPart',             'unitCost',            'unitCostTenThousandths',         'zero'),
      ('QuoteLine',           'quantity',            'quantityTenThousandths',         'un'),
      ('QuoteLine',           'unitPrice',           'unitPriceTenThousandths',        'zero'),
      ('QuoteLine',           'unitCost',            'unitCostTenThousandths',         'zero'),
      ('InvoiceLine',         'quantity',            'quantityTenThousandths',         'un'),
      ('InvoiceLine',         'unitPrice',           'unitPriceTenThousandths',        'zero'),
      ('InvoiceLine',         'unitCost',            'unitCostTenThousandths',         'zero'),
      ('LaborOperation',      'unitPrice',           'unitPriceTenThousandths',        'zero'),
      ('LoanerReservation',   'dailyRate',           'dailyRateTenThousandths',        'null'),
      ('LoanerReservation',   'depositAmount',       'depositAmountCents',             'null'),
      ('WorkOrder',           'totalHT',             'totalHtCents',                   'zero'),
      ('WorkOrder',           'totalTTC',            'totalTtcCents',                  'zero'),
      ('PurchaseOrder',       'totalHT',             'totalHtCents',                   'zero')
    ) AS t(tbl, old_col, new_col, vide)
  LOOP
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = spec.tbl AND column_name = spec.old_col) INTO has_old;
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = spec.tbl AND column_name = spec.new_col) INTO has_new;
    IF NOT has_old OR NOT has_new THEN
      CONTINUE;
    END IF;

    cond := CASE spec.vide
      WHEN 'null' THEN format('%I IS NULL AND %I IS NOT NULL', spec.old_col, spec.new_col)
      WHEN 'un'   THEN format('%I = 1 AND %I <> 10000',        spec.old_col, spec.new_col)
      ELSE             format('%I = 0 AND %I <> 0',            spec.old_col, spec.new_col)
    END;

    EXECUTE format('SELECT count(*) FROM %I WHERE %s', spec.tbl, cond) INTO restant;
    IF restant > 0 THEN
      RAISE EXCEPTION 'money_reconcile: % ligne(s) « Float vide / entier renseigné » subsistent sur "%"."%" — money_scaled_units détruirait ces montants (transaction annulée, base inchangée)',
        restant, spec.tbl, spec.old_col;
    END IF;
  END LOOP;
END
$gfreconcile_check$;
