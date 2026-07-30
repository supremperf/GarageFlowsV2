/**
 * Garde multi-tenant : vérifie qu'une ressource liée (FK fournie par le client)
 * appartient bien au garage de la session AVANT de l'associer.
 *
 * Sans cette vérification, un mécanicien/véhicule/client/pièce d'un autre garage
 * pourrait être rattaché à un objet (intégrité) et surtout LU via les `include`
 * de relations (IDOR de 2nd ordre). Entièrement typé (aucun `any`/`@ts-ignore`).
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export type TenantModel = 'client' | 'vehicle' | 'job' | 'mechanic' | 'part' | 'loanerVehicle' | 'invoice' | 'quote'

/** Une ressource `id` du modèle donné appartient-elle au garage ? `null/undefined` → true (rien à vérifier). */
export async function relationInGarage(garageId: string, model: TenantModel, id: string | null | undefined): Promise<boolean> {
  if (!id) return true
  const where = { id, garageId }
  const select = { id: true }
  switch (model) {
    case 'client': return !!(await prisma.client.findFirst({ where, select }))
    case 'vehicle': return !!(await prisma.vehicle.findFirst({ where, select }))
    case 'job': return !!(await prisma.job.findFirst({ where, select }))
    case 'mechanic': return !!(await prisma.mechanic.findFirst({ where, select }))
    case 'part': return !!(await prisma.part.findFirst({ where, select }))
    case 'loanerVehicle': return !!(await prisma.loanerVehicle.findFirst({ where, select }))
    case 'invoice': return !!(await prisma.invoice.findFirst({ where, select }))
    case 'quote': return !!(await prisma.quote.findFirst({ where, select }))
  }
}

export interface RelationCheck {
  model: TenantModel
  id: string | null | undefined
  label?: string
}

/**
 * Vérifie plusieurs FK d'un coup. Renvoie une réponse 400 prête si l'une d'elles
 * ne se trouve pas dans le garage, sinon `null` (tout est autorisé).
 * N'exécute que les vérifications pour lesquelles un id est fourni.
 */
export async function assertRelations(garageId: string, checks: RelationCheck[]): Promise<NextResponse | null> {
  for (const c of checks) {
    if (!c.id) continue
    const ok = await relationInGarage(garageId, c.model, c.id)
    if (!ok) {
      return NextResponse.json(
        { error: `${c.label ?? c.model} introuvable ou hors de votre garage.` },
        { status: 400 },
      )
    }
  }
  return null
}
