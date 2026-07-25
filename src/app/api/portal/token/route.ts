export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { prisma } from '@/lib/db'
import { SignJWT } from 'jose'
import { portalSecret } from '@/lib/portal-secret'

// POST /api/portal/token  body: { jobId }
export const POST = withAuth(async (req: Request) => {
  const session = await requireSession()
  const { jobId } = await req.json()

  const job = await prisma.job.findFirst({
    where: { id: jobId, garageId: session.user.garageId },
    select: { id: true, customerName: true },
  })
  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  const token = await new SignJWT({ jobId, typ: 'portal' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('48h')
    .sign(portalSecret())

  const url = `${req.headers.get('origin') ?? ''}/portal/${token}`
  return NextResponse.json({ token, url })
})
