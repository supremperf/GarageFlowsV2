-- Migration: add recordMac column to LicenseKey for DB integrity protection
-- This column stores a HMAC-SHA256 over security-critical fields (licenseId, token, status, expiryAt, hwid)
-- to detect SQLite tampering. Nullable for backward compatibility with existing records.

ALTER TABLE "LicenseKey" ADD COLUMN "recordMac" TEXT;
