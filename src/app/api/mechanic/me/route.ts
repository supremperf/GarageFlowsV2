export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireMechanic, withMechanic } from '@/lib/mechanic-api'

// GET /api/mechanic/me — profil minimal du mécanicien connecté + garage.
// Sélection STRICTE : aucune donnée financière, aucun autre mécanicien.
export const GET = withMechanic(async () => {
  const ctx = await requireMechanic()

  const [mechanic, garage, license] = await Promise.all([
    prisma.mechanic.findFirst({
      where: { id: ctx.mechanicId, garageId: ctx.garageId },
      select: { id: true, name: true, avatar: true, color: true },
    }),
    prisma.garage.findUnique({
      where: { id: ctx.garageId },
      select: { name: true, workshopStartHour: true, workshopEndHour: true, language: true },
    }),
    prisma.licenseKey.findUnique({
      where: { licenseId: ctx.licenseId },
      select: { expiryAt: true },
    }),
  ])

  return NextResponse.json({
    mechanic: mechanic ?? null,
    garage: garage ?? null,
    license: license ? { expiryAt: license.expiryAt } : null,
  })
})
