export const dynamic = 'force-dynamic'

/**
 * PATCH /api/users/[id]  (propriétaire)
 * Actions de cycle de vie employé — toutes ISOLÉES par garageId côté service et
 * validées côté serveur (rôle acteur, protection du dernier propriétaire) :
 *   { action: 'suspend' | 'reactivate' | 'revokeSessions' | 'transferOwnership' }
 *   { action: 'changeRole', role: 'MANAGER' | 'MECHANIC' | 'RECEPTIONIST' | 'OWNER' }
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSession, withAuth } from '@/lib/api-helpers'
import { logAudit } from '@/lib/audit'
import {
  suspendEmployee, reactivateEmployee, changeRole, revokeSessions, transferOwnership, type Actor,
} from '@/lib/users/service'

const Body = z.object({
  action: z.enum(['suspend', 'reactivate', 'revokeSessions', 'transferOwnership', 'changeRole']),
  role: z.string().optional(),
})

export const PATCH = withAuth(async (req, ctx) => {
  const session = await requireSession()
  const actor: Actor = { id: session.user.id, role: session.user.role, garageId: session.user.garageId }
  const targetId = ctx?.params?.id as string
  if (!targetId) return NextResponse.json({ error: 'Identifiant manquant' }, { status: 400 })

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Données invalides', details: parsed.error.flatten() }, { status: 400 })
  }
  const { action, role } = parsed.data

  let res: { ok: boolean; error?: string }
  switch (action) {
    case 'suspend':           res = await suspendEmployee(actor, targetId); break
    case 'reactivate':        res = await reactivateEmployee(actor, targetId); break
    case 'revokeSessions':    res = await revokeSessions(actor, targetId); break
    case 'transferOwnership': res = await transferOwnership(actor, targetId); break
    case 'changeRole':
      if (!role) return NextResponse.json({ error: 'Rôle requis' }, { status: 400 })
      res = await changeRole(actor, targetId, role); break
    default:
      return NextResponse.json({ error: 'Action inconnue' }, { status: 400 })
  }

  if (!res.ok) {
    // 403 pour un refus d'autorisation, 400 pour une règle métier (dernier proprio…).
    const status = res.error === 'Réservé au propriétaire' ? 403 : 400
    return NextResponse.json({ error: res.error }, { status })
  }

  await logAudit({ action: 'update', entityType: 'User', entityId: targetId, session, req, details: { action, role } })
  return NextResponse.json({ ok: true })
})
