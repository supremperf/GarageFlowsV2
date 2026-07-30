-- CreateTable
CREATE TABLE "VinSearch" (
    "id" TEXT NOT NULL,
    "garageId" TEXT NOT NULL,
    "vin" TEXT NOT NULL,
    "resultJson" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'offline',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VinSearch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Signature" (
    "id" TEXT NOT NULL,
    "garageId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "signerName" TEXT NOT NULL,
    "signerRole" TEXT,
    "algorithm" TEXT NOT NULL DEFAULT 'SHA-256 / HMAC-SHA256',
    "contentHash" TEXT NOT NULL,
    "imageHash" TEXT NOT NULL,
    "seal" TEXT NOT NULL,
    "signatureData" TEXT NOT NULL,
    "documentSnapshotJson" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invalidatedAt" TIMESTAMP(3),

    CONSTRAINT "Signature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "garageId" TEXT NOT NULL,
    "trigger" TEXT,
    "channel" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "providerId" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VinSearch_garageId_createdAt_idx" ON "VinSearch"("garageId", "createdAt");

-- CreateIndex
CREATE INDEX "VinSearch_garageId_vin_idx" ON "VinSearch"("garageId", "vin");

-- CreateIndex
CREATE INDEX "Signature_garageId_entityType_entityId_idx" ON "Signature"("garageId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "NotificationLog_garageId_createdAt_idx" ON "NotificationLog"("garageId", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationLog_garageId_status_idx" ON "NotificationLog"("garageId", "status");

-- AddForeignKey
ALTER TABLE "VinSearch" ADD CONSTRAINT "VinSearch_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signature" ADD CONSTRAINT "Signature_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

