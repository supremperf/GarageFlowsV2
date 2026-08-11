-- Synchronisation STOCK ↔ DEVIS ↔ FACTURE.
--
-- 1) InvoiceLine."partId" / QuoteLine."partId" : lien INTERNE vers la pièce du
--    stock choisie via l'autocomplétion. NULL = main-d'œuvre, prestation, pièce
--    commandée spécialement ou ligne libre — aucun impact inventaire. Sans ce
--    lien, une ligne ne portait qu'un libellé et toute synchronisation
--    ultérieure du stock aurait dû être devinée à partir de texte libre.
-- 2) Invoice."stockCommittedAt" : horodatage de l'UNIQUE décrément définitif.
--    Sert de verrou d'idempotence (revendication par UPDATE conditionnel) —
--    un double-clic sur « Valider » ne peut pas décrémenter deux fois.
-- 3) "StockMovement" : journal d'inventaire. Chaque changement automatique de
--    stock déclenché par un document y laisse une trace signée
--    (SALE = sortie, CANCEL = retour, ADJUST = delta de modification).
--
-- ADDITIF et IDEMPOTENT : aucune donnée existante n'est lue, modifiée ou
-- supprimée. Les factures antérieures gardent `stockCommittedAt` à NULL et
-- leurs lignes `partId` à NULL : elles n'engagent donc aucun stock, ce qui est
-- le comportement historique — aucune régularisation rétroactive.
--
-- Rollback :
--   DROP TABLE IF EXISTS "StockMovement";
--   ALTER TABLE "Invoice"     DROP COLUMN IF EXISTS "stockCommittedAt";
--   ALTER TABLE "InvoiceLine" DROP COLUMN IF EXISTS "partId";
--   ALTER TABLE "QuoteLine"   DROP COLUMN IF EXISTS "partId";

ALTER TABLE "InvoiceLine" ADD COLUMN IF NOT EXISTS "partId" TEXT;
ALTER TABLE "QuoteLine"   ADD COLUMN IF NOT EXISTS "partId" TEXT;
ALTER TABLE "Invoice"     ADD COLUMN IF NOT EXISTS "stockCommittedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "StockMovement" (
    "id"            TEXT NOT NULL,
    "garageId"      TEXT NOT NULL,
    "partId"        TEXT NOT NULL,
    "type"          TEXT NOT NULL,
    "quantityDelta" INTEGER NOT NULL,
    "invoiceId"     TEXT,
    "invoiceLineId" TEXT,
    "reason"        TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "StockMovement_garageId_createdAt_idx" ON "StockMovement"("garageId", "createdAt");
CREATE INDEX IF NOT EXISTS "StockMovement_partId_idx"             ON "StockMovement"("partId");
CREATE INDEX IF NOT EXISTS "StockMovement_invoiceId_idx"          ON "StockMovement"("invoiceId");
CREATE INDEX IF NOT EXISTS "InvoiceLine_partId_idx"               ON "InvoiceLine"("partId");
CREATE INDEX IF NOT EXISTS "QuoteLine_partId_idx"                 ON "QuoteLine"("partId");
-- Recherche « tape F → propose Filtre… » : index sur le couple garage+nom.
CREATE INDEX IF NOT EXISTS "Part_garageId_name_idx"               ON "Part"("garageId", "name");

-- Clés étrangères. Colonnes/tables neuves (NULL ou vides) : aucun risque de
-- violation. `ADD CONSTRAINT` n'a pas d'IF NOT EXISTS → garde par conname.
DO $garageflow$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InvoiceLine_partId_fkey') THEN
    ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'QuoteLine_partId_fkey') THEN
    ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StockMovement_garageId_fkey') THEN
    ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StockMovement_partId_fkey') THEN
    ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'StockMovement_invoiceId_fkey') THEN
    ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$garageflow$;
