export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { SignJWT } from 'jose'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { portalSecret } from '@/lib/portal-secret'

// POST /api/portal/generate — generate a 7-day portal JWT for a specific job
export const POST = withAuth(async (req) => {
  const session = await requireSession()
  const { jobId } = await req.json()

  if (!jobId) return NextResponse.json({ error: 'jobId requis' }, { status: 400 })

  const job = await prisma.job.findFirst({
    where: { id: jobId, garageId: session.user.garageId },
    select: { id: true },
  })
  if (!job) return NextResponse.json({ error: 'Intervention introuvable' }, { status: 404 })

  const token = await new SignJWT({ typ: 'portal', jobId })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(portalSecret())

  return NextResponse.json({ token, path: `/portal/${token}` })
})
