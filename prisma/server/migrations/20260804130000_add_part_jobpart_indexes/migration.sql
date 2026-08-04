-- Index sur les colonnes chaudes / clés étrangères non indexées.
-- Part.garageId : lu par garageId dans de nombreux endpoints (finance, parts,
-- quotes/generate → part.findMany({ where: { garageId }, take: 5000 })).
-- JobPart.jobId / partId : clés étrangères non indexées (jointures + cascade).
-- Additif et non destructif.

-- CreateIndex
CREATE INDEX "JobPart_jobId_idx" ON "JobPart"("jobId");

-- CreateIndex
CREATE INDEX "JobPart_partId_idx" ON "JobPart"("partId");

-- CreateIndex
CREATE INDEX "Part_garageId_idx" ON "Part"("garageId");
