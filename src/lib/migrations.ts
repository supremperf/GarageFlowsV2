/**
 * Spécification d'un index UNIQUE créé par le runner avec CONTRÔLE DE DOUBLONS.
 * Le runner détecte d'abord les groupes en doublon : s'il en existe, l'index
 * n'est PAS créé (statut « deferred », réessayé au prochain démarrage) — jamais
 * d'échec bloquant ni de suppression de données. Sinon l'index UNIQUE est créé.
 */
export interface UniqueIndexMigration {
  /** Nom d'index (convention Prisma : <Table>_<col..>_key) — idempotent. */
  name: string
  table: string
  columns: string[]
}

/** Garde conditionnelle : la migration ne s'applique que selon l'état RÉEL du schéma. */
export interface ColumnGuard {
  table: string
  column: string
}

/**
 * Étape d'une migration COMPOSITE. Les étapes d'une même migration s'exécutent
 * dans UNE SEULE transaction : tout réussit (et la migration est enregistrée)
 * ou tout est annulé (ROLLBACK) — jamais d'état intermédiaire persistant.
 */
export interface MigrationStep {
  /** L'étape ne s'exécute que si la colonne EXISTE (ex. backfill/drop d'une ancienne colonne). */
  onlyIfColumnExists?: ColumnGuard
  /** L'étape ne s'exécute que si la colonne MANQUE (idempotence des ADD COLUMN). */
  onlyIfColumnMissing?: ColumnGuard
  /** Instruction SQL de l'étape (mutuellement exclusif avec verifySql). */
  sql?: string
  /**
   * VÉRIFICATION BLOQUANTE : la requête doit renvoyer une ligne `{ n }` avec
   * n === 0. Tout n > 0 fait ÉCHOUER la migration (rollback complet) — aucune
   * étape destructive (DROP) ne peut donc suivre un backfill divergent.
   */
  verifySql?: string
}

export interface Migration {
  id: string
  /** Instruction SQL unique (forme historique, entrées 001-161). */
  sql?: string
  /** Création d'un index UNIQUE sûre (contrôle de doublons — non destructif, différable). */
  uniqueIndex?: UniqueIndexMigration
  /**
   * Migration COMPOSITE atomique : ADD → BACKFILL → VERIFY → DROP dans une seule
   * transaction, enregistrée uniquement après réussite complète.
   */
  steps?: MigrationStep[]
  /**
   * Migration de DONNÉES en code (pas en SQL) : 'json-v2' convertit les JSON
   * monétaires persistés v1 (euros flottants) au format v2 (entiers exacts).
   * Implémentée dans /api/internal/migrate (transactionnelle, vérifiée).
   */
  kind?: 'json-v2'
  /** Forme historique : garde sur la migration entière (entrées 001-161). */
  onlyIfColumnExists?: ColumnGuard
  onlyIfColumnMissing?: ColumnGuard
}

/** SQL listant les colonnes d'une table (PRAGMA) — pour les gardes ci-dessus. */
export function tableColumnsSql(table: string): string {
  return `PRAGMA table_info(${quoteIdent(table)})`
}

/** Échappe un identifiant SQLite (guillemets doubles). */
function quoteIdent(id: string): string {
  return `"${id.replace(/"/g, '""')}"`
}

/**
 * SQL détectant les groupes en doublon qui EMPÊCHERAIENT un index UNIQUE.
 * Les NULL sont exclus : SQLite autorise plusieurs NULL sous une contrainte
 * UNIQUE (NULL ≠ NULL), donc ils ne créent jamais de conflit.
 */
export function duplicateGroupsSql(u: UniqueIndexMigration): string {
  const cols = u.columns.map(quoteIdent).join(', ')
  const notNull = u.columns.map((c) => `${quoteIdent(c)} IS NOT NULL`).join(' AND ')
  return `SELECT ${cols} FROM ${quoteIdent(u.table)} WHERE ${notNull} GROUP BY ${cols} HAVING COUNT(*) > 1 LIMIT 5`
}

/** SQL de création idempotente de l'index UNIQUE. */
export function createUniqueIndexSql(u: UniqueIndexMigration): string {
  const cols = u.columns.map(quoteIdent).join(', ')
  return `CREATE UNIQUE INDEX IF NOT EXISTS ${quoteIdent(u.name)} ON ${quoteIdent(u.table)}(${cols})`
}

export const MIGRATIONS: Migration[] = [
  // ── JobPhoto ──────────────────────────────────────────────────────────────
  { id: '001_job_photo_path',             onlyIfColumnMissing: { table: 'JobPhoto', column: 'photoPath' }, sql: 'ALTER TABLE "JobPhoto" ADD COLUMN "photoPath" TEXT' },
  // ── InspectionItem ────────────────────────────────────────────────────────
  { id: '002_inspection_item_photo_path', onlyIfColumnMissing: { table: 'InspectionItem', column: 'photoPath' }, sql: 'ALTER TABLE "InspectionItem" ADD COLUMN "photoPath" TEXT' },
  // ── Garage columns ────────────────────────────────────────────────────────
  { id: '003_garage_logo_path',           onlyIfColumnMissing: { table: 'Garage', column: 'logoPath' }, sql: 'ALTER TABLE "Garage" ADD COLUMN "logoPath" TEXT' },
  { id: '004_garage_workshop_start_hour', onlyIfColumnMissing: { table: 'Garage', column: 'workshopStartHour' }, sql: 'ALTER TABLE "Garage" ADD COLUMN "workshopStartHour" INTEGER DEFAULT 8' },
  { id: '005_garage_workshop_end_hour',   onlyIfColumnMissing: { table: 'Garage', column: 'workshopEndHour' }, sql: 'ALTER TABLE "Garage" ADD COLUMN "workshopEndHour" INTEGER DEFAULT 18' },
  { id: '006_garage_hourly_rate',         onlyIfColumnMissing: { table: 'Garage', column: 'hourlyRate' }, sql: 'ALTER TABLE "Garage" ADD COLUMN "hourlyRate" REAL DEFAULT 60' },
  { id: '007_garage_tax_rate',            onlyIfColumnMissing: { table: 'Garage', column: 'taxRate' }, sql: 'ALTER TABLE "Garage" ADD COLUMN "taxRate" REAL DEFAULT 20' },
  { id: '008_garage_currency',            onlyIfColumnMissing: { table: 'Garage', column: 'currency' }, sql: 'ALTER TABLE "Garage" ADD COLUMN "currency" TEXT DEFAULT "EUR"' },
  { id: '009_garage_payment_terms',       onlyIfColumnMissing: { table: 'Garage', column: 'paymentTerms' }, sql: 'ALTER TABLE "Garage" ADD COLUMN "paymentTerms" TEXT' },
  { id: '010_garage_invoice_prefix',      onlyIfColumnMissing: { table: 'Garage', column: 'invoicePrefix' }, sql: 'ALTER TABLE "Garage" ADD COLUMN "invoicePrefix" TEXT DEFAULT "FAC"' },
  { id: '011_garage_invoice_counter',     onlyIfColumnMissing: { table: 'Garage', column: 'invoiceCounter' }, sql: 'ALTER TABLE "Garage" ADD COLUMN "invoiceCounter" INTEGER DEFAULT 0' },
  { id: '012_garage_quote_prefix',        onlyIfColumnMissing: { table: 'Garage', column: 'quotePrefix' }, sql: 'ALTER TABLE "Garage" ADD COLUMN "quotePrefix" TEXT DEFAULT "DEV"' },
  { id: '013_garage_quote_counter',       onlyIfColumnMissing: { table: 'Garage', column: 'quoteCounter' }, sql: 'ALTER TABLE "Garage" ADD COLUMN "quoteCounter" INTEGER DEFAULT 0' },
  { id: '014_garage_invoice_footer',      onlyIfColumnMissing: { table: 'Garage', column: 'invoiceFooter' }, sql: 'ALTER TABLE "Garage" ADD COLUMN "invoiceFooter" TEXT' },
  { id: '015_garage_language',            onlyIfColumnMissing: { table: 'Garage', column: 'language' }, sql: 'ALTER TABLE "Garage" ADD COLUMN "language" TEXT DEFAULT "fr"' },
  { id: '016_garage_onboarding_complete', onlyIfColumnMissing: { table: 'Garage', column: 'onboardingComplete' }, sql: 'ALTER TABLE "Garage" ADD COLUMN "onboardingComplete" INTEGER DEFAULT 0' },
  { id: '017_garage_sms_phone',           onlyIfColumnMissing: { table: 'Garage', column: 'smsPhone' }, sql: 'ALTER TABLE "Garage" ADD COLUMN "smsPhone" TEXT' },
  { id: '018_garage_work_order_prefix',   onlyIfColumnMissing: { table: 'Garage', column: 'workOrderPrefix' }, sql: 'ALTER TABLE "Garage" ADD COLUMN "workOrderPrefix" TEXT DEFAULT "OR"' },
  { id: '019_garage_work_order_counter',  onlyIfColumnMissing: { table: 'Garage', column: 'workOrderCounter' }, sql: 'ALTER TABLE "Garage" ADD COLUMN "workOrderCounter" INTEGER DEFAULT 0' },
  { id: '020_garage_warranty_months',     onlyIfColumnMissing: { table: 'Garage', column: 'warrantyMonthsDefault' }, sql: 'ALTER TABLE "Garage" ADD COLUMN "warrantyMonthsDefault" INTEGER DEFAULT 12' },
  { id: '021_garage_loaner_enabled',      onlyIfColumnMissing: { table: 'Garage', column: 'loanerEnabled' }, sql: 'ALTER TABLE "Garage" ADD COLUMN "loanerEnabled" INTEGER DEFAULT 0' },
  { id: '022_garage_smart_reminder',      onlyIfColumnMissing: { table: 'Garage', column: 'smartReminderMonths' }, sql: 'ALTER TABLE "Garage" ADD COLUMN "smartReminderMonths" INTEGER DEFAULT 11' },
  { id: '023_garage_po_prefix',           onlyIfColumnMissing: { table: 'Garage', column: 'purchaseOrderPrefix' }, sql: 'ALTER TABLE "Garage" ADD COLUMN "purchaseOrderPrefix" TEXT DEFAULT "BC"' },
  { id: '024_garage_po_counter',          onlyIfColumnMissing: { table: 'Garage', column: 'purchaseOrderCounter' }, sql: 'ALTER TABLE "Garage" ADD COLUMN "purchaseOrderCounter" INTEGER DEFAULT 0' },
  { id: '025_garage_website',             onlyIfColumnMissing: { table: 'Garage', column: 'website' }, sql: 'ALTER TABLE "Garage" ADD COLUMN "website" TEXT' },
  { id: '026_garage_email',               onlyIfColumnMissing: { table: 'Garage', column: 'email' }, sql: 'ALTER TABLE "Garage" ADD COLUMN "email" TEXT' },
  { id: '027_garage_siret',               onlyIfColumnMissing: { table: 'Garage', column: 'siret' }, sql: 'ALTER TABLE "Garage" ADD COLUMN "siret" TEXT' },
  { id: '028_garage_vat_number',          onlyIfColumnMissing: { table: 'Garage', column: 'vatNumber' }, sql: 'ALTER TABLE "Garage" ADD COLUMN "vatNumber" TEXT' },
  { id: '029_garage_iban',                onlyIfColumnMissing: { table: 'Garage', column: 'iban' }, sql: 'ALTER TABLE "Garage" ADD COLUMN "iban" TEXT' },
  { id: '030_garage_bic',                 onlyIfColumnMissing: { table: 'Garage', column: 'bic' }, sql: 'ALTER TABLE "Garage" ADD COLUMN "bic" TEXT' },
  { id: '031_garage_bank_name',           onlyIfColumnMissing: { table: 'Garage', column: 'bankName' }, sql: 'ALTER TABLE "Garage" ADD COLUMN "bankName" TEXT' },
  // ── Mechanic columns ──────────────────────────────────────────────────────
  { id: '032_mechanic_is_absent',         onlyIfColumnMissing: { table: 'Mechanic', column: 'isAbsent' }, sql: 'ALTER TABLE "Mechanic" ADD COLUMN "isAbsent" INTEGER DEFAULT 0' },
  { id: '033_mechanic_specialty',         onlyIfColumnMissing: { table: 'Mechanic', column: 'specialty' }, sql: 'ALTER TABLE "Mechanic" ADD COLUMN "specialty" TEXT DEFAULT "[]"' },
  { id: '034_mechanic_order',             onlyIfColumnMissing: { table: 'Mechanic', column: 'order' }, sql: 'ALTER TABLE "Mechanic" ADD COLUMN "order" INTEGER DEFAULT 0' },
  // ── Job columns ───────────────────────────────────────────────────────────
  { id: '035_job_garage_id',              onlyIfColumnMissing: { table: 'Job', column: 'garageId' }, sql: 'ALTER TABLE "Job" ADD COLUMN "garageId" TEXT' },
  // ── Email SMTP columns ────────────────────────────────────────────────────
  { id: '036_garage_smtp_host',           onlyIfColumnMissing: { table: 'Garage', column: 'smtpHost' }, sql: 'ALTER TABLE "Garage" ADD COLUMN "smtpHost" TEXT' },
  { id: '037_garage_smtp_port',           onlyIfColumnMissing: { table: 'Garage', column: 'smtpPort' }, sql: 'ALTER TABLE "Garage" ADD COLUMN "smtpPort" INTEGER' },
  { id: '038_garage_smtp_user',           onlyIfColumnMissing: { table: 'Garage', column: 'smtpUser' }, sql: 'ALTER TABLE "Garage" ADD COLUMN "smtpUser" TEXT' },
  { id: '039_garage_smtp_pass',           onlyIfColumnMissing: { table: 'Garage', column: 'smtpPass' }, sql: 'ALTER TABLE "Garage" ADD COLUMN "smtpPass" TEXT' },
  { id: '040_garage_smtp_from',           onlyIfColumnMissing: { table: 'Garage', column: 'smtpFrom' }, sql: 'ALTER TABLE "Garage" ADD COLUMN "smtpFrom" TEXT' },
  { id: '041_garage_smtp_secure',         onlyIfColumnMissing: { table: 'Garage', column: 'smtpSecure' }, sql: 'ALTER TABLE "Garage" ADD COLUMN "smtpSecure" INTEGER DEFAULT 1' },
  // ── LoanerReservation paid fields ────────────────────────────────────────────
  { id: '042_loaner_is_paid',            onlyIfColumnMissing: { table: 'LoanerReservation', column: 'isPaid' }, sql: 'ALTER TABLE "LoanerReservation" ADD COLUMN "isPaid" INTEGER DEFAULT 0' },
  { id: '043_loaner_daily_rate',         onlyIfColumnMissing: { table: 'LoanerReservation', column: 'dailyRate' }, sql: 'ALTER TABLE "LoanerReservation" ADD COLUMN "dailyRate" REAL' },
  { id: '044_loaner_deposit_amount',     onlyIfColumnMissing: { table: 'LoanerReservation', column: 'depositAmount' }, sql: 'ALTER TABLE "LoanerReservation" ADD COLUMN "depositAmount" REAL' },
  // ── Ensure Loaner tables exist (CREATE TABLE IF NOT EXISTS) ──────────────────
  // Must run AFTER 042-044 attempts so the tables exist when those retry.
  { id: '045_create_loaner_vehicle_table', sql: `CREATE TABLE IF NOT EXISTS "LoanerVehicle" (
    "id"           TEXT PRIMARY KEY NOT NULL,
    "garageId"     TEXT NOT NULL,
    "name"         TEXT NOT NULL,
    "licensePlate" TEXT NOT NULL DEFAULT '',
    "make"         TEXT,
    "model"        TEXT,
    "year"         INTEGER,
    "color"        TEXT,
    "notes"        TEXT,
    "isActive"     INTEGER NOT NULL DEFAULT 1,
    "createdAt"    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )` },
  { id: '046_create_loaner_reservation_table', sql: `CREATE TABLE IF NOT EXISTS "LoanerReservation" (
    "id"           TEXT PRIMARY KEY NOT NULL,
    "garageId"     TEXT NOT NULL,
    "vehicleId"    TEXT NOT NULL,
    "jobId"        TEXT,
    "clientName"   TEXT NOT NULL,
    "clientPhone"  TEXT,
    "startDate"    DATETIME NOT NULL,
    "endDate"      DATETIME NOT NULL,
    "returnedAt"   DATETIME,
    "mileageOut"   INTEGER,
    "mileageIn"    INTEGER,
    "conditionOut" TEXT,
    "conditionIn"  TEXT,
    "status"       TEXT NOT NULL DEFAULT 'reserved',
    "notes"        TEXT,
    "isPaid"       INTEGER NOT NULL DEFAULT 0,
    "dailyRate"    REAL,
    "depositAmount" REAL,
    "createdAt"    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )` },
  // ── Warranty table ──────────────────────────────────────────────────────────
  { id: '047_create_warranty_table', sql: `CREATE TABLE IF NOT EXISTS "Warranty" (
    "id"               TEXT PRIMARY KEY NOT NULL,
    "garageId"         TEXT NOT NULL,
    "jobId"            TEXT,
    "vehicleId"        TEXT,
    "clientName"       TEXT NOT NULL DEFAULT '',
    "licensePlate"     TEXT,
    "vehicleModel"     TEXT,
    "partName"         TEXT NOT NULL,
    "partReference"    TEXT,
    "lotNumber"        TEXT,
    "installedAt"      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "durationMonths"   INTEGER NOT NULL DEFAULT 12,
    "expiresAt"        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mileageAtInstall" INTEGER,
    "supplierName"     TEXT,
    "notes"            TEXT,
    "status"           TEXT NOT NULL DEFAULT 'active',
    "claimedAt"        DATETIME,
    "claimNotes"       TEXT,
    "createdAt"        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )` },
  // ── Part table — missing columns ─────────────────────────────────────────────
  { id: '048_part_supplier_name', onlyIfColumnMissing: { table: 'Part', column: 'supplierName' }, sql: 'ALTER TABLE "Part" ADD COLUMN "supplierName" TEXT' },
  { id: '049_part_supplier_ref',  onlyIfColumnMissing: { table: 'Part', column: 'supplierRef' }, sql: 'ALTER TABLE "Part" ADD COLUMN "supplierRef" TEXT' },
  // ── Ensure ALL tables exist (idempotent) — répare les bases mises à niveau
  //    depuis une ancienne version où certaines tables manquaient. ─────────────
  { id: '050_ensure_garage_table', sql: `CREATE TABLE IF NOT EXISTS "Garage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'FREE',
    "hourlyRate" REAL NOT NULL DEFAULT 60,
    "workshopStartHour" INTEGER NOT NULL DEFAULT 8,
    "workshopEndHour" INTEGER NOT NULL DEFAULT 18,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "logoBase64" TEXT,
    "logoPath" TEXT,
    "siret" TEXT,
    "vatNumber" TEXT,
    "taxRate" REAL NOT NULL DEFAULT 20,
    "iban" TEXT,
    "bic" TEXT,
    "bankName" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "paymentTerms" TEXT,
    "invoicePrefix" TEXT NOT NULL DEFAULT 'FAC',
    "invoiceCounter" INTEGER NOT NULL DEFAULT 0,
    "quotePrefix" TEXT NOT NULL DEFAULT 'DEV',
    "quoteCounter" INTEGER NOT NULL DEFAULT 0,
    "invoiceFooter" TEXT,
    "language" TEXT NOT NULL DEFAULT 'fr',
    "onboardingComplete" BOOLEAN NOT NULL DEFAULT false,
    "smsPhone" TEXT,
    "workOrderPrefix" TEXT NOT NULL DEFAULT 'OR',
    "workOrderCounter" INTEGER NOT NULL DEFAULT 0,
    "warrantyMonthsDefault" INTEGER NOT NULL DEFAULT 12,
    "loanerEnabled" BOOLEAN NOT NULL DEFAULT false,
    "smartReminderMonths" INTEGER NOT NULL DEFAULT 11,
    "purchaseOrderPrefix" TEXT NOT NULL DEFAULT 'BC',
    "purchaseOrderCounter" INTEGER NOT NULL DEFAULT 0,
    "smtpHost" TEXT,
    "smtpPort" INTEGER,
    "smtpUser" TEXT,
    "smtpPass" TEXT,
    "smtpFrom" TEXT,
    "smtpSecure" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
)` },
  { id: '051_ensure_user_table', sql: `CREATE TABLE IF NOT EXISTS "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'RECEPTIONIST',
    "garageId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "User_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)` },
  { id: '052_ensure_mechanic_table', sql: `CREATE TABLE IF NOT EXISTS "Mechanic" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "avatar" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "isAbsent" BOOLEAN NOT NULL DEFAULT false,
    "specialty" TEXT NOT NULL DEFAULT '[]',
    "order" INTEGER NOT NULL DEFAULT 0,
    "garageId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Mechanic_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)` },
  { id: '053_ensure_client_table', sql: `CREATE TABLE IF NOT EXISTS "Client" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "garageId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Client_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)` },
  { id: '054_ensure_vehicle_table', sql: `CREATE TABLE IF NOT EXISTS "Vehicle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "licensePlate" TEXT NOT NULL,
    "vin" TEXT,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INTEGER,
    "mileage" INTEGER,
    "color" TEXT,
    "notes" TEXT,
    "ctDate" TEXT,
    "clientId" TEXT NOT NULL,
    "garageId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Vehicle_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Vehicle_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)` },
  { id: '055_ensure_part_table', sql: `CREATE TABLE IF NOT EXISTS "Part" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reference" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "minQuantity" INTEGER NOT NULL DEFAULT 5,
    "unitCost" REAL NOT NULL DEFAULT 0,
    "unitPrice" REAL NOT NULL DEFAULT 0,
    "location" TEXT,
    "supplierName" TEXT,
    "supplierRef" TEXT,
    "garageId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Part_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)` },
  { id: '056_ensure_job_table', sql: `CREATE TABLE IF NOT EXISTS "Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerName" TEXT NOT NULL,
    "vehicleModel" TEXT NOT NULL,
    "licensePlate" TEXT,
    "repairType" TEXT NOT NULL,
    "estimatedDuration" INTEGER NOT NULL,
    "actualDuration" INTEGER,
    "startTime" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "notes" TEXT,
    "isUrgent" BOOLEAN NOT NULL DEFAULT false,
    "delayMinutes" INTEGER,
    "mileageAtVisit" INTEGER,
    "timerStartedAt" DATETIME,
    "mechanicId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "garageId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Job_mechanicId_fkey" FOREIGN KEY ("mechanicId") REFERENCES "Mechanic" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Job_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Job_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)` },
  { id: '057_ensure_jobpart_table', sql: `CREATE TABLE IF NOT EXISTS "JobPart" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" REAL NOT NULL,
    "unitCost" REAL NOT NULL,
    CONSTRAINT "JobPart_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "JobPart_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
)` },
  { id: '058_ensure_jobphoto_table', sql: `CREATE TABLE IF NOT EXISTS "JobPhoto" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "garageId" TEXT NOT NULL,
    "phase" TEXT NOT NULL DEFAULT 'before',
    "caption" TEXT,
    "base64" TEXT NOT NULL,
    "photoPath" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JobPhoto_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)` },
  { id: '059_ensure_repairtypepart_table', sql: `CREATE TABLE IF NOT EXISTS "RepairTypePart" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "repairType" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "defaultQty" INTEGER NOT NULL DEFAULT 1,
    "garageId" TEXT NOT NULL,
    CONSTRAINT "RepairTypePart_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)` },
  { id: '060_ensure_reminder_table', sql: `CREATE TABLE IF NOT EXISTS "Reminder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "garageId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "clientId" TEXT,
    "clientName" TEXT NOT NULL,
    "vehicleModel" TEXT,
    "licensePlate" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "type" TEXT NOT NULL,
    "scheduledDate" TEXT NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Reminder_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Reminder_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Reminder_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE SET NULL ON UPDATE CASCADE
)` },
  { id: '061_ensure_quote_table', sql: `CREATE TABLE IF NOT EXISTS "Quote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "number" TEXT NOT NULL,
    "garageId" TEXT NOT NULL,
    "clientId" TEXT,
    "vehicleId" TEXT,
    "jobId" TEXT,
    "clientName" TEXT NOT NULL,
    "clientEmail" TEXT,
    "clientPhone" TEXT,
    "clientAddress" TEXT,
    "vehicleModel" TEXT,
    "licensePlate" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "issueDate" TEXT NOT NULL,
    "validUntil" TEXT,
    "notes" TEXT,
    "taxRate" REAL NOT NULL DEFAULT 20,
    "invoiceId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Quote_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Quote_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Quote_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Quote_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE SET NULL ON UPDATE CASCADE
)` },
  { id: '062_ensure_quoteline_table', sql: `CREATE TABLE IF NOT EXISTS "QuoteLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "quoteId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" REAL NOT NULL DEFAULT 1,
    "unitPrice" REAL NOT NULL DEFAULT 0,
    "unitCost" REAL NOT NULL DEFAULT 0,
    "isLabor" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "QuoteLine_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)` },
  { id: '063_ensure_invoice_table', sql: `CREATE TABLE IF NOT EXISTS "Invoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "number" TEXT NOT NULL,
    "garageId" TEXT NOT NULL,
    "clientId" TEXT,
    "vehicleId" TEXT,
    "jobId" TEXT,
    "quoteId" TEXT,
    "clientName" TEXT NOT NULL,
    "clientEmail" TEXT,
    "clientPhone" TEXT,
    "clientAddress" TEXT,
    "vehicleModel" TEXT,
    "licensePlate" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "issueDate" TEXT NOT NULL,
    "dueDate" TEXT,
    "notes" TEXT,
    "taxRate" REAL NOT NULL DEFAULT 20,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Invoice_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Invoice_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Invoice_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Invoice_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE SET NULL ON UPDATE CASCADE
)` },
  { id: '064_ensure_invoiceline_table', sql: `CREATE TABLE IF NOT EXISTS "InvoiceLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" REAL NOT NULL DEFAULT 1,
    "unitPrice" REAL NOT NULL DEFAULT 0,
    "unitCost" REAL NOT NULL DEFAULT 0,
    "isLabor" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)` },
  { id: '065_ensure_inspection_table', sql: `CREATE TABLE IF NOT EXISTS "Inspection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "garageId" TEXT NOT NULL,
    "jobId" TEXT,
    "vehicleId" TEXT,
    "clientName" TEXT NOT NULL,
    "vehicleModel" TEXT,
    "licensePlate" TEXT,
    "mileage" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Inspection_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Inspection_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Inspection_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle" ("id") ON DELETE SET NULL ON UPDATE CASCADE
)` },
  { id: '066_ensure_inspectionitem_table', sql: `CREATE TABLE IF NOT EXISTS "InspectionItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "inspectionId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ok',
    "notes" TEXT,
    "photoBase64" TEXT,
    "photoPath" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "InspectionItem_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "Inspection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)` },
  { id: '067_ensure_laboroperation_table', sql: `CREATE TABLE IF NOT EXISTS "LaborOperation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "garageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "durationMin" INTEGER NOT NULL DEFAULT 30,
    "unitPrice" REAL NOT NULL DEFAULT 0,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LaborOperation_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)` },
  { id: '068_ensure_warranty_table', sql: `CREATE TABLE IF NOT EXISTS "Warranty" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "garageId" TEXT NOT NULL,
    "jobId" TEXT,
    "vehicleId" TEXT,
    "clientName" TEXT NOT NULL,
    "licensePlate" TEXT,
    "vehicleModel" TEXT,
    "partName" TEXT NOT NULL,
    "partReference" TEXT,
    "lotNumber" TEXT,
    "installedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "durationMonths" INTEGER NOT NULL DEFAULT 12,
    "expiresAt" DATETIME NOT NULL,
    "mileageAtInstall" INTEGER,
    "supplierName" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "claimedAt" DATETIME,
    "claimNotes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Warranty_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Warranty_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Warranty_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle" ("id") ON DELETE SET NULL ON UPDATE CASCADE
)` },
  { id: '069_ensure_loanervehicle_table', sql: `CREATE TABLE IF NOT EXISTS "LoanerVehicle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "garageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "licensePlate" TEXT NOT NULL,
    "make" TEXT,
    "model" TEXT,
    "year" INTEGER,
    "color" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LoanerVehicle_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)` },
  { id: '070_ensure_loanerreservation_table', sql: `CREATE TABLE IF NOT EXISTS "LoanerReservation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "garageId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "jobId" TEXT,
    "clientName" TEXT NOT NULL,
    "clientPhone" TEXT,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "returnedAt" DATETIME,
    "mileageOut" INTEGER,
    "mileageIn" INTEGER,
    "conditionOut" TEXT,
    "conditionIn" TEXT,
    "status" TEXT NOT NULL DEFAULT 'reserved',
    "notes" TEXT,
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "dailyRate" REAL,
    "depositAmount" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LoanerReservation_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LoanerReservation_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "LoanerVehicle" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LoanerReservation_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE SET NULL ON UPDATE CASCADE
)` },
  { id: '071_ensure_purchaseorder_table', sql: `CREATE TABLE IF NOT EXISTS "PurchaseOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "number" TEXT NOT NULL,
    "garageId" TEXT NOT NULL,
    "supplierName" TEXT,
    "supplierEmail" TEXT,
    "linesJson" TEXT NOT NULL DEFAULT '[]',
    "totalHT" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "notes" TEXT,
    "sentAt" DATETIME,
    "receivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PurchaseOrder_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)` },
  { id: '072_ensure_workorder_table', sql: `CREATE TABLE IF NOT EXISTS "WorkOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "number" TEXT NOT NULL,
    "garageId" TEXT NOT NULL,
    "jobId" TEXT,
    "mechanicId" TEXT,
    "clientName" TEXT NOT NULL,
    "clientPhone" TEXT,
    "clientEmail" TEXT,
    "clientAddress" TEXT,
    "vehicleMake" TEXT,
    "vehicleModel" TEXT,
    "licensePlate" TEXT,
    "mileage" INTEGER,
    "vin" TEXT,
    "worksJson" TEXT NOT NULL DEFAULT '[]',
    "partsJson" TEXT NOT NULL DEFAULT '[]',
    "taxRate" REAL NOT NULL DEFAULT 20,
    "totalHT" REAL NOT NULL DEFAULT 0,
    "totalTTC" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "signatureData" TEXT,
    "signedAt" DATETIME,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkOrder_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkOrder_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "WorkOrder_mechanicId_fkey" FOREIGN KEY ("mechanicId") REFERENCES "Mechanic" ("id") ON DELETE SET NULL ON UPDATE CASCADE
)` },
  { id: '073_ensure_auditlog_table', sql: `CREATE TABLE IF NOT EXISTS "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "garageId" TEXT NOT NULL,
    "details" TEXT,
    "ipAddress" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)` },
  { id: '074_ensure_licensekey_table', sql: `CREATE TABLE IF NOT EXISTS "LicenseKey" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "licenseId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "licenseType" TEXT NOT NULL,
    "expiryAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "seats" INTEGER NOT NULL DEFAULT 1,
    "hwid" TEXT,
    "label" TEXT,
    "notes" TEXT,
    "recordMac" TEXT,
    "activatedAt" DATETIME,
    "revokedAt" DATETIME,
    "lastSeenAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
)` },
  { id: '075_reminder_scheduled_time', onlyIfColumnMissing: { table: 'Reminder', column: 'scheduledTime' }, sql: 'ALTER TABLE "Reminder" ADD COLUMN "scheduledTime" TEXT' },
  // ── Unicité de la numérotation par garage (factures, devis, OR, BC) ──────────
  // Filet de sécurité au niveau base : deux documents du même garage ne peuvent
  // jamais partager un numéro. Si des doublons historiques existent, la création
  // de l'index échoue et est retentée au prochain démarrage (le runner ne marque
  // pas la migration comme appliquée en cas d'erreur).
  { id: '076_unique_invoice_number',       sql: 'CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_garageId_number_key" ON "Invoice"("garageId", "number")' },
  { id: '077_unique_quote_number',         sql: 'CREATE UNIQUE INDEX IF NOT EXISTS "Quote_garageId_number_key" ON "Quote"("garageId", "number")' },
  { id: '078_unique_workorder_number',     sql: 'CREATE UNIQUE INDEX IF NOT EXISTS "WorkOrder_garageId_number_key" ON "WorkOrder"("garageId", "number")' },
  { id: '079_unique_purchaseorder_number', sql: 'CREATE UNIQUE INDEX IF NOT EXISTS "PurchaseOrder_garageId_number_key" ON "PurchaseOrder"("garageId", "number")' },
  // ── Appareils par licence (deviceToken haché + HWID haché, jamais en clair) ──
  { id: '080_ensure_licensedevice_table', sql: `CREATE TABLE IF NOT EXISTS "LicenseDevice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deviceId" TEXT NOT NULL,
    "licenseId" TEXT NOT NULL,
    "hwidHash" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "name" TEXT,
    "platform" TEXT,
    "appVersion" TEXT,
    "firstActivatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" DATETIME,
    "revokeReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LicenseDevice_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "LicenseKey" ("licenseId") ON DELETE CASCADE ON UPDATE CASCADE
)` },
  { id: '081_ensure_licensedeviceevent_table', sql: `CREATE TABLE IF NOT EXISTS "LicenseDeviceEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "licenseId" TEXT NOT NULL,
    "deviceId" TEXT,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)` },
  { id: '082_licensedevice_deviceid_unique',  sql: 'CREATE UNIQUE INDEX IF NOT EXISTS "LicenseDevice_deviceId_key" ON "LicenseDevice"("deviceId")' },
  { id: '083_licensedevice_tokenhash_unique', sql: 'CREATE UNIQUE INDEX IF NOT EXISTS "LicenseDevice_tokenHash_key" ON "LicenseDevice"("tokenHash")' },
  { id: '084_licensedevice_hwid_unique',      sql: 'CREATE UNIQUE INDEX IF NOT EXISTS "LicenseDevice_licenseId_hwidHash_key" ON "LicenseDevice"("licenseId", "hwidHash")' },
  { id: '085_licensedevice_status_idx',       sql: 'CREATE INDEX IF NOT EXISTS "LicenseDevice_licenseId_status_idx" ON "LicenseDevice"("licenseId", "status")' },
  { id: '086_licensedeviceevent_idx',         sql: 'CREATE INDEX IF NOT EXISTS "LicenseDeviceEvent_licenseId_createdAt_idx" ON "LicenseDeviceEvent"("licenseId", "createdAt")' },
  // ── Liaison licence ↔ garage (parité avec le schéma serveur ; null en desktop) ──
  { id: '087_licensekey_garageid',            onlyIfColumnMissing: { table: 'LicenseKey', column: 'garageId' }, sql: 'ALTER TABLE "LicenseKey" ADD COLUMN "garageId" TEXT' },
  { id: '088_licensekey_garageid_idx',        sql: 'CREATE INDEX IF NOT EXISTS "LicenseKey_garageId_idx" ON "LicenseKey"("garageId")' },
  // ── Modules Premium (intégration complete-platform) : VIN, signature, notif ──
  { id: '089_vinsearch_table', sql: `CREATE TABLE IF NOT EXISTS "VinSearch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "garageId" TEXT NOT NULL,
    "vin" TEXT NOT NULL,
    "resultJson" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'offline',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VinSearch_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)` },
  { id: '090_vinsearch_idx1', sql: 'CREATE INDEX IF NOT EXISTS "VinSearch_garageId_createdAt_idx" ON "VinSearch"("garageId", "createdAt")' },
  { id: '091_vinsearch_idx2', sql: 'CREATE INDEX IF NOT EXISTS "VinSearch_garageId_vin_idx" ON "VinSearch"("garageId", "vin")' },
  { id: '092_signature_table', sql: `CREATE TABLE IF NOT EXISTS "Signature" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "signedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invalidatedAt" DATETIME,
    CONSTRAINT "Signature_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)` },
  { id: '093_signature_idx', sql: 'CREATE INDEX IF NOT EXISTS "Signature_garageId_entityType_entityId_idx" ON "Signature"("garageId", "entityType", "entityId")' },
  { id: '094_notificationlog_table', sql: `CREATE TABLE IF NOT EXISTS "NotificationLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotificationLog_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)` },
  { id: '095_notificationlog_idx1', sql: 'CREATE INDEX IF NOT EXISTS "NotificationLog_garageId_createdAt_idx" ON "NotificationLog"("garageId", "createdAt")' },
  { id: '096_notificationlog_idx2', sql: 'CREATE INDEX IF NOT EXISTS "NotificationLog_garageId_status_idx" ON "NotificationLog"("garageId", "status")' },
  // ── Enterprise (intégration enterprise-evolution) : portail client, 2FA, SAV, RDV, sauvegardes, rapports ──
  { id: '097_portaluser_table', sql: `CREATE TABLE IF NOT EXISTS "PortalUser" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "lockedUntil" DATETIME,
    "lastLoginAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PortalUser_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PortalUser_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE SET NULL ON UPDATE CASCADE
)` },
  { id: '098_portaluser_idx_garage', sql: 'CREATE INDEX IF NOT EXISTS "PortalUser_garageId_idx" ON "PortalUser"("garageId")' },
  { id: '099_portaluser_idx_client', sql: 'CREATE INDEX IF NOT EXISTS "PortalUser_clientId_idx" ON "PortalUser"("clientId")' },
  { id: '100_portaluser_unique_email', sql: 'CREATE UNIQUE INDEX IF NOT EXISTS "PortalUser_garageId_email_key" ON "PortalUser"("garageId", "email")' },
  { id: '101_portaldevice_table', sql: `CREATE TABLE IF NOT EXISTS "PortalDevice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "portalUserId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PortalDevice_portalUserId_fkey" FOREIGN KEY ("portalUserId") REFERENCES "PortalUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)` },
  { id: '102_portaldevice_unique_session', sql: 'CREATE UNIQUE INDEX IF NOT EXISTS "PortalDevice_sessionId_key" ON "PortalDevice"("sessionId")' },
  { id: '103_portaldevice_idx_user', sql: 'CREATE INDEX IF NOT EXISTS "PortalDevice_portalUserId_idx" ON "PortalDevice"("portalUserId")' },
  { id: '104_portalticket_table', sql: `CREATE TABLE IF NOT EXISTS "PortalTicket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "garageId" TEXT NOT NULL,
    "portalUserId" TEXT NOT NULL,
    "clientId" TEXT,
    "vehicleId" TEXT,
    "subject" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "status" TEXT NOT NULL DEFAULT 'open',
    "lastMessageAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PortalTicket_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PortalTicket_portalUserId_fkey" FOREIGN KEY ("portalUserId") REFERENCES "PortalUser" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)` },
  { id: '105_portalticket_idx_garage', sql: 'CREATE INDEX IF NOT EXISTS "PortalTicket_garageId_idx" ON "PortalTicket"("garageId")' },
  { id: '106_portalticket_idx_garage_status', sql: 'CREATE INDEX IF NOT EXISTS "PortalTicket_garageId_status_idx" ON "PortalTicket"("garageId", "status")' },
  { id: '107_portalticket_idx_user', sql: 'CREATE INDEX IF NOT EXISTS "PortalTicket_portalUserId_idx" ON "PortalTicket"("portalUserId")' },
  { id: '108_portalticketmessage_table', sql: `CREATE TABLE IF NOT EXISTS "PortalTicketMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ticketId" TEXT NOT NULL,
    "authorType" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "attachmentPath" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PortalTicketMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "PortalTicket" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)` },
  { id: '109_portalticketmessage_idx_ticket', sql: 'CREATE INDEX IF NOT EXISTS "PortalTicketMessage_ticketId_idx" ON "PortalTicketMessage"("ticketId")' },
  { id: '110_appointment_table', sql: `CREATE TABLE IF NOT EXISTS "Appointment" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "reminderSentAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Appointment_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)` },
  { id: '111_appointment_idx_garage', sql: 'CREATE INDEX IF NOT EXISTS "Appointment_garageId_idx" ON "Appointment"("garageId")' },
  { id: '112_appointment_idx_garage_date', sql: 'CREATE INDEX IF NOT EXISTS "Appointment_garageId_date_idx" ON "Appointment"("garageId", "date")' },
  { id: '113_appointment_idx_user', sql: 'CREATE INDEX IF NOT EXISTS "Appointment_portalUserId_idx" ON "Appointment"("portalUserId")' },
  { id: '114_backuprecord_table', sql: `CREATE TABLE IF NOT EXISTS "BackupRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "garageId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "checksum" TEXT NOT NULL,
    "algorithm" TEXT NOT NULL DEFAULT 'aes-256-gcm',
    "kdf" TEXT NOT NULL DEFAULT 'raw',
    "entityCounts" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'completed',
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BackupRecord_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)` },
  { id: '115_backuprecord_idx_garage', sql: 'CREATE INDEX IF NOT EXISTS "BackupRecord_garageId_idx" ON "BackupRecord"("garageId")' },
  { id: '116_backuprecord_idx_garage_created', sql: 'CREATE INDEX IF NOT EXISTS "BackupRecord_garageId_createdAt_idx" ON "BackupRecord"("garageId", "createdAt")' },
  { id: '117_reportsnapshot_table', sql: `CREATE TABLE IF NOT EXISTS "ReportSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "garageId" TEXT NOT NULL,
    "periodDays" INTEGER NOT NULL,
    "healthScore" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReportSnapshot_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)` },
  { id: '118_reportsnapshot_idx_garage', sql: 'CREATE INDEX IF NOT EXISTS "ReportSnapshot_garageId_idx" ON "ReportSnapshot"("garageId")' },
  { id: '119_reportsnapshot_idx_garage_created', sql: 'CREATE INDEX IF NOT EXISTS "ReportSnapshot_garageId_createdAt_idx" ON "ReportSnapshot"("garageId", "createdAt")' },
  // ── Index UNIQUE du schéma manquants sur une base réparée table-par-table ────
  // Les entrées `NNN_ensure_*_table` créent les tables SANS contrainte UNIQUE en
  // ligne ; ces migrations rétablissent les 6 contraintes d'unicité du schéma
  // (prisma/schema.prisma) avec CONTRÔLE DE DOUBLONS (voir migrate/route.ts) :
  // en présence de doublons, l'index est différé (jamais d'échec ni de perte).
  { id: '120_unique_garage_slug',              uniqueIndex: { name: 'Garage_slug_key',                  table: 'Garage',     columns: ['slug'] } },
  { id: '121_unique_user_email',               uniqueIndex: { name: 'User_email_key',                   table: 'User',       columns: ['email'] } },
  { id: '122_unique_vehicle_plate_garage',     uniqueIndex: { name: 'Vehicle_licensePlate_garageId_key', table: 'Vehicle',   columns: ['licensePlate', 'garageId'] } },
  { id: '123_unique_workorder_job',            uniqueIndex: { name: 'WorkOrder_jobId_key',              table: 'WorkOrder',  columns: ['jobId'] } },
  { id: '124_unique_licensekey_licenseid',     uniqueIndex: { name: 'LicenseKey_licenseId_key',         table: 'LicenseKey', columns: ['licenseId'] } },
  { id: '125_unique_licensekey_token',         uniqueIndex: { name: 'LicenseKey_token_key',             table: 'LicenseKey', columns: ['token'] } },

  // RepairTypePart.garageId : index pour les lectures filtrées (garageId, repairType).
  // La relation/cascade vers Garage est appliquée par `prisma db push` (schéma) ;
  // cet index couvre aussi les bases desktop existantes (SQLite ne permet pas
  // d'ajouter une FK par ALTER, mais Prisma génère la cascade au niveau client).
  { id: '126_repairtypepart_idx_garage_type', sql: 'CREATE INDEX IF NOT EXISTS "RepairTypePart_garageId_repairType_idx" ON "RepairTypePart"("garageId", "repairType")' },
  // Colonnes chaudes / clés étrangères non indexées (perf lectures + jointures).
  { id: '127_part_idx_garage', sql: 'CREATE INDEX IF NOT EXISTS "Part_garageId_idx" ON "Part"("garageId")' },
  { id: '128_jobpart_idx_job', sql: 'CREATE INDEX IF NOT EXISTS "JobPart_jobId_idx" ON "JobPart"("jobId")' },
  { id: '129_jobpart_idx_part', sql: 'CREATE INDEX IF NOT EXISTS "JobPart_partId_idx" ON "JobPart"("partId")' },

  // ── Licences MECHANIC (subordonnées à une licence Garage) ────────────────────
  // Portées depuis la branche mechanic-licenses (renumérotées 130+ pour éviter la
  // collision avec les index UNIQUE de durcissement 120-129 ci-dessus). Toutes les
  // colonnes ajoutées sont NULLABLES → migration additive sans perte sur base existante.
  { id: '130_licensekey_parent_license_id', onlyIfColumnMissing: { table: 'LicenseKey', column: 'parentLicenseId' }, sql: 'ALTER TABLE "LicenseKey" ADD COLUMN "parentLicenseId" TEXT' },
  { id: '131_licensekey_mechanic_id',       onlyIfColumnMissing: { table: 'LicenseKey', column: 'mechanicId' }, sql: 'ALTER TABLE "LicenseKey" ADD COLUMN "mechanicId" TEXT' },
  { id: '132_licensekey_mechanic_hint',     onlyIfColumnMissing: { table: 'LicenseKey', column: 'mechanicHint' }, sql: 'ALTER TABLE "LicenseKey" ADD COLUMN "mechanicHint" TEXT' },
  { id: '133_licensekey_assigned_at',       onlyIfColumnMissing: { table: 'LicenseKey', column: 'assignedAt' }, sql: 'ALTER TABLE "LicenseKey" ADD COLUMN "assignedAt" DATETIME' },
  { id: '134_licensekey_assigned_by',       onlyIfColumnMissing: { table: 'LicenseKey', column: 'assignedBy' }, sql: 'ALTER TABLE "LicenseKey" ADD COLUMN "assignedBy" TEXT' },
  { id: '135_licensekey_suspended_at',      onlyIfColumnMissing: { table: 'LicenseKey', column: 'suspendedAt' }, sql: 'ALTER TABLE "LicenseKey" ADD COLUMN "suspendedAt" DATETIME' },
  { id: '136_licensekey_parent_idx',        sql: 'CREATE INDEX IF NOT EXISTS "LicenseKey_parentLicenseId_idx" ON "LicenseKey"("parentLicenseId")' },
  { id: '137_licensekey_garage_type_idx',   sql: 'CREATE INDEX IF NOT EXISTS "LicenseKey_garageId_licenseType_idx" ON "LicenseKey"("garageId", "licenseType")' },
  { id: '138_jobphoto_mechanic_id',         onlyIfColumnMissing: { table: 'JobPhoto', column: 'mechanicId' }, sql: 'ALTER TABLE "JobPhoto" ADD COLUMN "mechanicId" TEXT' },
  // NOTE : les clauses FOREIGN KEY en ligne ci-dessous (§5) ne sont appliquées que
  // sur une base desktop NEUVE — SQLite ne permet pas d'ajouter une FK par ALTER,
  // donc une base existante conserve la table SANS FK ; les relations/cascades
  // Prisma restent effectives côté client (même principe que la migration
  // RepairTypePart 126 ci-dessus). garageId (+ jobId côté note) = CASCADE ;
  // licenseId/mechanicId/assignedBy/previousMechanicId = SET NULL (colonnes optionnelles).
  { id: '139_mechanic_license_assignment_table', sql: `CREATE TABLE IF NOT EXISTS "MechanicLicenseAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "licenseId" TEXT,
    "mechanicId" TEXT,
    "garageId" TEXT NOT NULL,
    "assignedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedBy" TEXT,
    "unassignedAt" DATETIME,
    "previousMechanicId" TEXT,
    CONSTRAINT "MechanicLicenseAssignment_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MechanicLicenseAssignment_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "LicenseKey" ("licenseId") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MechanicLicenseAssignment_mechanicId_fkey" FOREIGN KEY ("mechanicId") REFERENCES "Mechanic" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MechanicLicenseAssignment_assignedBy_fkey" FOREIGN KEY ("assignedBy") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MechanicLicenseAssignment_previousMechanicId_fkey" FOREIGN KEY ("previousMechanicId") REFERENCES "Mechanic" ("id") ON DELETE SET NULL ON UPDATE CASCADE
)` },
  { id: '140_mechanic_license_assignment_idx1', sql: 'CREATE INDEX IF NOT EXISTS "MechanicLicenseAssignment_licenseId_assignedAt_idx" ON "MechanicLicenseAssignment"("licenseId", "assignedAt")' },
  { id: '141_mechanic_license_assignment_idx2', sql: 'CREATE INDEX IF NOT EXISTS "MechanicLicenseAssignment_garageId_idx" ON "MechanicLicenseAssignment"("garageId")' },
  { id: '142_job_mechanic_note_table', sql: `CREATE TABLE IF NOT EXISTS "JobMechanicNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "garageId" TEXT NOT NULL,
    "mechanicId" TEXT,
    "licenseId" TEXT,
    "type" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JobMechanicNote_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "JobMechanicNote_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "JobMechanicNote_mechanicId_fkey" FOREIGN KEY ("mechanicId") REFERENCES "Mechanic" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "JobMechanicNote_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "LicenseKey" ("licenseId") ON DELETE SET NULL ON UPDATE CASCADE
)` },
  { id: '143_job_mechanic_note_idx1', sql: 'CREATE INDEX IF NOT EXISTS "JobMechanicNote_jobId_createdAt_idx" ON "JobMechanicNote"("jobId", "createdAt")' },
  { id: '144_job_mechanic_note_idx2', sql: 'CREATE INDEX IF NOT EXISTS "JobMechanicNote_garageId_mechanicId_idx" ON "JobMechanicNote"("garageId", "mechanicId")' },
  // MechanicActionAudit — schéma CORRIGÉ (§6) : acteur (actorUserId/actorRole) et
  // cible (targetMechanicId) séparés ; colonnes non applicables NULL, jamais ''.
  { id: '145_mechanic_action_audit_table', sql: `CREATE TABLE IF NOT EXISTS "MechanicActionAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MechanicActionAudit_garageId_fkey" FOREIGN KEY ("garageId") REFERENCES "Garage" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MechanicActionAudit_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MechanicActionAudit_targetMechanicId_fkey" FOREIGN KEY ("targetMechanicId") REFERENCES "Mechanic" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MechanicActionAudit_licenseId_fkey" FOREIGN KEY ("licenseId") REFERENCES "LicenseKey" ("licenseId") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MechanicActionAudit_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE SET NULL ON UPDATE CASCADE
)` },
  { id: '146_mechanic_action_audit_idx1', sql: 'CREATE INDEX IF NOT EXISTS "MechanicActionAudit_garageId_createdAt_idx" ON "MechanicActionAudit"("garageId", "createdAt")' },
  { id: '147_mechanic_action_audit_idx2', sql: 'CREATE INDEX IF NOT EXISTS "MechanicActionAudit_targetMechanicId_createdAt_idx" ON "MechanicActionAudit"("targetMechanicId", "createdAt")' },
  { id: '148_mechanic_action_audit_idx3', sql: 'CREATE INDEX IF NOT EXISTS "MechanicActionAudit_jobId_idx" ON "MechanicActionAudit"("jobId")' },
  { id: '149_mechanic_action_audit_idx4', sql: 'CREATE INDEX IF NOT EXISTS "MechanicActionAudit_actorUserId_createdAt_idx" ON "MechanicActionAudit"("actorUserId", "createdAt")' },
  // ── Index FK-enfant (§5) : colonnes de jointure/cascade non déjà en tête d'un
  //    index composite existant. Additifs, idempotents (IF NOT EXISTS). ─────────
  { id: '150_licensekey_mechanic_idx',           sql: 'CREATE INDEX IF NOT EXISTS "LicenseKey_mechanicId_idx" ON "LicenseKey"("mechanicId")' },
  { id: '151_licensekey_assignedby_idx',         sql: 'CREATE INDEX IF NOT EXISTS "LicenseKey_assignedBy_idx" ON "LicenseKey"("assignedBy")' },
  { id: '152_mla_mechanic_idx',                  sql: 'CREATE INDEX IF NOT EXISTS "MechanicLicenseAssignment_mechanicId_idx" ON "MechanicLicenseAssignment"("mechanicId")' },
  { id: '153_mla_assignedby_idx',                sql: 'CREATE INDEX IF NOT EXISTS "MechanicLicenseAssignment_assignedBy_idx" ON "MechanicLicenseAssignment"("assignedBy")' },
  { id: '154_mla_prevmechanic_idx',              sql: 'CREATE INDEX IF NOT EXISTS "MechanicLicenseAssignment_previousMechanicId_idx" ON "MechanicLicenseAssignment"("previousMechanicId")' },
  { id: '155_jobmechanicnote_license_idx',       sql: 'CREATE INDEX IF NOT EXISTS "JobMechanicNote_licenseId_idx" ON "JobMechanicNote"("licenseId")' },
  { id: '156_mechanic_action_audit_license_idx', sql: 'CREATE INDEX IF NOT EXISTS "MechanicActionAudit_licenseId_idx" ON "MechanicActionAudit"("licenseId")' },

  // Chrono mécanicien (§6) : secondes accumulées sur les segments terminés
  // (pause/reprise sans perte). Additif, valeur par défaut 0 sur les lignes existantes.
  { id: '157_job_timer_accumulated_sec', onlyIfColumnMissing: { table: 'Job', column: 'timerAccumulatedSec' }, sql: 'ALTER TABLE "Job" ADD COLUMN "timerAccumulatedSec" INTEGER NOT NULL DEFAULT 0' },
  // ── Migration monétaire : colonnes en CENTIMES entiers (additif, nullable) ────
  // Source de vérité écrite par l'app ; les colonnes Float existantes deviennent un
  // miroir dérivé. NULL sur les lignes antérieures → l'app lit `cents ?? toCents(float)`.
  // Voir docs/MIGRATION-MONEY.md. Aucune donnée supprimée, aucune colonne retirée.
  { id: '158_workorder_total_ht_cents',   onlyIfColumnMissing: { table: 'WorkOrder', column: 'totalHtCents' }, sql: 'ALTER TABLE "WorkOrder" ADD COLUMN "totalHtCents" INTEGER' },
  { id: '159_workorder_total_ttc_cents',  onlyIfColumnMissing: { table: 'WorkOrder', column: 'totalTtcCents' }, sql: 'ALTER TABLE "WorkOrder" ADD COLUMN "totalTtcCents" INTEGER' },
  { id: '160_purchaseorder_total_ht_cents', onlyIfColumnMissing: { table: 'PurchaseOrder', column: 'totalHtCents' }, sql: 'ALTER TABLE "PurchaseOrder" ADD COLUMN "totalHtCents" INTEGER' },
  { id: '161_loaner_deposit_amount_cents', onlyIfColumnMissing: { table: 'LoanerReservation', column: 'depositAmountCents' }, sql: 'ALTER TABLE "LoanerReservation" ADD COLUMN "depositAmountCents" INTEGER' },
  // ── MIGRATION MONÉTAIRE FINALE — COMPOSITES ATOMIQUES ──────────────────────
  // Chaque colonne = UNE migration : ADD → BACKFILL → VERIFY (bloquant) → DROP,
  // exécutée dans UNE transaction (rollback complet à la moindre erreur ; la
  // migration n'est enregistrée qu'après réussite TOTALE). Les gardes rendent
  // chaque étape idempotente : base ancienne → migre ; base neuve → no-op ;
  // relance après interruption → reprend proprement (aucun duplicate column).
  {
    id: '162_money_garage_hourlyrate',
    steps: [
      { onlyIfColumnMissing: { table: 'Garage', column: 'hourlyRateTenThousandths' }, sql: 'ALTER TABLE \"Garage\" ADD COLUMN \"hourlyRateTenThousandths\" INTEGER NOT NULL DEFAULT 600000' },
      { onlyIfColumnExists: { table: 'Garage', column: 'hourlyRate' }, sql: 'UPDATE \"Garage\" SET \"hourlyRateTenThousandths\" = CAST(ROUND(\"hourlyRate\" * 10000) AS INTEGER) WHERE \"hourlyRate\" IS NOT NULL' },
      { onlyIfColumnExists: { table: 'Garage', column: 'hourlyRate' }, verifySql: 'SELECT count(*) AS n FROM \"Garage\" WHERE (\"hourlyRate\" IS NOT NULL AND ABS(CAST(ROUND(\"hourlyRate\" * 10000) AS INTEGER) - \"hourlyRateTenThousandths\") > 0)' },
      { onlyIfColumnExists: { table: 'Garage', column: 'hourlyRate' }, sql: 'ALTER TABLE \"Garage\" DROP COLUMN \"hourlyRate\"' },
    ],
  },
  {
    id: '163_money_part_unitcost',
    steps: [
      { onlyIfColumnMissing: { table: 'Part', column: 'unitCostTenThousandths' }, sql: 'ALTER TABLE \"Part\" ADD COLUMN \"unitCostTenThousandths\" INTEGER NOT NULL DEFAULT 0' },
      { onlyIfColumnExists: { table: 'Part', column: 'unitCost' }, sql: 'UPDATE \"Part\" SET \"unitCostTenThousandths\" = CAST(ROUND(\"unitCost\" * 10000) AS INTEGER) WHERE \"unitCost\" IS NOT NULL' },
      { onlyIfColumnExists: { table: 'Part', column: 'unitCost' }, verifySql: 'SELECT count(*) AS n FROM \"Part\" WHERE (\"unitCost\" IS NOT NULL AND ABS(CAST(ROUND(\"unitCost\" * 10000) AS INTEGER) - \"unitCostTenThousandths\") > 0)' },
      { onlyIfColumnExists: { table: 'Part', column: 'unitCost' }, sql: 'ALTER TABLE \"Part\" DROP COLUMN \"unitCost\"' },
    ],
  },
  {
    id: '164_money_part_unitprice',
    steps: [
      { onlyIfColumnMissing: { table: 'Part', column: 'unitPriceTenThousandths' }, sql: 'ALTER TABLE \"Part\" ADD COLUMN \"unitPriceTenThousandths\" INTEGER NOT NULL DEFAULT 0' },
      { onlyIfColumnExists: { table: 'Part', column: 'unitPrice' }, sql: 'UPDATE \"Part\" SET \"unitPriceTenThousandths\" = CAST(ROUND(\"unitPrice\" * 10000) AS INTEGER) WHERE \"unitPrice\" IS NOT NULL' },
      { onlyIfColumnExists: { table: 'Part', column: 'unitPrice' }, verifySql: 'SELECT count(*) AS n FROM \"Part\" WHERE (\"unitPrice\" IS NOT NULL AND ABS(CAST(ROUND(\"unitPrice\" * 10000) AS INTEGER) - \"unitPriceTenThousandths\") > 0)' },
      { onlyIfColumnExists: { table: 'Part', column: 'unitPrice' }, sql: 'ALTER TABLE \"Part\" DROP COLUMN \"unitPrice\"' },
    ],
  },
  {
    id: '165_money_jobpart_unitprice',
    steps: [
      { onlyIfColumnMissing: { table: 'JobPart', column: 'unitPriceTenThousandths' }, sql: 'ALTER TABLE \"JobPart\" ADD COLUMN \"unitPriceTenThousandths\" INTEGER NOT NULL DEFAULT 0' },
      { onlyIfColumnExists: { table: 'JobPart', column: 'unitPrice' }, sql: 'UPDATE \"JobPart\" SET \"unitPriceTenThousandths\" = CAST(ROUND(\"unitPrice\" * 10000) AS INTEGER) WHERE \"unitPrice\" IS NOT NULL' },
      { onlyIfColumnExists: { table: 'JobPart', column: 'unitPrice' }, verifySql: 'SELECT count(*) AS n FROM \"JobPart\" WHERE (\"unitPrice\" IS NOT NULL AND ABS(CAST(ROUND(\"unitPrice\" * 10000) AS INTEGER) - \"unitPriceTenThousandths\") > 0)' },
      { onlyIfColumnExists: { table: 'JobPart', column: 'unitPrice' }, sql: 'ALTER TABLE \"JobPart\" DROP COLUMN \"unitPrice\"' },
    ],
  },
  {
    id: '166_money_jobpart_unitcost',
    steps: [
      { onlyIfColumnMissing: { table: 'JobPart', column: 'unitCostTenThousandths' }, sql: 'ALTER TABLE \"JobPart\" ADD COLUMN \"unitCostTenThousandths\" INTEGER NOT NULL DEFAULT 0' },
      { onlyIfColumnExists: { table: 'JobPart', column: 'unitCost' }, sql: 'UPDATE \"JobPart\" SET \"unitCostTenThousandths\" = CAST(ROUND(\"unitCost\" * 10000) AS INTEGER) WHERE \"unitCost\" IS NOT NULL' },
      { onlyIfColumnExists: { table: 'JobPart', column: 'unitCost' }, verifySql: 'SELECT count(*) AS n FROM \"JobPart\" WHERE (\"unitCost\" IS NOT NULL AND ABS(CAST(ROUND(\"unitCost\" * 10000) AS INTEGER) - \"unitCostTenThousandths\") > 0)' },
      { onlyIfColumnExists: { table: 'JobPart', column: 'unitCost' }, sql: 'ALTER TABLE \"JobPart\" DROP COLUMN \"unitCost\"' },
    ],
  },
  {
    id: '167_money_quoteline_quantity',
    steps: [
      { onlyIfColumnMissing: { table: 'QuoteLine', column: 'quantityTenThousandths' }, sql: 'ALTER TABLE \"QuoteLine\" ADD COLUMN \"quantityTenThousandths\" INTEGER NOT NULL DEFAULT 10000' },
      { onlyIfColumnExists: { table: 'QuoteLine', column: 'quantity' }, sql: 'UPDATE \"QuoteLine\" SET \"quantityTenThousandths\" = CAST(ROUND(\"quantity\" * 10000) AS INTEGER) WHERE \"quantity\" IS NOT NULL' },
      { onlyIfColumnExists: { table: 'QuoteLine', column: 'quantity' }, verifySql: 'SELECT count(*) AS n FROM \"QuoteLine\" WHERE (\"quantity\" IS NOT NULL AND ABS(CAST(ROUND(\"quantity\" * 10000) AS INTEGER) - \"quantityTenThousandths\") > 0)' },
      { onlyIfColumnExists: { table: 'QuoteLine', column: 'quantity' }, sql: 'ALTER TABLE \"QuoteLine\" DROP COLUMN \"quantity\"' },
    ],
  },
  {
    id: '168_money_quoteline_unitprice',
    steps: [
      { onlyIfColumnMissing: { table: 'QuoteLine', column: 'unitPriceTenThousandths' }, sql: 'ALTER TABLE \"QuoteLine\" ADD COLUMN \"unitPriceTenThousandths\" INTEGER NOT NULL DEFAULT 0' },
      { onlyIfColumnExists: { table: 'QuoteLine', column: 'unitPrice' }, sql: 'UPDATE \"QuoteLine\" SET \"unitPriceTenThousandths\" = CAST(ROUND(\"unitPrice\" * 10000) AS INTEGER) WHERE \"unitPrice\" IS NOT NULL' },
      { onlyIfColumnExists: { table: 'QuoteLine', column: 'unitPrice' }, verifySql: 'SELECT count(*) AS n FROM \"QuoteLine\" WHERE (\"unitPrice\" IS NOT NULL AND ABS(CAST(ROUND(\"unitPrice\" * 10000) AS INTEGER) - \"unitPriceTenThousandths\") > 0)' },
      { onlyIfColumnExists: { table: 'QuoteLine', column: 'unitPrice' }, sql: 'ALTER TABLE \"QuoteLine\" DROP COLUMN \"unitPrice\"' },
    ],
  },
  {
    id: '169_money_quoteline_unitcost',
    steps: [
      { onlyIfColumnMissing: { table: 'QuoteLine', column: 'unitCostTenThousandths' }, sql: 'ALTER TABLE \"QuoteLine\" ADD COLUMN \"unitCostTenThousandths\" INTEGER NOT NULL DEFAULT 0' },
      { onlyIfColumnExists: { table: 'QuoteLine', column: 'unitCost' }, sql: 'UPDATE \"QuoteLine\" SET \"unitCostTenThousandths\" = CAST(ROUND(\"unitCost\" * 10000) AS INTEGER) WHERE \"unitCost\" IS NOT NULL' },
      { onlyIfColumnExists: { table: 'QuoteLine', column: 'unitCost' }, verifySql: 'SELECT count(*) AS n FROM \"QuoteLine\" WHERE (\"unitCost\" IS NOT NULL AND ABS(CAST(ROUND(\"unitCost\" * 10000) AS INTEGER) - \"unitCostTenThousandths\") > 0)' },
      { onlyIfColumnExists: { table: 'QuoteLine', column: 'unitCost' }, sql: 'ALTER TABLE \"QuoteLine\" DROP COLUMN \"unitCost\"' },
    ],
  },
  {
    id: '170_money_invoiceline_quantity',
    steps: [
      { onlyIfColumnMissing: { table: 'InvoiceLine', column: 'quantityTenThousandths' }, sql: 'ALTER TABLE \"InvoiceLine\" ADD COLUMN \"quantityTenThousandths\" INTEGER NOT NULL DEFAULT 10000' },
      { onlyIfColumnExists: { table: 'InvoiceLine', column: 'quantity' }, sql: 'UPDATE \"InvoiceLine\" SET \"quantityTenThousandths\" = CAST(ROUND(\"quantity\" * 10000) AS INTEGER) WHERE \"quantity\" IS NOT NULL' },
      { onlyIfColumnExists: { table: 'InvoiceLine', column: 'quantity' }, verifySql: 'SELECT count(*) AS n FROM \"InvoiceLine\" WHERE (\"quantity\" IS NOT NULL AND ABS(CAST(ROUND(\"quantity\" * 10000) AS INTEGER) - \"quantityTenThousandths\") > 0)' },
      { onlyIfColumnExists: { table: 'InvoiceLine', column: 'quantity' }, sql: 'ALTER TABLE \"InvoiceLine\" DROP COLUMN \"quantity\"' },
    ],
  },
  {
    id: '171_money_invoiceline_unitprice',
    steps: [
      { onlyIfColumnMissing: { table: 'InvoiceLine', column: 'unitPriceTenThousandths' }, sql: 'ALTER TABLE \"InvoiceLine\" ADD COLUMN \"unitPriceTenThousandths\" INTEGER NOT NULL DEFAULT 0' },
      { onlyIfColumnExists: { table: 'InvoiceLine', column: 'unitPrice' }, sql: 'UPDATE \"InvoiceLine\" SET \"unitPriceTenThousandths\" = CAST(ROUND(\"unitPrice\" * 10000) AS INTEGER) WHERE \"unitPrice\" IS NOT NULL' },
      { onlyIfColumnExists: { table: 'InvoiceLine', column: 'unitPrice' }, verifySql: 'SELECT count(*) AS n FROM \"InvoiceLine\" WHERE (\"unitPrice\" IS NOT NULL AND ABS(CAST(ROUND(\"unitPrice\" * 10000) AS INTEGER) - \"unitPriceTenThousandths\") > 0)' },
      { onlyIfColumnExists: { table: 'InvoiceLine', column: 'unitPrice' }, sql: 'ALTER TABLE \"InvoiceLine\" DROP COLUMN \"unitPrice\"' },
    ],
  },
  {
    id: '172_money_invoiceline_unitcost',
    steps: [
      { onlyIfColumnMissing: { table: 'InvoiceLine', column: 'unitCostTenThousandths' }, sql: 'ALTER TABLE \"InvoiceLine\" ADD COLUMN \"unitCostTenThousandths\" INTEGER NOT NULL DEFAULT 0' },
      { onlyIfColumnExists: { table: 'InvoiceLine', column: 'unitCost' }, sql: 'UPDATE \"InvoiceLine\" SET \"unitCostTenThousandths\" = CAST(ROUND(\"unitCost\" * 10000) AS INTEGER) WHERE \"unitCost\" IS NOT NULL' },
      { onlyIfColumnExists: { table: 'InvoiceLine', column: 'unitCost' }, verifySql: 'SELECT count(*) AS n FROM \"InvoiceLine\" WHERE (\"unitCost\" IS NOT NULL AND ABS(CAST(ROUND(\"unitCost\" * 10000) AS INTEGER) - \"unitCostTenThousandths\") > 0)' },
      { onlyIfColumnExists: { table: 'InvoiceLine', column: 'unitCost' }, sql: 'ALTER TABLE \"InvoiceLine\" DROP COLUMN \"unitCost\"' },
    ],
  },
  {
    id: '173_money_laboroperation_unitprice',
    steps: [
      { onlyIfColumnMissing: { table: 'LaborOperation', column: 'unitPriceTenThousandths' }, sql: 'ALTER TABLE \"LaborOperation\" ADD COLUMN \"unitPriceTenThousandths\" INTEGER NOT NULL DEFAULT 0' },
      { onlyIfColumnExists: { table: 'LaborOperation', column: 'unitPrice' }, sql: 'UPDATE \"LaborOperation\" SET \"unitPriceTenThousandths\" = CAST(ROUND(\"unitPrice\" * 10000) AS INTEGER) WHERE \"unitPrice\" IS NOT NULL' },
      { onlyIfColumnExists: { table: 'LaborOperation', column: 'unitPrice' }, verifySql: 'SELECT count(*) AS n FROM \"LaborOperation\" WHERE (\"unitPrice\" IS NOT NULL AND ABS(CAST(ROUND(\"unitPrice\" * 10000) AS INTEGER) - \"unitPriceTenThousandths\") > 0)' },
      { onlyIfColumnExists: { table: 'LaborOperation', column: 'unitPrice' }, sql: 'ALTER TABLE \"LaborOperation\" DROP COLUMN \"unitPrice\"' },
    ],
  },
  {
    id: '174_money_loanerreservation_dailyrate',
    steps: [
      { onlyIfColumnMissing: { table: 'LoanerReservation', column: 'dailyRateTenThousandths' }, sql: 'ALTER TABLE \"LoanerReservation\" ADD COLUMN \"dailyRateTenThousandths\" INTEGER' },
      { onlyIfColumnExists: { table: 'LoanerReservation', column: 'dailyRate' }, sql: 'UPDATE \"LoanerReservation\" SET \"dailyRateTenThousandths\" = CASE WHEN \"dailyRate\" IS NULL THEN NULL ELSE CAST(ROUND(\"dailyRate\" * 10000) AS INTEGER) END WHERE \"dailyRateTenThousandths\" IS NULL' },
      { onlyIfColumnExists: { table: 'LoanerReservation', column: 'dailyRate' }, verifySql: 'SELECT count(*) AS n FROM \"LoanerReservation\" WHERE (\"dailyRate\" IS NOT NULL AND (\"dailyRateTenThousandths\" IS NULL OR ABS(CAST(ROUND(\"dailyRate\" * 10000) AS INTEGER) - \"dailyRateTenThousandths\") > 0))' },
      { onlyIfColumnExists: { table: 'LoanerReservation', column: 'dailyRate' }, sql: 'ALTER TABLE \"LoanerReservation\" DROP COLUMN \"dailyRate\"' },
    ],
  },
  {
    id: '175_money_loanerreservation_depositamount',
    steps: [
      { onlyIfColumnMissing: { table: 'LoanerReservation', column: 'depositAmountCents' }, sql: 'ALTER TABLE \"LoanerReservation\" ADD COLUMN \"depositAmountCents\" INTEGER' },
      { onlyIfColumnExists: { table: 'LoanerReservation', column: 'depositAmount' }, sql: 'UPDATE \"LoanerReservation\" SET \"depositAmountCents\" = CASE WHEN \"depositAmount\" IS NULL THEN NULL ELSE CAST(ROUND(\"depositAmount\" * 100) AS INTEGER) END WHERE \"depositAmountCents\" IS NULL' },
      { onlyIfColumnExists: { table: 'LoanerReservation', column: 'depositAmount' }, verifySql: 'SELECT count(*) AS n FROM \"LoanerReservation\" WHERE (\"depositAmount\" IS NOT NULL AND (\"depositAmountCents\" IS NULL OR ABS(CAST(ROUND(\"depositAmount\" * 100) AS INTEGER) - \"depositAmountCents\") > 0))' },
      { onlyIfColumnExists: { table: 'LoanerReservation', column: 'depositAmount' }, sql: 'ALTER TABLE \"LoanerReservation\" DROP COLUMN \"depositAmount\"' },
    ],
  },
  {
    id: '176_money_workorder_totalht',
    steps: [
      { onlyIfColumnMissing: { table: 'WorkOrder', column: 'totalHtCents' }, sql: 'ALTER TABLE \"WorkOrder\" ADD COLUMN \"totalHtCents\" INTEGER NOT NULL DEFAULT 0' },
      { onlyIfColumnExists: { table: 'WorkOrder', column: 'totalHT' }, sql: 'UPDATE \"WorkOrder\" SET \"totalHtCents\" = CAST(ROUND(\"totalHT\" * 100) AS INTEGER) WHERE \"totalHT\" IS NOT NULL' },
      { onlyIfColumnExists: { table: 'WorkOrder', column: 'totalHT' }, verifySql: 'SELECT count(*) AS n FROM \"WorkOrder\" WHERE (\"totalHT\" IS NOT NULL AND ABS(CAST(ROUND(\"totalHT\" * 100) AS INTEGER) - \"totalHtCents\") > 0)' },
      { onlyIfColumnExists: { table: 'WorkOrder', column: 'totalHT' }, sql: 'ALTER TABLE \"WorkOrder\" DROP COLUMN \"totalHT\"' },
    ],
  },
  {
    id: '177_money_workorder_totalttc',
    steps: [
      { onlyIfColumnMissing: { table: 'WorkOrder', column: 'totalTtcCents' }, sql: 'ALTER TABLE \"WorkOrder\" ADD COLUMN \"totalTtcCents\" INTEGER NOT NULL DEFAULT 0' },
      { onlyIfColumnExists: { table: 'WorkOrder', column: 'totalTTC' }, sql: 'UPDATE \"WorkOrder\" SET \"totalTtcCents\" = CAST(ROUND(\"totalTTC\" * 100) AS INTEGER) WHERE \"totalTTC\" IS NOT NULL' },
      { onlyIfColumnExists: { table: 'WorkOrder', column: 'totalTTC' }, verifySql: 'SELECT count(*) AS n FROM \"WorkOrder\" WHERE (\"totalTTC\" IS NOT NULL AND ABS(CAST(ROUND(\"totalTTC\" * 100) AS INTEGER) - \"totalTtcCents\") > 0)' },
      { onlyIfColumnExists: { table: 'WorkOrder', column: 'totalTTC' }, sql: 'ALTER TABLE \"WorkOrder\" DROP COLUMN \"totalTTC\"' },
    ],
  },
  {
    id: '178_money_purchaseorder_totalht',
    steps: [
      { onlyIfColumnMissing: { table: 'PurchaseOrder', column: 'totalHtCents' }, sql: 'ALTER TABLE \"PurchaseOrder\" ADD COLUMN \"totalHtCents\" INTEGER NOT NULL DEFAULT 0' },
      { onlyIfColumnExists: { table: 'PurchaseOrder', column: 'totalHT' }, sql: 'UPDATE \"PurchaseOrder\" SET \"totalHtCents\" = CAST(ROUND(\"totalHT\" * 100) AS INTEGER) WHERE \"totalHT\" IS NOT NULL' },
      { onlyIfColumnExists: { table: 'PurchaseOrder', column: 'totalHT' }, verifySql: 'SELECT count(*) AS n FROM \"PurchaseOrder\" WHERE (\"totalHT\" IS NOT NULL AND ABS(CAST(ROUND(\"totalHT\" * 100) AS INTEGER) - \"totalHtCents\") > 0)' },
      { onlyIfColumnExists: { table: 'PurchaseOrder', column: 'totalHT' }, sql: 'ALTER TABLE \"PurchaseOrder\" DROP COLUMN \"totalHT\"' },
    ],
  },
  // JSON monétaires persistés v1 (euros flottants) → v2 (entiers exacts).
  // Code dans /api/internal/migrate : ordres SIGNÉS exclus (JSON gelé par la
  // signature), totaux re-vérifiés, transactionnel, enregistré après réussite.
  { id: '179_money_json_v2', kind: 'json-v2' },

  // ── Index de clés étrangères sur tables chaudes (perf) ───────────────────────
  // Ces tables sont interrogées/écrites par leur FK (ex. InvoiceLine par
  // invoiceId lors du remplacement des lignes, JobPhoto par jobId/garageId).
  // Sans index, ce sont des balayages complets qui se dégradent avec le volume.
  // Additif et idempotent (IF NOT EXISTS) ; réversible par DROP INDEX.
  { id: '180_quoteline_idx_quote',       sql: 'CREATE INDEX IF NOT EXISTS "QuoteLine_quoteId_idx" ON "QuoteLine"("quoteId")' },
  { id: '181_invoiceline_idx_invoice',   sql: 'CREATE INDEX IF NOT EXISTS "InvoiceLine_invoiceId_idx" ON "InvoiceLine"("invoiceId")' },
  { id: '182_jobphoto_idx_job',          sql: 'CREATE INDEX IF NOT EXISTS "JobPhoto_jobId_idx" ON "JobPhoto"("jobId")' },
  { id: '183_jobphoto_idx_garage',       sql: 'CREATE INDEX IF NOT EXISTS "JobPhoto_garageId_idx" ON "JobPhoto"("garageId")' },
  { id: '184_inspectionitem_idx_insp',   sql: 'CREATE INDEX IF NOT EXISTS "InspectionItem_inspectionId_idx" ON "InspectionItem"("inspectionId")' },

  // ── Rattrapage : colonne oubliée par une migration « ensure table » ──────────
  // `054_ensure_vehicle_table` crée Vehicle avec `CREATE TABLE IF NOT EXISTS` en
  // incluant "ctDate". Sur toute base où Vehicle EXISTAIT DÉJÀ sans cette colonne,
  // l'instruction entière est un NO-OP silencieux : la colonne n'a jamais été
  // ajoutée, et aucune migration ADD COLUMN ne la rattrapait.
  // Conséquence mesurée sur la base de production de l'opérateur :
  //   GET /api/vehicles → 500 INTERNAL_ERROR
  //   Invalid `prisma.vehicle.findMany()` : The column `main.Vehicle.ctDate`
  //   does not exist in the current database.
  // La recherche par plaque, la fiche véhicule et les alertes de contrôle
  // technique étaient donc TOTALEMENT hors service, sans message exploitable.
  // ATTENTION, PIÈGE GÉNÉRAL : toute colonne ajoutée plus tard à un
  // `CREATE TABLE IF NOT EXISTS` n'atteint QUE les bases neuves. Sur les bases
  // déjà en service, il faut TOUJOURS une migration ADD COLUMN dédiée en fin de
  // liste. Régression couverte par
  // src/lib/__tests__/migrations-vehicle-ctdate.test.ts, qui rejoue la séquence
  // sur une base portant l'ANCIENNE forme de Vehicle.
  { id: '185_vehicle_ct_date',           onlyIfColumnMissing: { table: 'Vehicle', column: 'ctDate' }, sql: 'ALTER TABLE "Vehicle" ADD COLUMN "ctDate" TEXT' },
]
