-- CreateTable
CREATE TABLE "EInvoiceSubmission" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "garageId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'sandbox',
    "externalSubmissionId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "documentFormat" TEXT NOT NULL,
    "documentHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "rejectionCode" TEXT,
    "rejectionMessage" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EInvoiceSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EInvoiceEvent" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EInvoiceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EInvoiceSubmission_garageId_idx" ON "EInvoiceSubmission"("garageId");

-- CreateIndex
CREATE INDEX "EInvoiceSubmission_invoiceId_idx" ON "EInvoiceSubmission"("invoiceId");

-- CreateIndex
CREATE INDEX "EInvoiceSubmission_garageId_status_idx" ON "EInvoiceSubmission"("garageId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "EInvoiceSubmission_garageId_idempotencyKey_key" ON "EInvoiceSubmission"("garageId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "EInvoiceEvent_submissionId_idx" ON "EInvoiceEvent"("submissionId");

-- AddForeignKey
ALTER TABLE "EInvoiceSubmission" ADD CONSTRAINT "EInvoiceSubmission_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EInvoiceSubmission" ADD CONSTRAINT "EInvoiceSubmission_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EInvoiceEvent" ADD CONSTRAINT "EInvoiceEvent_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "EInvoiceSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

