-- Facturation électronique (Phase 2) — additif, non destructif.
-- Tables serveur pour les connexions plateformes, transmissions, événements et
-- journal d'audit. Aucune donnée existante modifiée. Les secrets (credentials)
-- sont stockés CHIFFRÉS (enveloppe gfeic1…), jamais en clair.

CREATE TABLE IF NOT EXISTS "GarageEInvoiceConnection" (
    "id" TEXT NOT NULL,
    "garageId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "environment" TEXT NOT NULL DEFAULT 'sandbox',
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "authMethod" TEXT,
    "externalAccountId" TEXT,
    "legalEntityId" TEXT,
    "siren" TEXT,
    "capabilities" TEXT,
    "credentials" TEXT,
    "credentialsKeyVersion" INTEGER NOT NULL DEFAULT 1,
    "lastTestedAt" TIMESTAMP(3),
    "lastTestOk" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GarageEInvoiceConnection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "GarageEInvoiceConnection_garageId_providerId_environment_key" ON "GarageEInvoiceConnection"("garageId", "providerId", "environment");
CREATE INDEX IF NOT EXISTS "GarageEInvoiceConnection_garageId_idx" ON "GarageEInvoiceConnection"("garageId");
CREATE INDEX IF NOT EXISTS "GarageEInvoiceConnection_status_idx" ON "GarageEInvoiceConnection"("status");

CREATE TABLE IF NOT EXISTS "EInvoiceTransmission" (
    "id" TEXT NOT NULL,
    "garageId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "connectionId" TEXT,
    "environment" TEXT NOT NULL DEFAULT 'sandbox',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "documentFormat" TEXT,
    "documentSha256" TEXT,
    "externalId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EInvoiceTransmission_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "EInvoiceTransmission_idempotencyKey_key" ON "EInvoiceTransmission"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "EInvoiceTransmission_garageId_createdAt_idx" ON "EInvoiceTransmission"("garageId", "createdAt");
CREATE INDEX IF NOT EXISTS "EInvoiceTransmission_invoiceId_idx" ON "EInvoiceTransmission"("invoiceId");
CREATE INDEX IF NOT EXISTS "EInvoiceTransmission_status_idx" ON "EInvoiceTransmission"("status");

CREATE TABLE IF NOT EXISTS "EInvoiceEvent" (
    "id" TEXT NOT NULL,
    "transmissionId" TEXT NOT NULL,
    "garageId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT,
    "message" TEXT,
    "payload" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EInvoiceEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "EInvoiceEvent_transmissionId_createdAt_idx" ON "EInvoiceEvent"("transmissionId", "createdAt");
CREATE INDEX IF NOT EXISTS "EInvoiceEvent_garageId_createdAt_idx" ON "EInvoiceEvent"("garageId", "createdAt");

CREATE TABLE IF NOT EXISTS "EInvoiceAuditEvent" (
    "id" TEXT NOT NULL,
    "garageId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EInvoiceAuditEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "EInvoiceAuditEvent_garageId_createdAt_idx" ON "EInvoiceAuditEvent"("garageId", "createdAt");
CREATE INDEX IF NOT EXISTS "EInvoiceAuditEvent_actorUserId_createdAt_idx" ON "EInvoiceAuditEvent"("actorUserId", "createdAt");
