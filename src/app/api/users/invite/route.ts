export const dynamic = 'force-dynamic'

/**
 * POST /api/users/invite  (propriétaire)
 * Crée un compte employé « invited » et un jeton d'invitation (usage unique,
 * haché). Renvoie le lien d'acceptation au PROPRIÉTAIRE (authentifié, même
 * garage) pour qu'il le transmette ; le jeton n'est jamais exposé ailleurs.
 * Body: { name, email, role }
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSession, withAuth } from '@/lib/api-helpers'
import { logAudit } from '@/lib/audit'
import { inviteEmployee, type Actor } from '@/lib/users/service'
import { appBaseUrl } from '@/lib/app-url'

const Body = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().max(200),
  role: z.enum(['MANAGER', 'MECHANIC', 'RECEPTIONIST']).default('RECEPTIONIST'),
})

export const POST = withAuth(async (req) => {
  const session = await requireSession()
  const actor: Actor = { id: session.user.id, role: session.user.role, garageId: session.user.garageId }

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Données invalides', details: parsed.error.flatten() }, { status: 400 })
  }

  const res = await inviteEmployee(actor, parsed.data)
  if (!res.ok) {
    const status = res.error === 'Réservé au propriétaire' ? 403 : 409
    return NextResponse.json({ error: res.error }, { status })
  }

  await logAudit({ action: 'create', entityType: 'User', entityId: res.userId, session, req, details: { invited: res.email } })
  const acceptUrl = `${appBaseUrl()}/accept-invite?token=${encodeURIComponent(res.token)}`
  return NextResponse.json({ ok: true, userId: res.userId, acceptUrl }, { status: 201 })
})
