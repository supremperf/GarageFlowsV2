export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSession, withAuth } from '@/lib/api-helpers'
import bcrypt from 'bcryptjs'
import { CreateUserSchema } from '@/lib/schemas'
import { logAudit } from '@/lib/audit'

// GET /api/users — list users in garage
export const GET = withAuth(async () => {
  const session = await requireSession()
  if (!['OWNER', 'MANAGER'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  const users = await prisma.user.findMany({
    where: { garageId: session.user.garageId },
    select: {
      id: true, name: true, email: true, role: true, createdAt: true,
      status: true, emailVerified: true, lastLoginAt: true,
    },
    orderBy: { createdAt: 'asc' },
  })

  return NextResponse.json(users)
})

// POST /api/users — invite a new user to the garage
export const POST = withAuth(async (req) => {
  const session = await requireSession()
  if (session.user.role !== 'OWNER') {
    return NextResponse.json({ error: 'Réservé au propriétaire' }, { status: 403 })
  }

  const body = await req.json()

  const parsed = CreateUserSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Données invalides', details: parsed.error.flatten() }, { status: 400 })
  }

  const { name, email, password, role = 'RECEPTIONIST' } = body

  if (!name || !email || !password) {
    return NextResponse.json({ error: 'Champs obligatoires manquants' }, { status: 400 })
  }

  const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } })
  if (existing) {
    return NextResponse.json({ error: 'Email déjà utilisé' }, { status: 409 })
  }

  const hashed = await bcrypt.hash(password, 12)
  const user = await prisma.user.create({
    data: {
      name,
      email: email.toLowerCase(),
      password: hashed,
      role: ['OWNER', 'MANAGER', 'RECEPTIONIST'].includes(role) ? role : 'RECEPTIONIST',
      garageId: session.user.garageId,
    },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  })

  await logAudit({ action: 'create', entityType: 'User', entityId: user.id, session, req })

  return NextResponse.json(user, { status: 201 })
})
