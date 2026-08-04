export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { validateMechanicSession } from '@/lib/license/mechanic-session'
import { prisma } from '@/lib/db'

// POST /api/mechanic/logout
// Termine la session mécanicien : expire les cookies et signale au client de
// purger tout cache local (isolation par utilisateur). Best-effort audit.
export async function POST() {
  const raw = cookies().get('gf_session')?.value ?? ''
  // Best-effort : journaliser la déconnexion si la session est (encore) valide.
  try {
    const check = await validateMechanicSession({ rawGfSession: raw })
    if (check.ok) {
      await prisma.mechanicActionAudit.create({
        data: { garageId: check.ctx.garageId, actorUserId: null, actorRole: null, targetMechanicId: check.ctx.mechanicId, licenseId: check.ctx.licenseId, action: 'logout' },
      }).catch(() => {})
    }
  } catch {
    /* ignore */
  }

  const res = NextResponse.json({ ok: true, purgeCache: true })
  const isElectron = process.env.ELECTRON === '1'
  const secure = isElectron ? '' : '; Secure'
  const expire = `; Path=/; Max-Age=0; SameSite=Strict${secure}`
  res.headers.append('Set-Cookie', `gf_session=${expire}; HttpOnly`)
  res.headers.append('Set-Cookie', `gf_license_validated=${expire}`)
  res.headers.append('Set-Cookie', `gf_license_type=${expire}`)
  res.headers.set('Cache-Control', 'no-store')
  return res
}
