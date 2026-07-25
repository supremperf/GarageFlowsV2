-- Migration: AuditLog table + indexes on key entities for performance

-- AuditLog: immutable history of user actions
CREATE TABLE "AuditLog" (
    "id"         TEXT NOT NULL PRIMARY KEY,
    "action"     TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId"   TEXT,
    "userId"     TEXT NOT NULL,
    "userName"   TEXT NOT NULL,
    "garageId"   TEXT NOT NULL,
    "details"    TEXT,
    "ipAddress"  TEXT,
    "createdAt"  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- AuditLog indexes
CREATE INDEX "AuditLog_garageId_createdAt_idx" ON "AuditLog"("garageId", "createdAt");
CREATE INDEX "AuditLog_userId_idx"              ON "AuditLog"("userId");
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");
CREATE INDEX "AuditLog_garageId_entityType_idx" ON "AuditLog"("garageId", "entityType");

-- Client indexes
CREATE INDEX "Client_garageId_idx"      ON "Client"("garageId");
CREATE INDEX "Client_garageId_name_idx" ON "Client"("garageId", "name");

-- Vehicle indexes
CREATE INDEX "Vehicle_garageId_idx"           ON "Vehicle"("garageId");
CREATE INDEX "Vehicle_clientId_idx"           ON "Vehicle"("clientId");
CREATE INDEX "Vehicle_garageId_updatedAt_idx" ON "Vehicle"("garageId", "updatedAt");

-- Job indexes
CREATE INDEX "Job_garageId_idx"        ON "Job"("garageId");
CREATE INDEX "Job_garageId_date_idx"   ON "Job"("garageId", "date");
CREATE INDEX "Job_garageId_status_idx" ON "Job"("garageId", "status");
CREATE INDEX "Job_mechanicId_idx"      ON "Job"("mechanicId");

-- Quote indexes
CREATE INDEX "Quote_garageId_idx"        ON "Quote"("garageId");
CREATE INDEX "Quote_garageId_status_idx" ON "Quote"("garageId", "status");
CREATE INDEX "Quote_clientId_idx"        ON "Quote"("clientId");

-- Invoice indexes
CREATE INDEX "Invoice_garageId_idx"             ON "Invoice"("garageId");
CREATE INDEX "Invoice_garageId_status_idx"      ON "Invoice"("garageId", "status");
CREATE INDEX "Invoice_clientId_idx"             ON "Invoice"("clientId");
CREATE INDEX "Invoice_garageId_createdAt_idx"   ON "Invoice"("garageId", "createdAt");
