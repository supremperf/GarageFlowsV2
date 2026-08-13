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
      // `avatarPath` est la clé de STOCKAGE : elle n'est jamais renvoyée telle
      // quelle, seulement transformée en URL servie ci-dessous.
      select: { id: true, name: true, avatar: true, color: true, avatarPath: true },
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

  // La PWA reçoit une URL servie par l'espace mécanicien, pas la clé de
  // stockage : c'est cette route qui contrôle que la photo demandée est bien la
  // SIENNE. Sans elle, le mécanicien voyait ses initiales alors que son patron
  // avait mis une photo depuis le poste.
  const { avatarPath, ...profil } = mechanic ?? ({} as Record<string, unknown>)

  return NextResponse.json({
    mechanic: mechanic
      ? { ...profil, avatarUrl: avatarPath ? `/api/mechanic/photos/${avatarPath}` : null }
      : null,
    garage: garage ?? null,
    license: license ? { expiryAt: license.expiryAt } : null,
  })
})
