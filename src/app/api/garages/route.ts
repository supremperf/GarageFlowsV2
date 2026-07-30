export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession, MAX_LOGO_BASE64_LENGTH } from '@/lib/api-helpers'
import { clientIpFrom, enforceRateLimit, rateLimitResponse } from '@/lib/security/rate-limit'
import bcrypt from 'bcryptjs'
import { savePhoto } from '@/lib/photo-store'

// GET /api/garages  — returns the current user's garage info
export const GET = withAuth(async () => {
  const session = await requireSession()

  const garage = await prisma.garage.findUnique({
    where: { id: session.user.garageId },
    include: {
      users: { select: { id: true, name: true, email: true, role: true, createdAt: true } },
      _count: { select: { mechanics: true, jobs: true } },
    },
  })

  return NextResponse.json(garage)
})

// PATCH /api/garages  — update garage info
export const PATCH = withAuth(async (req) => {
  const session = await requireSession()
  if (session.user.role !== 'OWNER') {
    return NextResponse.json({ error: 'Réservé au propriétaire' }, { status: 403 })
  }

  const body = await req.json()

  // Reject oversized logos (very generous — the client already downscales)
  if (body.logoBase64 && body.logoBase64.length > MAX_LOGO_BASE64_LENGTH) {
    return NextResponse.json({ error: 'Logo trop grand' }, { status: 413 })
  }

  const garage = await prisma.garage.update({
    where: { id: session.user.garageId },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.address !== undefined && { address: body.address || null }),
      ...(body.phone !== undefined && { phone: body.phone || null }),
      ...(body.email !== undefined && { email: body.email || null }),
      ...(body.website !== undefined && { website: body.website || null }),
      ...(body.siret !== undefined && { siret: body.siret || null }),
      ...(body.vatNumber !== undefined && { vatNumber: body.vatNumber || null }),
      ...(body.taxRate !== undefined && { taxRate: parseFloat(body.taxRate) || 20 }),
      ...(body.iban !== undefined && { iban: body.iban || null }),
      ...(body.bic !== undefined && { bic: body.bic || null }),
      ...(body.bankName !== undefined && { bankName: body.bankName || null }),
      ...(body.currency !== undefined && { currency: body.currency }),
      ...(body.paymentTerms !== undefined && { paymentTerms: body.paymentTerms || null }),
      ...(body.invoicePrefix !== undefined && { invoicePrefix: body.invoicePrefix }),
      ...(body.quotePrefix !== undefined && { quotePrefix: body.quotePrefix }),
      ...(body.invoiceFooter !== undefined && { invoiceFooter: body.invoiceFooter || null }),
      ...(body.logoBase64 !== undefined && (() => {
        // Suppression du logo → on efface les deux champs
        if (!body.logoBase64) return { logoBase64: null, logoPath: null }
        // Sinon : on stocke de préférence en fichier (logoPath), repli base64
        const logoPath = savePhoto(body.logoBase64, 'logos')
        return logoPath
          ? { logoBase64: null, logoPath }
          : { logoBase64: body.logoBase64, logoPath: null }
      })()),
      ...(body.language !== undefined && { language: body.language }),
      ...(body.onboardingComplete !== undefined && { onboardingComplete: body.onboardingComplete }),
      ...(body.hourlyRate !== undefined && { hourlyRate: parseFloat(body.hourlyRate) || 60 }),
      ...(body.workshopStartHour !== undefined && { workshopStartHour: parseInt(body.workshopStartHour, 10) || 8 }),
      ...(body.workshopEndHour   !== undefined && { workshopEndHour:   parseInt(body.workshopEndHour,   10) || 18 }),
      ...(body.smsPhone !== undefined && { smsPhone: body.smsPhone || null }),
      ...(body.workOrderPrefix        !== undefined && { workOrderPrefix:        body.workOrderPrefix }),
      ...(body.warrantyMonthsDefault  !== undefined && { warrantyMonthsDefault:  parseInt(body.warrantyMonthsDefault,  10) || 12 }),
      ...(body.loanerEnabled          !== undefined && { loanerEnabled:          Boolean(body.loanerEnabled) }),
      ...(body.smartReminderMonths    !== undefined && { smartReminderMonths:    parseInt(body.smartReminderMonths,    10) || 11 }),
      ...(body.purchaseOrderPrefix    !== undefined && { purchaseOrderPrefix:    body.purchaseOrderPrefix }),
    },
  })

  return NextResponse.json(garage)
})

// POST /api/garages/register  — public endpoint: create new garage + owner account
// Note: this is called at /api/garages?action=register
// Inscription (création de garage + compte OWNER). Route PRÉ-LICENCE : elle
// n'appelle pas requireSession (sinon l'inscription serait impossible sans
// licence), mais elle est strictement limitée en débit pour empêcher la
// création massive de comptes. L'accès aux API métier reste, lui, soumis à une
// licence (requireSession → validateLicensedSession) : un garage FREE ainsi créé
// ne peut rien faire sans activer une licence — pas de chemin implicite ouvert.
export const POST = withAuth(async (req) => {
  // Anti-abus : 5 inscriptions/heure/IP (clé distincte de la connexion).
  const rl = await enforceRateLimit('login', `register:${clientIpFrom(req)}`, { max: 5, windowSec: 3600 })
  if (!rl.ok) return rateLimitResponse(rl)

  const body = await req.json()
  const { garageName, garageAddress, garagePhone, userName, userEmail, userPassword } = body

  if (!garageName || !userName || !userEmail || !userPassword) {
    return NextResponse.json({ error: 'Tous les champs sont obligatoires', code: 'VALIDATION_ERROR' }, { status: 400 })
  }

  if (userPassword.length < 8) {
    return NextResponse.json({ error: 'Mot de passe trop court (min 8 caractères)' }, { status: 400 })
  }

  // Check email not already used
  const existingUser = await prisma.user.findUnique({ where: { email: userEmail.toLowerCase() } })
  if (existingUser) {
    return NextResponse.json({ error: 'Adresse email déjà utilisée' }, { status: 409 })
  }

  // Generate unique slug from garage name
  let slug = garageName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

  // Ensure uniqueness
  const existing = await prisma.garage.findUnique({ where: { slug } })
  if (existing) slug = `${slug}-${Date.now().toString(36)}`

  const hashedPassword = await bcrypt.hash(userPassword, 12)

  // Create garage + user + default mechanics in one transaction
  const { garage, user } = await prisma.$transaction(async (tx) => {
    const garage = await tx.garage.create({
      data: {
        name: garageName,
        slug,
        address: garageAddress || null,
        phone: garagePhone || null,
        plan: 'FREE',
      },
    })

    const user = await tx.user.create({
      data: {
        email: userEmail.toLowerCase(),
        password: hashedPassword,
        name: userName,
        role: 'OWNER',
        garageId: garage.id,
      },
    })

    // Create 4 default mechanics
    const defaultMechanics = [
      { name: 'Mécanicien 1', avatar: 'M1', color: '#3b82f6', specialty: '[]', order: 1 },
      { name: 'Mécanicien 2', avatar: 'M2', color: '#10b981', specialty: '[]', order: 2 },
      { name: 'Mécanicien 3', avatar: 'M3', color: '#f59e0b', specialty: '[]', order: 3 },
      { name: 'Mécanicien 4', avatar: 'M4', color: '#8b5cf6', specialty: '[]', order: 4 },
    ]

    await tx.mechanic.createMany({
      data: defaultMechanics.map(m => ({ ...m, garageId: garage.id })),
    })

    return { garage, user }
  })

  return NextResponse.json(
    { garageId: garage.id, userId: user.id, garageName: garage.name },
    { status: 201 }
  )
})
