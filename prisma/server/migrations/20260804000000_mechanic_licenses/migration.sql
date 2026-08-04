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
    "licenseId" TEXT NOT NULL,
    "mechanicId" TEXT NOT NULL,
    "garageId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedBy" TEXT NOT NULL,
    "unassignedAt" TIMESTAMP(3),
    "previousMechanicId" TEXT,

    CONSTRAINT "MechanicLicenseAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobMechanicNote" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "garageId" TEXT NOT NULL,
    "mechanicId" TEXT NOT NULL,
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
