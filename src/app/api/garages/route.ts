export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { withAuth, requireSession, MAX_LOGO_BASE64_LENGTH } from '@/lib/api-helpers'
import { parseAmountToScaled } from '@/lib/money'
import { garageToEuros } from '@/lib/money-db'
import { clientIpFrom, enforceRateLimit, rateLimitResponse } from '@/lib/security/rate-limit'
import bcrypt from 'bcryptjs'
import { savePhoto } from '@/lib/photo-store'
import { UpdateGarageSchema } from '@/lib/schemas'

// GET /api/garages  — returns the current user's garage info
export const GET = withAuth(async () => {
  const session = await requireSession()

  // L'ANNUAIRE DU PERSONNEL n'est pas une information de garage.
  //
  // `GET /api/users` le réserve à OWNER/MANAGER (`user:manage`), mais cette
  // route le servait — noms, e-mails, rôles de TOUS les comptes — à n'importe
  // quel rôle authentifié : le contrôle d'accès posé sur une porte se
  // contournait par la porte d'à côté (GF31-AUD-059). On le conditionne à la
  // même permission, sans fermer la route : les autres rôles ont besoin des
  // informations du garage lui-même.
  // Exactement la même règle que `GET /api/users` — c'est le point : deux
  // portes vers la même donnée ne doivent pas avoir deux serrures différentes.
  const peutVoirLePersonnel = ['OWNER', 'MANAGER'].includes(session.user.role)
  const garage = await prisma.garage.findUnique({
    where: { id: session.user.garageId },
    include: {
      ...(peutVoirLePersonnel
        ? { users: { select: { id: true, name: true, email: true, role: true, createdAt: true } } }
        : {}),
      _count: { select: { mechanics: true, jobs: true } },
    },
  })

  // Ne JAMAIS exposer le mot de passe SMTP (stocké en clair) dans la réponse :
  // aucun rôle n'en a besoin côté client (le champ de saisie est en écriture
  // seule). Défense contre la lecture par des rôles bas (MECHANIC/VIEWER).
  if (garage) {
    const { smtpPass: _smtpPass, ...safe } = garage as typeof garage & { smtpPass?: unknown }
    // …mais TOUJOURS en repassant par garageToEuros : ce retour anticipé
    // court-circuitait la conversion, si bien que la réponse ne portait que
    // `hourlyRateTenThousandths` et que `hourlyRate` arrivait `undefined` côté
    // client — l'appel à garageToEuros plus bas était devenu inatteignable.
    return NextResponse.json(garageToEuros(safe))
  }

  return NextResponse.json(garage)
})

// PATCH /api/garages  — update garage info
export const PATCH = withAuth(async (req) => {
  const session = await requireSession()
  if (session.user.role !== 'OWNER') {
    return NextResponse.json({ error: 'Réservé au propriétaire' }, { status: 403 })
  }

  const raw = await req.json()

  // Reject oversized logos (very generous — the client already downscales)
  if (raw.logoBase64 && raw.logoBase64.length > MAX_LOGO_BASE64_LENGTH) {
    return NextResponse.json({ error: 'Logo trop grand' }, { status: 413 })
  }

  // VALIDATION — `UpdateGarageSchema` existait déjà mais n'était pas appliqué :
  // le corps de requête partait tel quel en base. Un taux de TVA de 150 %, une
  // devise « EUROS » ou une adresse e-mail malformée étaient acceptés et
  // persistés, et le taux de TVA du garage alimente CHAQUE document facturé.
  const parsed = UpdateGarageSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Réglages invalides', code: 'VALIDATION_ERROR', details: parsed.error.flatten() },
      { status: 400 },
    )
  }
  const body = parsed.data

  // Le schéma garantit ≤ 4 décimales, donc une conversion exacte. On la fait
  // AVANT l'écriture, et on refuse explicitement en cas d'échec : le code
  // précédent retombait sur `?? 600000`, écrivant 60 €/h en silence quand la
  // saisie n'était pas convertible — le garage facturait alors un tarif qu'il
  // n'avait jamais choisi.
  let scaledHourlyRate: number | undefined
  if (body.hourlyRate !== undefined) {
    const scaled = parseAmountToScaled(body.hourlyRate)
    if (scaled === null) {
      return NextResponse.json(
        { error: 'Tarif horaire invalide', code: 'VALIDATION_ERROR' },
        { status: 400 },
      )
    }
    scaledHourlyRate = scaled
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
      ...(body.taxRate !== undefined && { taxRate: body.taxRate }),
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
      // Saisie euros -> entier exact (dix-milliemes) ; parsing STRICT (jamais parseFloat monétaire).
      ...(body.hourlyRate !== undefined && { hourlyRateTenThousandths: scaledHourlyRate }),
      ...(body.workshopStartHour !== undefined && { workshopStartHour: body.workshopStartHour }),
      ...(body.workshopEndHour   !== undefined && { workshopEndHour:   body.workshopEndHour }),
      ...(body.smsPhone !== undefined && { smsPhone: body.smsPhone || null }),
      ...(body.workOrderPrefix        !== undefined && { workOrderPrefix:        body.workOrderPrefix }),
      ...(body.warrantyMonthsDefault  !== undefined && { warrantyMonthsDefault:  body.warrantyMonthsDefault }),
      ...(body.loanerEnabled          !== undefined && { loanerEnabled:          body.loanerEnabled }),
      ...(body.smartReminderMonths    !== undefined && { smartReminderMonths:    body.smartReminderMonths }),
      ...(body.purchaseOrderPrefix    !== undefined && { purchaseOrderPrefix:    body.purchaseOrderPrefix }),
    },
  })

  return NextResponse.json(garage ? garageToEuros(garage) : garage)
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
