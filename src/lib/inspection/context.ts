/**
 * Contexte d'un CONTRÔLE VÉHICULE — résolution par les IDENTIFIANTS MÉTIER.
 *
 * ─── Le défaut corrigé ──────────────────────────────────────────────────────
 * La modale « Contrôle véhicule » recopiait uniquement les CHAÎNES visibles de
 * l'intervention (`customerName`, `vehicleModel`, `licensePlate`) transmises en
 * props, et n'a jamais reçu `vehicleId`. Conséquences constatées en base :
 *   - toutes les inspections ont `vehicleId = NULL` — aucun rattachement au
 *     véhicule, donc aucun historique véhicule, aucune relance kilométrique ;
 *   - `mileage` reste vide : `Job.mileageAtVisit` n'est écrit par AUCUN écran,
 *     et le kilométrage réellement connu (`Vehicle.mileage`) n'était pas lu.
 *
 * ─── La règle ───────────────────────────────────────────────────────────────
 * Le contexte est résolu CÔTÉ SERVEUR à partir de l'intervention, en suivant les
 * relations réelles (job → vehicle → client), et TOUJOURS borné au garage de la
 * session. Le client ne choisit pas le véhicule : il le reçoit.
 *
 * Le rattachement se fait par `Job.vehicleId` quand il existe ; à défaut par
 * l'immatriculation, qui est unique PAR GARAGE (`@@unique([licensePlate,
 * garageId])`) — deux garages peuvent donc détenir la même plaque sans jamais
 * se voir. Les chaînes de l'intervention ne servent que de repli lorsqu'aucune
 * fiche véhicule n'existe (cas d'un garage qui saisit tout au kilomètre).
 */
import { prisma } from '@/lib/db'

export interface InspectionContext {
  /** Intervention d'origine (null si le contrôle est ouvert depuis un véhicule). */
  jobId: string | null
  /** Fiche véhicule réellement rattachée — null si le garage n'en a pas créé. */
  vehicleId: string | null
  clientId: string | null
  clientName: string
  vehicleModel: string
  licensePlate: string
  /** Dernier kilométrage connu (relevé de la visite, sinon fiche véhicule). */
  mileage: number | null
}

/** Normalise une plaque pour la comparaison (casse + séparateurs indifférents). */
function plateKey(plate: string | null | undefined): string {
  return (plate ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** Libellé véhicule d'une fiche (« Renault Twingo »). */
function vehicleLabel(v: { make: string; model: string }): string {
  return [v.make, v.model].filter(Boolean).join(' ').trim()
}

/**
 * La fiche véhicule ne fait autorité sur le libellé que si elle est COMPLÈTE
 * (marque ET modèle). Une fiche partielle — « Renault » sans modèle — est moins
 * informative que le texte saisi sur l'intervention (« Renault Twingo ») : la
 * préférer appauvrirait l'affichage au lieu de l'enrichir.
 */
function canonicalVehicleLabel(v: { make: string; model: string } | null): string {
  if (!v) return ''
  return v.make?.trim() && v.model?.trim() ? vehicleLabel(v) : ''
}

/**
 * Retrouve la fiche véhicule d'une intervention DANS LE GARAGE DONNÉ.
 * `Job.vehicleId` fait foi ; sinon rapprochement par immatriculation.
 */
async function findVehicleForJob(
  garageId: string,
  job: { vehicleId: string | null; licensePlate: string | null },
) {
  const select = {
    id: true, licensePlate: true, make: true, model: true, mileage: true,
    clientId: true, client: { select: { id: true, name: true } },
  } as const

  if (job.vehicleId) {
    const byId = await prisma.vehicle.findFirst({ where: { id: job.vehicleId, garageId }, select })
    if (byId) return byId
  }

  const key = plateKey(job.licensePlate)
  if (!key) return null

  // `licensePlate` est stockée telle que saisie : on compare sur la forme
  // normalisée pour rapprocher « FZ-319-BZ » et « fz319bz ». La recherche reste
  // bornée au garage — jamais de fuite inter-garage.
  const candidates = await prisma.vehicle.findMany({ where: { garageId }, select })
  return candidates.find((v) => plateKey(v.licensePlate) === key) ?? null
}

/**
 * Contexte de contrôle pour une intervention. Renvoie `null` si l'intervention
 * n'existe pas ou n'appartient pas au garage (isolation multi-tenant).
 */
export async function resolveInspectionContext(
  garageId: string,
  jobId?: string | null,
  vehicleId?: string | null,
): Promise<InspectionContext | null> {
  if (jobId) {
    const job = await prisma.job.findFirst({
      where: { id: jobId, garageId },
      select: {
        id: true, customerName: true, vehicleModel: true, licensePlate: true,
        mileageAtVisit: true, vehicleId: true,
      },
    })
    if (!job) return null

    const vehicle = await findVehicleForJob(garageId, job)

    return {
      jobId: job.id,
      vehicleId: vehicle?.id ?? null,
      clientId: vehicle?.clientId ?? null,
      // Le nom saisi sur l'intervention prime : c'est celui que l'atelier a
      // sous les yeux. La fiche client ne sert que s'il est vide.
      clientName: job.customerName?.trim() || vehicle?.client?.name || '',
      // Fiche complète → source canonique ; sinon texte de l'intervention ;
      // en dernier recours le libellé partiel de la fiche.
      vehicleModel: canonicalVehicleLabel(vehicle) || job.vehicleModel || vehicleLabel(vehicle ?? { make: '', model: '' }),
      licensePlate: vehicle?.licensePlate || job.licensePlate || '',
      // Relevé de CETTE visite s'il existe, sinon dernier kilométrage connu.
      mileage: job.mileageAtVisit ?? vehicle?.mileage ?? null,
    }
  }

  if (vehicleId) {
    const vehicle = await prisma.vehicle.findFirst({
      where: { id: vehicleId, garageId },
      select: {
        id: true, licensePlate: true, make: true, model: true, mileage: true,
        clientId: true, client: { select: { id: true, name: true } },
      },
    })
    if (!vehicle) return null
    return {
      jobId: null,
      vehicleId: vehicle.id,
      clientId: vehicle.clientId,
      clientName: vehicle.client?.name ?? '',
      vehicleModel: vehicleLabel(vehicle),
      licensePlate: vehicle.licensePlate,
      mileage: vehicle.mileage ?? null,
    }
  }

  return null
}
