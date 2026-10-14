-- The scaled-money backfill introduced DEFAULT 0 on all new money columns.
-- JobPart snapshots must instead be supplied explicitly, as declared by Prisma.
-- Remove only the insertion defaults: no row/column/type/nullability changes,
-- and no edits to already-applied historical migrations/checksums.
ALTER TABLE "JobPart"
    ALTER COLUMN "unitPriceTenThousandths" DROP DEFAULT,
    ALTER COLUMN "unitCostTenThousandths" DROP DEFAULT;
