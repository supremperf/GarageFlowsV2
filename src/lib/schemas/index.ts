/**
 * Zod validation schemas for all API request bodies.
 * Import the schema you need and call .safeParse(body) in your API route.
 */

import { z } from 'zod'
import { parseAmountToScaled } from '@/lib/money'
import { verifierIban, verifierBic } from '@/lib/banque/iban'

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
/**
 * ADRESSE WEB FACULTATIVE — même leçon que ci-dessus, non appliquée (GF-010).
 *
 * `z.string().url()` refuse la chaîne vide. Or l'écran des réglages charge
 * `website: data.website ?? ''` puis renvoie TOUT son état à chaque
 * enregistrement : un garage sans site web envoyait donc `website: ''` et
 * `PATCH /api/garages` répondait 400 « Réglages invalides ». Conséquence : ce
 * garage ne pouvait enregistrer AUCUN réglage — ni son adresse, ni son taux de
 * TVA, ni ses coordonnées bancaires — et l'écran ne disait pas quel champ était
 * en cause. Un site web est facultatif ; ne pas en avoir ne doit pas bloquer le
 * reste du formulaire.
 *
 * Une adresse réellement saisie reste vérifiée à l'identique.
 */
const urlFacultative = z.preprocess(
  v => (typeof v === 'string' && v.trim() === '' ? null : v),
  z.string().url('Adresse web invalide').max(255).optional().nullable(),
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
  // Pièce du STOCK choisie via l'autocomplétion. Absent/null = main-d'œuvre,
  // prestation ou ligne libre : la ligne n'impacte alors jamais l'inventaire.
  // L'appartenance de la pièce au garage est revérifiée côté serveur (anti-IDOR) :
  // la présence de ce champ ne suffit jamais à engager du stock.
  partId:      z.string().min(1).max(64).optional().nullable(),
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
  // « cancelled » : annulation d'une facture émise. La facture est CONSERVÉE
  // (série séquentielle, FEC) mais son stock est restitué — cf.
  // lib/stock/invoice-stock.ts `releaseInvoiceStock`.
  status:    z.enum(['draft', 'sent', 'paid', 'overdue', 'cancelled']).optional(),
  dueDate:   dateStr.optional().nullable(),
  notes:     z.string().max(2000).optional().nullable(),
  lines:     z.array(InvoiceLineSchema).optional(),
  clientName:    z.string().max(200).optional(),
  clientEmail:   email,
  clientPhone:   phone,
  clientAddress: z.string().max(500).optional().nullable(),
  // `vehicleModel` et `licensePlate` étaient ÉCRITS par la route sans figurer
  // ici : la promesse « toute écriture passe par un schéma » était fausse pour
  // ces deux champs, qui partaient donc en base sans borne de longueur
  // (GF31-AUD-046).
  vehicleModel:  z.string().max(200).optional().nullable(),
  licensePlate:  z.string().max(20).optional().nullable(),
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
  website:           urlFacultative,
  siret:             z.string().max(20).optional().nullable(),
  vatNumber:         z.string().max(30).optional().nullable(),
  taxRate:           z.number().min(0).max(100).optional(),
  // ── IBAN et BIC : vérifiés, pas seulement bornés en longueur (GF-023) ──────
  // `max(34)` / `max(11)` laissaient passer un IBAN amputé d'un chiffre ou un
  // BIC de six lettres — enregistrés, puis IMPRIMÉS au pied de chaque facture.
  // La clé de contrôle ISO 13616 se vérifie hors ligne et détecte une faute de
  // frappe avec une probabilité de 1/97 : il n'y avait aucune raison de s'en
  // priver. Un champ VIDE reste accepté (les coordonnées sont facultatives).
  iban: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().max(42).refine(
      (v) => verifierIban(v).valide,
      'IBAN invalide — vérifiez la saisie (la clé de contrôle ne correspond pas).',
    ).optional().nullable(),
  ),
  bic: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().max(15).refine(
      (v) => verifierBic(v).valide,
      'BIC invalide — 8 ou 11 caractères (ex. BNPAFRPP).',
    ).optional().nullable(),
  ),
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
  // Granularité DEMI-HEURE (GF-021) : seules 0 et 30 sont acceptées. Autoriser
  // n'importe quelle minute donnerait des grilles de planning aux lignes
  // irrégulières, sans que rien ne le demande.
  workshopStartMinute: z.number().int().refine((m) => m === 0 || m === 30, 'Minutes : 0 ou 30').optional(),
  workshopEndMinute:   z.number().int().refine((m) => m === 0 || m === 30, 'Minutes : 0 ou 30').optional(),
  workOrderPrefix:      z.string().min(1).max(10).optional(),
  purchaseOrderPrefix:  z.string().min(1).max(10).optional(),
  warrantyMonthsDefault: z.number().int().min(0).max(120).optional(),
  smartReminderMonths:   z.number().int().min(0).max(60).optional(),
  loanerEnabled:         z.boolean().optional(),
}).refine(
  (g) => {
    // La comparaison portait sur les seules HEURES : « 8 h 30 → 8 h 00 » passait,
    // puisque 8 n'est pas supérieur à 8. On compare les bornes complètes.
    if (g.workshopStartHour === undefined || g.workshopEndHour === undefined) return true
    const debut = g.workshopStartHour * 60 + (g.workshopStartMinute ?? 0)
    const fin = g.workshopEndHour * 60 + (g.workshopEndMinute ?? 0)
    return fin > debut
  },
  { message: "L'heure de fermeture doit suivre l'heure d'ouverture", path: ['workshopEndHour'] },
).refine(
  (g) => {
    // Une amplitude d'une demi-heure n'est pas une journée d'atelier : c'est
    // presque toujours une saisie inversée ou incomplète.
    if (g.workshopStartHour === undefined || g.workshopEndHour === undefined) return true
    const debut = g.workshopStartHour * 60 + (g.workshopStartMinute ?? 0)
    const fin = g.workshopEndHour * 60 + (g.workshopEndMinute ?? 0)
    return fin - debut >= 60
  },
  { message: "L'atelier doit rester ouvert au moins une heure", path: ['workshopEndHour'] },
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
  /**
   * Fournisseur associé à la pièce et référence SKU chez ce fournisseur.
   * Ces valeurs sont des métadonnées saisies par le garage : elles ne constituent
   * ni un prix actuel, ni une preuve de disponibilité ou de délai. Tant qu'aucun
   * connecteur réel n'est configuré, elles ne déclenchent aucune commande auto.
   */
  supplierName: z.string().max(120).optional().nullable(),
  supplierRef:  z.string().max(80).optional().nullable(),
})

export const UpdatePartSchema = CreatePartSchema.partial().extend({
  /**
   * Quantité OBSERVÉE par l'appelant au moment où il a préparé sa correction.
   * Obligatoire dès que `quantity` est fourni : l'écriture n'est appliquée que
   * si le stock vaut encore cette valeur, sinon 409. Sans elle, une correction
   * d'inventaire écrasait en silence une vente concurrente (mise à jour perdue).
   */
  expectedQuantity: z.number().int().min(0).optional(),
})

// ─── Véhicules de prêt ────────────────────────────────────────────────────────

/**
 * Les quatre états d'un prêt. La colonne est un `String` libre côté Prisma, et
 * son commentaire de modèle énumère déjà ces quatre valeurs — mais rien ne les
 * imposait à l'écriture : `PATCH /api/loaner-reservations/[id]` recopiait
 * `body.status` verbatim. Un statut hors énumération (« en cours », « actif »)
 * faisait disparaître le prêt de TOUTES les vues et de TOUS les garde-fous, qui
 * filtrent sur `['reserved','active']` : planning, fiche véhicule, détection de
 * chevauchement, et refus de supprimer un véhicule encore prêté.
 */
export const LOANER_STATUSES = ['reserved', 'active', 'returned', 'cancelled'] as const
export type LoanerStatus = typeof LOANER_STATUSES[number]

/** Date-heure réellement interprétable — refuse ce qui deviendrait `Invalid Date`. */
const dateTimeStr = z
  .string()
  .min(1, 'Date requise')
  .refine((v) => !Number.isNaN(new Date(v).getTime()), 'Date invalide')

/**
 * Montant saisi (nombre OU chaîne de formulaire) → entier EXACT dans l'unité de
 * stockage. On passe par `parseAmountToScaled`, seul parseur borné du projet :
 * il refuse le non-numérique, la notation exponentielle, les décimales en trop,
 * le négatif, et surtout tout dépassement de `MAX_SCALED` (colonnes Int 32 bits).
 *
 * Le repli `toScaled(NaN) = 0` — défensif et légitime DANS la couche monétaire —
 * enregistrait ici un tarif et une caution à **0 €** sans le moindre message :
 * recette et garantie financière perdues en silence.
 */
const montantEntier = (unite: 'dixMillièmes' | 'centimes') =>
  z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : v),
    z
      .union([z.number(), z.string()])
      .transform((v, ctx) => {
        const maxDecimals = unite === 'centimes' ? 2 : 4
        const scaled = parseAmountToScaled(v, { maxDecimals, allowNegative: false })
        if (scaled === null) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Montant invalide' })
          return z.NEVER
        }
        // `parseAmountToScaled` rend des dix-millièmes ; avec 2 décimales au plus,
        // la division par 100 est exacte (le reste est nécessairement nul).
        return unite === 'centimes' ? scaled / 100 : scaled
      })
      .optional(),
  )

/** Kilométrage : entier positif, jamais `Number('abc') = NaN` persisté. */
const kilometrage = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : v),
  z.coerce.number().int().min(0).max(9_999_999).optional(),
)

export const CreateLoanerReservationSchema = z.object({
  vehicleId:    z.string().min(1, 'vehicleId requis'),
  jobId:        z.string().min(1).optional().nullable(),
  clientName:   z.string().trim().min(1, 'clientName requis').max(200),
  clientPhone:  phone,
  startDate:    dateTimeStr,
  endDate:      dateTimeStr,
  mileageOut:   kilometrage,
  conditionOut: z.string().max(2000).optional().nullable(),
  notes:        z.string().max(2000).optional().nullable(),
  isPaid:       z.boolean().optional(),
  dailyRate:      montantEntier('dixMillièmes'),
  depositAmount:  montantEntier('centimes'),
})

export const UpdateLoanerReservationSchema = z.object({
  status:       z.enum(LOANER_STATUSES).optional(),
  clientName:   z.string().trim().min(1).max(200).optional(),
  clientPhone:  phone,
  startDate:    dateTimeStr.optional(),
  endDate:      dateTimeStr.optional(),
  mileageOut:   kilometrage,
  mileageIn:    kilometrage,
  conditionOut: z.string().max(2000).optional().nullable(),
  conditionIn:  z.string().max(2000).optional().nullable(),
  notes:        z.string().max(2000).optional().nullable(),
  isPaid:       z.boolean().optional(),
  dailyRate:      montantEntier('dixMillièmes'),
  depositAmount:  montantEntier('centimes'),
})

// ─── Rendez-vous ──────────────────────────────────────────────────────────────

/**
 * Modification d'un rendez-vous PAR LE GARAGE (GF-DUR-054).
 *
 * Le panneau d'origine ne savait que faire avancer un statut (confirmer,
 * terminer, annuler). Déplacer un rendez-vous — le cas le plus courant quand un
 * client rappelle, ou qu'un pont est occupé — était impossible, alors que la
 * table le permet depuis toujours. Le garage notait la nouvelle heure sur un
 * papier, et le planning de l'atelier gardait l'ancienne.
 *
 * Le STATUT ne figure volontairement PAS ici : il suit la machine à états
 * (`requested → confirmed → completed`, annulation depuis les deux premiers),
 * exposée par `POST /api/appointments/[id]`. Deux routes concurrentes pour la
 * même transition, c'est la garantie d'en perdre une.
 */
export const UpdateAppointmentSchema = z.object({
  clientName:   z.string().trim().min(1).max(200).optional(),
  vehicleModel: z.string().trim().max(200).optional().nullable(),
  licensePlate: z.string().trim().max(20).optional().nullable(),
  reason:       z.string().trim().min(1, 'Motif requis').max(500).optional(),
  date:         dateStr.optional(),
  startTime:    z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Format heure invalide (HH:MM)').optional(),
  durationMin:  z.number().int().min(15).max(600).optional(),
  notes:        z.string().max(2000).optional().nullable(),
  // Rattachement aux FICHES. Sur les rendez-vous venus de l'espace client, les
  // identifiants sont déjà renseignés ; sur les autres, le garage peut lier une
  // fiche à la main (le tableau de bord le propose).
  clientId:     z.string().max(64).optional().nullable(),
  vehicleId:    z.string().max(64).optional().nullable(),
})

// ─── Pagination helper ────────────────────────────────────────────────────────

export const PaginationSchema = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})
