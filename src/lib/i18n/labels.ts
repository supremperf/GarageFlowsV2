// Libellés traduits pour les valeurs canoniques stockées en base (clés RepairType).
// La valeur stockée reste inchangée ; seul l'affichage est traduit.
import type { T } from './translations'

const REPAIR_TYPE_KEYS: Record<string, keyof T> = {
  oil_change: 'rtOilChange',
  brake_pads: 'rtBrakePads',
  brake_discs: 'rtBrakeDiscs',
  distribution: 'rtDistribution',
  diagnostics: 'rtDiagnostics',
  tire_change: 'rtTireChange',
  tire_repair: 'rtTireRepair',
  battery: 'rtBattery',
  bulb: 'rtBulb',
  suspension: 'rtSuspension',
  exhaust: 'rtExhaust',
  clutch: 'rtClutch',
  air_conditioning: 'rtAirCon',
  revision: 'rtRevision',
  inspection: 'rtInspection',
  bodywork: 'rtBodywork',
  custom: 'rtCustom',
}

/** Libellé traduit d'un type d'intervention (RepairType). Retourne le fallback si inconnu. */
export function repairTypeLabel(t: T, key: string, fallback?: string): string {
  const k = REPAIR_TYPE_KEYS[key]
  return k ? t[k] : (fallback ?? key)
}

const JOB_STATUS_KEYS: Record<string, keyof T> = {
  scheduled: 'jstScheduled',
  in_progress: 'jstInProgress',
  completed: 'jstCompleted',
  delayed: 'jstDelayed',
  cancelled: 'jstCancelled',
}

/** Libellé traduit d'un statut d'intervention (JobStatus). */
export function jobStatusLabel(t: T, key: string, fallback?: string): string {
  const k = JOB_STATUS_KEYS[key]
  return k ? t[k] : (fallback ?? key)
}

const INSPECTION_CATEGORY_KEYS: Record<string, keyof T> = {
  brakes: 'insCatBrakes',
  tires: 'insCatTires',
  lights: 'insCatLights',
  oil: 'insCatOil',
  suspension: 'insCatSuspension',
  body: 'insCatBody',
  battery: 'insCatBattery',
  belts: 'insCatBelts',
  filters: 'insCatFilters',
}

/** Libellé traduit d'une catégorie de contrôle véhicule. */
export function inspectionCategoryLabel(t: T, key: string, fallback?: string): string {
  const k = INSPECTION_CATEGORY_KEYS[key]
  return k ? t[k] : (fallback ?? key)
}

const DOC_STATUS_KEYS: Record<string, keyof T> = {
  draft: 'qiStDraft',
  sent: 'qiStSent',
  accepted: 'qiStAccepted',
  refused: 'qiStRefused',
  converted: 'qiStConverted',
  paid: 'qiStPaid',
  overdue: 'qiStOverdue',
}

/** Libellé traduit d'un statut de devis/facture. */
export function docStatusLabel(t: T, key: string, fallback?: string): string {
  const k = DOC_STATUS_KEYS[key]
  return k ? t[k] : (fallback ?? key)
}
