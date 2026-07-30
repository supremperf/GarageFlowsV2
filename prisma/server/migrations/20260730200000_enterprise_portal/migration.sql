-- CreateTable
CREATE TABLE "PortalUser" (
    "id" TEXT NOT NULL,
    "garageId" TEXT NOT NULL,
    "clientId" TEXT,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "emailVerifyToken" TEXT,
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "twoFactorSecret" TEXT,
    "twoFactorPending" TEXT,
    "backupCodes" TEXT NOT NULL DEFAULT '[]',
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortalUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalDevice" (
    "id" TEXT NOT NULL,
    "portalUserId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortalDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalTicket" (
    "id" TEXT NOT NULL,
    "garageId" TEXT NOT NULL,
    "portalUserId" TEXT NOT NULL,
    "clientId" TEXT,
    "vehicleId" TEXT,
    "subject" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "status" TEXT NOT NULL DEFAULT 'open',
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortalTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalTicketMessage" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorType" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "attachmentPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortalTicketMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "garageId" TEXT NOT NULL,
    "portalUserId" TEXT,
    "clientId" TEXT,
    "vehicleId" TEXT,
    "clientName" TEXT NOT NULL,
    "vehicleModel" TEXT,
    "licensePlate" TEXT,
    "reason" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "durationMin" INTEGER NOT NULL DEFAULT 60,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "notes" TEXT,
    "reminderSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackupRecord" (
    "id" TEXT NOT NULL,
    "garageId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "checksum" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL DEFAULT 'aes-256-gcm',
    "kdf" TEXT NOT NULL DEFAULT 'raw',
    "entityCounts" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'completed',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackupRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportSnapshot" (
    "id" TEXT NOT NULL,
    "garageId" TEXT NOT NULL,
    "periodDays" INTEGER NOT NULL,
    "healthScore" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PortalUser_garageId_idx" ON "PortalUser"("garageId");

-- CreateIndex
CREATE INDEX "PortalUser_clientId_idx" ON "PortalUser"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "PortalUser_garageId_email_key" ON "PortalUser"("garageId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "PortalDevice_sessionId_key" ON "PortalDevice"("sessionId");

-- CreateIndex
CREATE INDEX "PortalDevice_portalUserId_idx" ON "PortalDevice"("portalUserId");

-- CreateIndex
CREATE INDEX "PortalTicket_garageId_idx" ON "PortalTicket"("garageId");

-- CreateIndex
CREATE INDEX "PortalTicket_garageId_status_idx" ON "PortalTicket"("garageId", "status");

-- CreateIndex
CREATE INDEX "PortalTicket_portalUserId_idx" ON "PortalTicket"("portalUserId");

-- CreateIndex
CREATE INDEX "PortalTicketMessage_ticketId_idx" ON "PortalTicketMessage"("ticketId");

-- CreateIndex
CREATE INDEX "Appointment_garageId_idx" ON "Appointment"("garageId");

-- CreateIndex
CREATE INDEX "Appointment_garageId_date_idx" ON "Appointment"("garageId", "date");

-- CreateIndex
CREATE INDEX "Appointment_portalUserId_idx" ON "Appointment"("portalUserId");

-- CreateIndex
CREATE INDEX "BackupRecord_garageId_idx" ON "BackupRecord"("garageId");

-- CreateIndex
CREATE INDEX "BackupRecord_garageId_createdAt_idx" ON "BackupRecord"("garageId", "createdAt");

-- CreateIndex
CREATE INDEX "ReportSnapshot_garageId_idx" ON "ReportSnapshot"("garageId");

-- CreateIndex
CREATE INDEX "ReportSnapshot_garageId_createdAt_idx" ON "ReportSnapshot"("garageId", "createdAt");

-- AddForeignKey
ALTER TABLE "PortalUser" ADD CONSTRAINT "PortalUser_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalUser" ADD CONSTRAINT "PortalUser_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalDevice" ADD CONSTRAINT "PortalDevice_portalUserId_fkey" FOREIGN KEY ("portalUserId") REFERENCES "PortalUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalTicket" ADD CONSTRAINT "PortalTicket_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalTicket" ADD CONSTRAINT "PortalTicket_portalUserId_fkey" FOREIGN KEY ("portalUserId") REFERENCES "PortalUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalTicketMessage" ADD CONSTRAINT "PortalTicketMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "PortalTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackupRecord" ADD CONSTRAINT "BackupRecord_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSnapshot" ADD CONSTRAINT "ReportSnapshot_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

