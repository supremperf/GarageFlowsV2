-- Index de clés étrangères sur tables chaudes (perf) — additif, idempotent.
-- Ces tables sont interrogées/écrites par leur FK ; sans index = balayage complet.
CREATE INDEX IF NOT EXISTS "QuoteLine_quoteId_idx" ON "QuoteLine"("quoteId");
CREATE INDEX IF NOT EXISTS "InvoiceLine_invoiceId_idx" ON "InvoiceLine"("invoiceId");
CREATE INDEX IF NOT EXISTS "JobPhoto_jobId_idx" ON "JobPhoto"("jobId");
CREATE INDEX IF NOT EXISTS "JobPhoto_garageId_idx" ON "JobPhoto"("garageId");
CREATE INDEX IF NOT EXISTS "InspectionItem_inspectionId_idx" ON "InspectionItem"("inspectionId");
