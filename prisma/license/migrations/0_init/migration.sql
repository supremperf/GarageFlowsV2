-- CreateTable
CREATE TABLE "LicenseKey" (
    "id" TEXT NOT NULL,
    "licenseId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "licenseType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "expiryAt" TIMESTAMP(3) NOT NULL,
    "seats" INTEGER NOT NULL DEFAULT 1,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "hwid" TEXT,
    "label" TEXT,
    "notes" TEXT,
    "activatedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LicenseKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LicenseEvent" (
    "id" TEXT NOT NULL,
    "licenseId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "ip" TEXT,
    "hwid" TEXT,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LicenseEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LicenseKey_licenseId_key" ON "LicenseKey"("licenseId");

-- CreateIndex
CREATE UNIQUE INDEX "LicenseKey_token_key" ON "LicenseKey"("token");

-- CreateIndex
CREATE INDEX "LicenseKey_status_idx" ON "LicenseKey"("status");

-- CreateIndex
CREATE INDEX "LicenseKey_customerId_idx" ON "LicenseKey"("customerId");

-- CreateIndex
CREATE INDEX "LicenseKey_expiryAt_idx" ON "LicenseKey"("expiryAt");

-- CreateIndex
CREATE INDEX "LicenseKey_hwid_idx" ON "LicenseKey"("hwid");

-- CreateIndex
CREATE INDEX "LicenseKey_status_expiryAt_idx" ON "LicenseKey"("status", "expiryAt");

-- CreateIndex
CREATE INDEX "LicenseEvent_licenseId_createdAt_idx" ON "LicenseEvent"("licenseId", "createdAt");

-- CreateIndex
CREATE INDEX "LicenseEvent_action_createdAt_idx" ON "LicenseEvent"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "LicenseEvent" ADD CONSTRAINT "LicenseEvent_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "LicenseKey"("licenseId") ON DELETE CASCADE ON UPDATE CASCADE;

