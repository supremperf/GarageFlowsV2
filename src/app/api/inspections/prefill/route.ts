export const dynamic = "force-dynamic"
/**
 * GET /api/inspections/prefill?jobId=…&vehicleId=…
 *
 * Contexte de préremplissage d'un CONTRÔLE VÉHICULE, résolu par les relations
 * réelles (intervention → véhicule → client) et borné au garage de la session.
 * La modale n'a plus à recopier les libellés affichés : elle demande au serveur
 * ce que le garage sait déjà du véhicule (immatriculation, kilométrage, fiche).
 */
import { NextResponse } from 'next/server'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { resolveInspectionContext } from '@/lib/inspection/context'

export const GET = withAuth(async (req) => {
  const session = await requireSession()
  const { searchParams } = new URL(req.url)
  const jobId = searchParams.get('jobId')
  const vehicleId = searchParams.get('vehicleId')

  if (!jobId && !vehicleId) {
    return NextResponse.json({ error: 'jobId ou vehicleId requis' }, { status: 400 })
  }

  const context = await resolveInspectionContext(session.user.garageId, jobId, vehicleId)
  // Introuvable OU hors du garage : même réponse, aucune information révélée.
  if (!context) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })

  return NextResponse.json(context)
})
