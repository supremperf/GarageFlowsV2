/**
 * Zod validation schemas for all API request bodies.
 * Import the schema you need and call .safeParse(body) in your API route.
 */

import { z } from 'zod'

// ─── Shared primitives ────────────────────────────────────────────────────────

const phone   = z.string().max(30).optional().nullable()
const email   = z.string().email('Email invalide').max(255).optional().nullable()
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format date invalide (YYYY-MM-DD)')

// ─── Job ──────────────────────────────────────────────────────────────────────

export const CreateJobSchema = z.object({
  customerName:      z.string().min(1, 'Nom client requis').max(200),
  vehicleModel:      z.string().min(1, 'Modèle requis').max(200),
  licensePlate:      z.string().max(20).optional().nullable(),
  repairType:        z.string().min(1, 'Type requis').max(100),
  estimatedDuration: z.number().int().min(1).max(1440),
  startTime:         z.string().regex(/^\d{2}:\d{2}$/, 'Format heure invalide (HH:MM)'),
  date:              dateStr,
  mechanicId:        z.string().min(1, 'Mécanicien requis'),
  // Aligné sur le canon JobStatus (src/lib/types.ts) et la base : 'completed' et
  // 'delayed' sont les valeurs réelles ; 'done' (jamais utilisé ailleurs) faisait
  // rejeter en 400 les transitions completed/delayed émises par l'UI et l'assistant.
  status:            z.enum(['scheduled', 'in_progress', 'awaiting_validation', 'completed', 'delayed', 'cancelled']).optional(),
  notes:             z.string().max(2000).optional().nullable(),
  isUrgent:          z.boolean().optional(),
  vehicleId:         z.string().optional().nullable(),
})

export const UpdateJobSchema = CreateJobSchema.partial().extend({
  delayMinutes:  z.number().int().min(0).optional().nullable(),
  mileageAtVisit: z.number().int().min(0).max(9_999_999).optional().nullable(),
  actualDuration: z.number().int().min(0).optional().nullable(),
})

// ─── Client ───────────────────────────────────────────────────────────────────

export const CreateClientSchema = z.object({
  name:    z.string().min(1, 'Nom requis').max(200),
  phone,
  email,
  address: z.string().max(500).optional().nullable(),
})

export const UpdateClientSchema = CreateClientSchema.partial()

// ─── Vehicle ──────────────────────────────────────────────────────────────────

export const CreateVehicleSchema = z.object({
  licensePlate: z.string().min(1, 'Plaque requise').max(20),
  vin:          z.string().max(17).optional().nullable(),
  make:         z.string().min(1, 'Marque requise').max(100),
  model:        z.string().min(1, 'Modèle requis').max(100),
  year:         z.number().int().min(1900).max(new Date().getFullYear() + 1).optional().nullable(),
  mileage:      z.number().int().min(0).max(9_999_999).optional().nullable(),
  color:        z.string().max(50).optional().nullable(),
  notes:        z.string().max(2000).optional().nullable(),
  clientId:     z.string().min(1, 'Client requis'),
  ctDate:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
})

export const UpdateVehicleSchema = CreateVehicleSchema.partial()

// ─── Invoice ──────────────────────────────────────────────────────────────────

const InvoiceLineSchema = z.object({
  description: z.string().min(1).max(500),
  quantity:    z.number().min(0.01).max(9999),
  unitPrice:   z.number().min(0).max(999_999),
  unitCost:    z.number().min(0).max(999_999).optional(),
  isLabor:     z.boolean().optional(),
  sortOrder:   z.number().int().optional(),
})

export const CreateInvoiceSchema = z.object({
  clientId:     z.string().optional().nullable(),
  vehicleId:    z.string().optional().nullable(),
  jobId:        z.string().optional().nullable(),
  clientName:   z.string().max(200).optional(),
  clientEmail:  email,
  clientPhone:  phone,
  clientAddress: z.string().max(500).optional().nullable(),
  vehicleModel: z.string().max(200).optional().nullable(),
  licensePlate: z.string().max(20).optional().nullable(),
  issueDate:    dateStr.optional(),
  dueDate:      dateStr.optional().nullable(),
  notes:        z.string().max(2000).optional().nullable(),
  taxRate:      z.number().min(0).max(100).optional(),
  lines:        z.array(InvoiceLineSchema).optional(),
})

export const UpdateInvoiceSchema = z.object({
  status:    z.enum(['draft', 'sent', 'paid', 'overdue']).optional(),
  dueDate:   dateStr.optional().nullable(),
  notes:     z.string().max(2000).optional().nullable(),
  lines:     z.array(InvoiceLineSchema).optional(),
  clientName:    z.string().max(200).optional(),
  clientEmail:   email,
  clientPhone:   phone,
  clientAddress: z.string().max(500).optional().nullable(),
  taxRate:   z.number().min(0).max(100).optional(),
})

// ─── Quote ────────────────────────────────────────────────────────────────────

export const CreateQuoteSchema = z.object({
  clientId:      z.string().optional().nullable(),
  vehicleId:     z.string().optional().nullable(),
  jobId:         z.string().optional().nullable(),
  clientName:    z.string().max(200).optional(),
  clientEmail:   email,
  clientPhone:   phone,
  clientAddress: z.string().max(500).optional().nullable(),
  vehicleModel:  z.string().max(200).optional().nullable(),
  licensePlate:  z.string().max(20).optional().nullable(),
  issueDate:     dateStr.optional(),
  validUntil:    dateStr.optional().nullable(),
  notes:         z.string().max(2000).optional().nullable(),
  taxRate:       z.number().min(0).max(100).optional(),
  lines:         z.array(InvoiceLineSchema).optional(),
})

export const UpdateQuoteSchema = z.object({
  status:       z.enum(['draft', 'sent', 'accepted', 'refused', 'converted']).optional(),
  validUntil:   dateStr.optional().nullable(),
  notes:        z.string().max(2000).optional().nullable(),
  lines:        z.array(InvoiceLineSchema).optional(),
  clientName:   z.string().max(200).optional(),
  clientEmail:  email,
  clientPhone:  phone,
  taxRate:      z.number().min(0).max(100).optional(),
})

// ─── User ─────────────────────────────────────────────────────────────────────

const VALID_ROLES = ['OWNER', 'MANAGER', 'MECHANIC', 'RECEPTIONIST', 'VIEWER'] as const
export type UserRole = typeof VALID_ROLES[number]

export const CreateUserSchema = z.object({
  name:     z.string().min(1, 'Nom requis').max(100),
  email:    z.string().email('Email invalide').max(255),
  password: z.string().min(8, 'Minimum 8 caractères').max(128),
  role:     z.enum(VALID_ROLES).optional(),
})

export const UpdateUserSchema = z.object({
  name:     z.string().min(1).max(100).optional(),
  role:     z.enum(VALID_ROLES).optional(),
  password: z.string().min(8).max(128).optional(),
})

// ─── Mechanic ─────────────────────────────────────────────────────────────────

export const CreateMechanicSchema = z.object({
  name:      z.string().min(1, 'Nom requis').max(100),
  avatar:    z.string().min(1).max(10),
  color:     z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Couleur hex invalide'),
  specialty: z.string().optional(),
  order:     z.number().int().min(0).optional(),
})

// ─── Garage settings ──────────────────────────────────────────────────────────

export const UpdateGarageSchema = z.object({
  name:              z.string().min(1).max(200).optional(),
  address:           z.string().max(500).optional().nullable(),
  phone,
  email,
  website:           z.string().url().max(255).optional().nullable(),
  siret:             z.string().max(20).optional().nullable(),
  vatNumber:         z.string().max(30).optional().nullable(),
  taxRate:           z.number().min(0).max(100).optional(),
  iban:              z.string().max(34).optional().nullable(),
  bic:               z.string().max(11).optional().nullable(),
  bankName:          z.string().max(100).optional().nullable(),
  currency:          z.string().length(3).optional(),
  paymentTerms:      z.string().max(100).optional().nullable(),
  invoicePrefix:     z.string().min(1).max(10).optional(),
  quotePrefix:       z.string().min(1).max(10).optional(),
  invoiceFooter:     z.string().max(1000).optional().nullable(),
  language:          z.string().length(2).optional(),
  hourlyRate:        z.number().min(0).max(9999).optional(),
  onboardingComplete: z.boolean().optional(),
  logoBase64:        z.string().max(6_000_000, 'Logo trop volumineux').optional().nullable(),
  smsPhone:          phone,
})

// ─── Part ─────────────────────────────────────────────────────────────────────

export const CreatePartSchema = z.object({
  reference:   z.string().max(50).optional().nullable(),
  name:        z.string().min(1, 'Nom requis').max(200),
  description: z.string().max(500).optional().nullable(),
  quantity:    z.number().int().min(0).optional(),
  minQuantity: z.number().int().min(0).optional(),
  unitCost:    z.number().min(0).max(999_999).optional(),
  unitPrice:   z.number().min(0).max(999_999).optional(),
  location:    z.string().max(100).optional().nullable(),
})

export const UpdatePartSchema = CreatePartSchema.partial()

// ─── Pagination helper ────────────────────────────────────────────────────────

export const PaginationSchema = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})
