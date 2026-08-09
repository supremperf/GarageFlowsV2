/**
 * Zod validation schemas for all API request bodies.
 * Import the schema you need and call .safeParse(body) in your API route.
 */

import { z } from 'zod'
import { parseAmountToScaled } from '@/lib/money'

// ─── Shared primitives ────────────────────────────────────────────────────────

const phone   = z.string().max(30).optional().nullable()
/**
 * E-mail FACULTATIF. `.optional().nullable()` accepte `undefined` et `null`,
 * mais PAS la chaîne vide — or c'est exactement ce qu'un formulaire HTML envoie
 * pour un champ laissé vide. Résultat constaté en test réel : enregistrer une
 * facture sans e-mail client renvoyait
 *   400 {"fieldErrors":{"clientEmail":["Email invalide"]}}
 * alors que le champ n'est pas marqué requis dans l'interface. Un client de
 * passage n'a souvent pas d'e-mail : la facture devenait impossible à créer.
 *
 * On normalise donc « vide ou espaces » en `null` AVANT de valider. Un e-mail
 * réellement saisi reste vérifié à l'identique. Le seul e-mail OBLIGATOIRE du
 * schéma (compte utilisateur) a son propre validateur et n'est pas concerné.
 */
const email = z.preprocess(
  v => (typeof v === 'string' && v.trim() === '' ? null : v),
  z.string().email('Email invalide').max(255).optional().nullable(),
)
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

/**
 * Validation STRICTE d'un montant/quantité saisi en euros/unités :
 * fini (NaN/Infinity refusés), borné, et 4 DÉCIMALES MAXIMUM — la valeur est
 * ensuite convertie sans perte vers l'entier exact en dix-millièmes
 * (`parseAmountToScaled`). Aucune décimale n'est silencieusement tronquée.
 */
const max4Decimals = (v: number) => parseAmountToScaled(v) !== null
const MAX4_MSG = { message: 'Maximum 4 décimales' }

const InvoiceLineSchema = z.object({
  description: z.string().min(1).max(500),
  quantity:    z.number().finite().min(0.01).max(9999).refine(max4Decimals, MAX4_MSG),
  unitPrice:   z.number().finite().min(0).max(999_999).refine(max4Decimals, MAX4_MSG),
  unitCost:    z.number().finite().min(0).max(999_999).refine(max4Decimals, MAX4_MSG).optional(),
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

// `specialty` : le client envoie un TABLEAU de chaînes (['freins', …]) ; on
// tolère aussi une chaîne JSON déjà sérialisée (rétro-compat / clients tiers).
// La route normalise ensuite via normalizeSpecialty() avant l'écriture en base.
// avatar : dérivé du nom côté serveur s'il n'est pas fourni (donc optionnel ici).
// La chaîne acceptée doit être un TABLEAU JSON, pas un libellé nu : côté
// écriture, `normalizeSpecialty` ne conserve que du JSON de tableau et renvoie
// `[]` pour tout le reste — délibérément, pour ne jamais faire lever la lecture
// d'une ligne corrompue (cf. specialty.ts). Sans ce contrôle, `specialty:
// 'Moteur'` était ACCEPTÉ en 201 puis stocké vide : la spécialité disparaissait
// sans message. Mieux vaut un refus explicite qu'un enregistrement muet.
const jsonArrayOfStrings = z.string().max(2000).refine((s) => {
  try {
    const parsed = JSON.parse(s)
    return Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')
  } catch { return false }
}, { message: 'Spécialité : tableau attendu (ex. ["Moteur","Freins"]) ou tableau JSON sérialisé' })

const SpecialtyInput = z.union([z.array(z.string().max(60)).max(50), jsonArrayOfStrings]).optional()

export const CreateMechanicSchema = z.object({
  name:      z.string().min(1, 'Nom requis').max(100),
  avatar:    z.string().min(1).max(10).optional(),
  color:     z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Couleur hex invalide'),
  specialty: SpecialtyInput,
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
  hourlyRate:        z.number().finite().min(0).max(9999).refine(max4Decimals, MAX4_MSG).optional(),
  onboardingComplete: z.boolean().optional(),
  logoBase64:        z.string().max(6_000_000, 'Logo trop volumineux').optional().nullable(),
  smsPhone:          phone,
  // Réglages d'atelier et de documents — présents dans le handler depuis
  // toujours, absents de ce schéma : ils passaient donc sans aucun contrôle.
  workshopStartHour: z.number().int().min(0).max(23).optional(),
  workshopEndHour:   z.number().int().min(1).max(24).optional(),
  workOrderPrefix:      z.string().min(1).max(10).optional(),
  purchaseOrderPrefix:  z.string().min(1).max(10).optional(),
  warrantyMonthsDefault: z.number().int().min(0).max(120).optional(),
  smartReminderMonths:   z.number().int().min(0).max(60).optional(),
  loanerEnabled:         z.boolean().optional(),
}).refine(
  (g) => g.workshopStartHour === undefined || g.workshopEndHour === undefined || g.workshopEndHour > g.workshopStartHour,
  { message: "L'heure de fermeture doit suivre l'heure d'ouverture", path: ['workshopEndHour'] },
)

// ─── Part ─────────────────────────────────────────────────────────────────────

export const CreatePartSchema = z.object({
  reference:   z.string().max(50).optional().nullable(),
  name:        z.string().min(1, 'Nom requis').max(200),
  description: z.string().max(500).optional().nullable(),
  quantity:    z.number().int().min(0).optional(),
  minQuantity: z.number().int().min(0).optional(),
  unitCost:    z.number().finite().min(0).max(999_999).refine(max4Decimals, MAX4_MSG).optional(),
  unitPrice:   z.number().finite().min(0).max(999_999).refine(max4Decimals, MAX4_MSG).optional(),
  location:    z.string().max(100).optional().nullable(),
})

export const UpdatePartSchema = CreatePartSchema.partial()

// ─── Pagination helper ────────────────────────────────────────────────────────

export const PaginationSchema = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})
