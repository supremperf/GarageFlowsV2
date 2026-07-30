-- AlterTable
ALTER TABLE "LicenseKey" ADD COLUMN     "garageId" TEXT;

-- CreateIndex
CREATE INDEX "LicenseKey_garageId_idx" ON "LicenseKey"("garageId");

-- AddForeignKey
ALTER TABLE "LicenseKey" ADD CONSTRAINT "LicenseKey_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

