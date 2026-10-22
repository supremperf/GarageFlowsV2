export type RepairType =
  | 'oil_change'
  | 'brake_pads'
  | 'brake_discs'
  | 'distribution'
  | 'diagnostics'
  | 'tire_change'
  | 'tire_repair'
  | 'battery'
  | 'bulb'
  | 'suspension'
  | 'exhaust'
  | 'clutch'
  | 'air_conditioning'
  | 'revision'
  | 'inspection'
  | 'bodywork'
  | 'custom'

export type JobStatus =
  | 'scheduled'
  | 'in_progress'
  | 'awaiting_validation' // mécanicien a terminé (chrono arrêté) — en attente de validation du responsable
  | 'completed'
  | 'delayed'
  | 'cancelled'

export type SuggestionType =
  | 'delay_warning'
  | 'fill_slot'
  | 'redistribute'
  | 'absence_impact'
  | 'overload_warning'
  | 'optimization'
  | 'conflict'
  | 'stock_alert'

export interface Mechanic {
  id: string
  name: string
  /** Initiales de REPLI, affichées tant qu'aucune photo n'existe. */
  avatar: string
  /**
   * URL servie de la photo de profil, CALCULÉE par `GET /api/mechanics` depuis
   * `avatarPath` (jamais stockée en base). Absente du type, elle arrivait bien
   * dans les données du planning mais aucun écran ne pouvait la lire sans
   * cast — c'est le pendant typé de GF-004.
   */
  avatarUrl?: string | null
  color: string
  isAbsent: boolean
  /**
   * Mécanicien ARCHIVÉ : retiré du planning, historique conservé.
   *
   * À distinguer de `isAbsent`, qui est une absence du JOUR. L'archivage est la
   * sortie de secours que `DELETE /api/mechanics/:id` propose quand la
   * suppression est refusée — le champ existait en base et dans l'API mais
   * n'était typé nulle part côté produit, donc illisible sans cast (GF-040).
   */
  archivedAt?: string | null
  specialty: RepairType[]
  order: number
  garageId: string
  createdAt: string
  updatedAt: string
}

export interface Job {
  id: string
  customerName: string
  vehicleModel: string
  licensePlate?: string
  repairType: RepairType
  estimatedDuration: number // minutes
  actualDuration?: number // minutes, filled when completed
  mechanicId: string
  startTime: string // HH:mm
  date: string // YYYY-MM-DD
  status: JobStatus
  notes?: string
  isUrgent: boolean
  delayMinutes?: number // if delayed, how many minutes
  vehicleId?: string
  mileageAtVisit?: number
  timerStartedAt?: string | null // ISO datetime when stopwatch started
  garageId: string
  createdAt: string
  updatedAt: string
}

export interface Client {
  id: string
  name: string
  phone?: string
  email?: string
  address?: string
  garageId: string
  createdAt: string
}

export interface Vehicle {
  id: string
  licensePlate: string
  vin?: string
  make: string
  model: string
  year?: number
  mileage?: number
  color?: string
  notes?: string
  clientId: string
  client?: Client
  garageId: string
  createdAt: string
}

export interface Part {
  id: string
  reference?: string
  name: string
  description?: string
  quantity: number
  minQuantity: number
  unitCost: number
  unitPrice: number
  location?: string
  /**
   * Supplier name and supplier-side SKU stored as garage-entered metadata.
   * These values do not prove current price, availability, or lead time; no live
   * supplier adapter is currently wired to the production order routes.
   */
  supplierName?: string | null
  supplierRef?: string | null
  garageId: string
}

export interface JobPart {
  id: string
  jobId: string
  partId: string
  part?: Part
  quantity: number
  unitPrice: number
  unitCost: number
}

export interface StatsDay {
  date: string
  jobCount: number
  completedCount: number
  billedHours: number
  laborRevenue: number
  partsRevenue: number
  partsCost: number
  totalRevenue: number
  utilizationRate: number
}

export interface MechanicStats {
  mechanicId: string
  mechanicName: string
  mechanicColor: string
  jobCount: number
  billedHours: number
  completedCount: number
  utilizationRate: number
}

export interface TimeSlot {
  time: string // HH:mm
  mechanicId: string
  job?: Job
  isEmpty: boolean
  slotDuration: number // minutes available
}

export interface Suggestion {
  id: string
  type: SuggestionType
  priority: 'high' | 'medium' | 'low'
  title: string
  description: string
  affectedJobIds: string[]
  action?: {
    label: string
    jobId?: string
    targetMechanicId?: string
    targetTime?: string
  }
  dismissed: boolean
  createdAt: string
}

export interface WorkshopMetrics {
  vehiclesHandledToday: number
  utilizationRate: number // 0-100 %
  idleTimeMinutes: number
  averageRepairDuration: number // minutes
  predictedDelays: number
  totalSlotsMinutes: number
  filledSlotsMinutes: number
}

export interface RepairTypeConfig {
  label: string
  defaultDuration: number // minutes
  color: string
  icon: string
  isQuick: boolean // can fill small slots
}

export const REPAIR_TYPES: Record<RepairType, RepairTypeConfig> = {
  oil_change: { label: 'Vidange', defaultDuration: 30, color: '#f59e0b', icon: '🛢️', isQuick: true },
  brake_pads: { label: 'Plaquettes de frein', defaultDuration: 45, color: '#ef4444', icon: '🔧', isQuick: false },
  brake_discs: { label: 'Disques de frein', defaultDuration: 90, color: '#dc2626', icon: '⚙️', isQuick: false },
  distribution: { label: 'Distribution', defaultDuration: 240, color: '#7c3aed', icon: '⛓️', isQuick: false },
  diagnostics: { label: 'Diagnostic', defaultDuration: 30, color: '#0891b2', icon: '🔍', isQuick: true },
  tire_change: { label: 'Changement pneus', defaultDuration: 45, color: '#16a34a', icon: '🔄', isQuick: false },
  tire_repair: { label: 'Réparation pneu', defaultDuration: 20, color: '#15803d', icon: '🩹', isQuick: true },
  battery: { label: 'Batterie', defaultDuration: 20, color: '#ca8a04', icon: '🔋', isQuick: true },
  bulb: { label: 'Ampoule', defaultDuration: 15, color: '#eab308', icon: '💡', isQuick: true },
  suspension: { label: 'Suspension', defaultDuration: 120, color: '#ea580c', icon: '🔩', isQuick: false },
  exhaust: { label: 'Échappement', defaultDuration: 60, color: '#64748b', icon: '💨', isQuick: false },
  clutch: { label: 'Embrayage', defaultDuration: 180, color: '#9333ea', icon: '🔑', isQuick: false },
  air_conditioning: { label: 'Climatisation', defaultDuration: 60, color: '#06b6d4', icon: '❄️', isQuick: false },
  revision: { label: 'Révision complète', defaultDuration: 120, color: '#2563eb', icon: '📋', isQuick: false },
  inspection: { label: 'Contrôle technique', defaultDuration: 45, color: '#7c3aed', icon: '✅', isQuick: false },
  bodywork: { label: 'Carrosserie', defaultDuration: 180, color: '#db2777', icon: '🎨', isQuick: false },
  custom: { label: 'Autre intervention', defaultDuration: 60, color: '#6b7280', icon: '🔧', isQuick: false },
}

/**
 * Configuration d'un type d'intervention, TOUJOURS définie.
 *
 * `REPAIR_TYPES[job.repairType]` était lu directement dans les composants du
 * planning. Or l'API accepte n'importe quelle chaîne (`repairType: z.string()`,
 * schemas/index.ts) : une valeur hors des 17 clés connues — import de données,
 * intégration tierce, ancien enregistrement — rendait la configuration
 * `undefined` et `repairConfig.color` levait
 * « Cannot read properties of undefined (reading 'color') ».
 * Ce n'est pas une carte qui ne s'affiche pas : c'est TOUT le planning qui tombe
 * sur l'écran « Une erreur est survenue » (reproduit le 2026-08-10 avec
 * repairType = "Vidange", le LIBELLÉ au lieu de la clé `oil_change`).
 *
 * On retombe sur « Autre intervention », en conservant le libellé d'origine
 * pour ne rien masquer à l'utilisateur.
 */
export function repairConfig(type: string | null | undefined): RepairTypeConfig {
  const known = REPAIR_TYPES[type as RepairType]
  if (known) return known
  return { ...REPAIR_TYPES.custom, label: (type && String(type).trim()) || REPAIR_TYPES.custom.label }
}

export const WORKSHOP_START_HOUR = 8
export const WORKSHOP_END_HOUR = 18
export const SLOT_HEIGHT_PER_MINUTE = 2 // px per minute in the board
