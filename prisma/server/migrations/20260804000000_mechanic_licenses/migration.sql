-- Licences MECHANIC subordonnées aux licences Garage — migration ADDITIVE.
-- Aucune colonne supprimée, aucune donnée modifiée : rollback = DROP des
-- colonnes/tables ajoutées (documenté dans docs/, sans perte pour l'existant).

-- AlterTable
ALTER TABLE "LicenseKey" ADD COLUMN     "parentLicenseId" TEXT;
ALTER TABLE "LicenseKey" ADD COLUMN     "mechanicId" TEXT;
ALTER TABLE "LicenseKey" ADD COLUMN     "mechanicHint" TEXT;
ALTER TABLE "LicenseKey" ADD COLUMN     "assignedAt" TIMESTAMP(3);
ALTER TABLE "LicenseKey" ADD COLUMN     "assignedBy" TEXT;
ALTER TABLE "LicenseKey" ADD COLUMN     "suspendedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "JobPhoto" ADD COLUMN     "mechanicId" TEXT;

-- CreateTable
CREATE TABLE "MechanicLicenseAssignment" (
    "id" TEXT NOT NULL,
    "licenseId" TEXT,
    "mechanicId" TEXT,
    "garageId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedBy" TEXT,
    "unassignedAt" TIMESTAMP(3),
    "previousMechanicId" TEXT,

    CONSTRAINT "MechanicLicenseAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobMechanicNote" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "garageId" TEXT NOT NULL,
    "mechanicId" TEXT,
    "licenseId" TEXT,
    "type" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobMechanicNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MechanicActionAudit" (
    "id" TEXT NOT NULL,
    "garageId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorRole" TEXT,
    "targetMechanicId" TEXT,
    "licenseId" TEXT,
    "jobId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MechanicActionAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LicenseKey_parentLicenseId_idx" ON "LicenseKey"("parentLicenseId");

-- CreateIndex
CREATE INDEX "LicenseKey_garageId_licenseType_idx" ON "LicenseKey"("garageId", "licenseType");

-- CreateIndex
CREATE INDEX "MechanicLicenseAssignment_licenseId_assignedAt_idx" ON "MechanicLicenseAssignment"("licenseId", "assignedAt");

-- CreateIndex
CREATE INDEX "MechanicLicenseAssignment_garageId_idx" ON "MechanicLicenseAssignment"("garageId");

-- CreateIndex
CREATE INDEX "JobMechanicNote_jobId_createdAt_idx" ON "JobMechanicNote"("jobId", "createdAt");

-- CreateIndex
CREATE INDEX "JobMechanicNote_garageId_mechanicId_idx" ON "JobMechanicNote"("garageId", "mechanicId");

-- CreateIndex
CREATE INDEX "MechanicActionAudit_garageId_createdAt_idx" ON "MechanicActionAudit"("garageId", "createdAt");

-- CreateIndex
CREATE INDEX "MechanicActionAudit_targetMechanicId_createdAt_idx" ON "MechanicActionAudit"("targetMechanicId", "createdAt");

-- CreateIndex
CREATE INDEX "MechanicActionAudit_actorUserId_createdAt_idx" ON "MechanicActionAudit"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "MechanicActionAudit_jobId_idx" ON "MechanicActionAudit"("jobId");

-- CreateIndex (FK-child indexes — colonnes de jointure/cascade non déjà en tête d'un index composite)
CREATE INDEX "LicenseKey_mechanicId_idx" ON "LicenseKey"("mechanicId");

-- CreateIndex
CREATE INDEX "LicenseKey_assignedBy_idx" ON "LicenseKey"("assignedBy");

-- CreateIndex
CREATE INDEX "MechanicLicenseAssignment_mechanicId_idx" ON "MechanicLicenseAssignment"("mechanicId");

-- CreateIndex
CREATE INDEX "MechanicLicenseAssignment_assignedBy_idx" ON "MechanicLicenseAssignment"("assignedBy");

-- CreateIndex
CREATE INDEX "MechanicLicenseAssignment_previousMechanicId_idx" ON "MechanicLicenseAssignment"("previousMechanicId");

-- CreateIndex
CREATE INDEX "JobMechanicNote_licenseId_idx" ON "JobMechanicNote"("licenseId");

-- CreateIndex
CREATE INDEX "MechanicActionAudit_licenseId_idx" ON "MechanicActionAudit"("licenseId");

-- AddForeignKey (LicenseKey — hiérarchie mechanic + attribution ; tout SET NULL car colonnes optionnelles)
ALTER TABLE "LicenseKey" ADD CONSTRAINT "LicenseKey_parentLicenseId_fkey" FOREIGN KEY ("parentLicenseId") REFERENCES "LicenseKey"("licenseId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LicenseKey" ADD CONSTRAINT "LicenseKey_mechanicId_fkey" FOREIGN KEY ("mechanicId") REFERENCES "Mechanic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LicenseKey" ADD CONSTRAINT "LicenseKey_assignedBy_fkey" FOREIGN KEY ("assignedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey (MechanicLicenseAssignment — garageId CASCADE ; le reste SET NULL)
ALTER TABLE "MechanicLicenseAssignment" ADD CONSTRAINT "MechanicLicenseAssignment_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MechanicLicenseAssignment" ADD CONSTRAINT "MechanicLicenseAssignment_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "LicenseKey"("licenseId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MechanicLicenseAssignment" ADD CONSTRAINT "MechanicLicenseAssignment_mechanicId_fkey" FOREIGN KEY ("mechanicId") REFERENCES "Mechanic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MechanicLicenseAssignment" ADD CONSTRAINT "MechanicLicenseAssignment_assignedBy_fkey" FOREIGN KEY ("assignedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MechanicLicenseAssignment" ADD CONSTRAINT "MechanicLicenseAssignment_previousMechanicId_fkey" FOREIGN KEY ("previousMechanicId") REFERENCES "Mechanic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey (JobMechanicNote — jobId + garageId CASCADE ; mechanicId/licenseId SET NULL)
ALTER TABLE "JobMechanicNote" ADD CONSTRAINT "JobMechanicNote_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobMechanicNote" ADD CONSTRAINT "JobMechanicNote_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobMechanicNote" ADD CONSTRAINT "JobMechanicNote_mechanicId_fkey" FOREIGN KEY ("mechanicId") REFERENCES "Mechanic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobMechanicNote" ADD CONSTRAINT "JobMechanicNote_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "LicenseKey"("licenseId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey (MechanicActionAudit — garageId CASCADE ; acteur/cible/licence/job SET NULL)
ALTER TABLE "MechanicActionAudit" ADD CONSTRAINT "MechanicActionAudit_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MechanicActionAudit" ADD CONSTRAINT "MechanicActionAudit_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MechanicActionAudit" ADD CONSTRAINT "MechanicActionAudit_targetMechanicId_fkey" FOREIGN KEY ("targetMechanicId") REFERENCES "Mechanic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MechanicActionAudit" ADD CONSTRAINT "MechanicActionAudit_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "LicenseKey"("licenseId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MechanicActionAudit" ADD CONSTRAINT "MechanicActionAudit_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
