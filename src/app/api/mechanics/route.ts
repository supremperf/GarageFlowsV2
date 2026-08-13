export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { requireSession, withAuth } from '@/lib/api-helpers'
import { CreateMechanicSchema } from '@/lib/schemas'
import { logAudit } from '@/lib/audit'
import { normalizeSpecialty } from '@/lib/specialty'

/**
 * GET /api/mechanics
 *
 * Rend l'effectif ACTIF par défaut. `?includeArchived=1` rend l'effectif complet
 * — nécessaire aux écrans de gestion et à la lecture de l'historique, où un
 * mécanicien parti doit rester nommable.
 *
 * `avatarUrl` est CALCULÉE ici et non stockée : la base ne garde que la clé de
 * stockage (`avatarPath`). Une URL figée en base deviendrait fausse au moindre
 * changement de route, et surtout elle contournerait le contrôle
 * d'appartenance — c'est la route de service qui vérifie que le chemin demandé
 * appartient bien au garage de la session.
 */
export const GET = withAuth(async (req) => {
  const session = await requireSession()

  const inclureArchives = new URL(req.url).searchParams.get('includeArchived') === '1'

  const mechanics = await prisma.mechanic.findMany({
    where: {
      garageId: session.user.garageId,
      ...(inclureArchives ? {} : { archivedAt: null }),
    },
    orderBy: { order: 'asc' },
  })

  return NextResponse.json(mechanics.map((m) => ({
    ...m,
    avatarUrl: m.avatarPath ? `/api/photos/${m.avatarPath}` : null,
  })))
})

// POST /api/mechanics
export const POST = withAuth(async (req) => {
  const session = await requireSession()

  // Seuls OWNER/MANAGER peuvent ajouter des mécaniciens.
  if (!['OWNER', 'MANAGER'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Vous ne disposez pas des autorisations nécessaires.' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 })
  }

  const parsed = CreateMechanicSchema.safeParse(body)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    const field = first?.path?.[0]
    const msg =
      field === 'name'  ? 'Le nom du mécanicien est obligatoire.' :
      field === 'color' ? 'La couleur sélectionnée est invalide.' :
      (first?.message ?? 'Données invalides.')
    return NextResponse.json({ error: msg, details: parsed.error.flatten() }, { status: 400 })
  }
  const data = parsed.data

  // Refus d'un nom vide APRÈS trim (des espaces seuls passent min(1)).
  const name = data.name.trim()
  if (!name) {
    return NextResponse.json({ error: 'Le nom du mécanicien est obligatoire.' }, { status: 400 })
  }

  // garageId vient EXCLUSIVEMENT de la session serveur (jamais du corps client).
  const garageId = session.user.garageId

  try {
    // Anti-doublon RÉEL : le modèle Mechanic n'a pas de contrainte d'unicité en
    // base (le handler P2002 plus bas ne se déclenchait donc jamais → dédup
    // illusoire). On contrôle au niveau applicatif, insensible à la casse, sur la
    // liste (courte) du garage. Le P2002 reste en filet de sécurité si une
    // contrainte est ajoutée un jour.
    const roster = await prisma.mechanic.findMany({ where: { garageId }, select: { name: true } })
    const norm = (s: string) => s.trim().toLowerCase()
    if (roster.some((m) => norm(m.name) === norm(name))) {
      return NextResponse.json({ error: 'Ce mécanicien existe déjà.' }, { status: 409 })
    }
    const count = roster.length
    const mechanic = await prisma.mechanic.create({
      data: {
        name,
        avatar: (data.avatar?.trim() || name.slice(0, 2).toUpperCase()),
        color: data.color,
        specialty: normalizeSpecialty(data.specialty), // tableau OU chaîne → JSON string
        order: data.order ?? count + 1,
        garageId,
      },
    })
    await logAudit({ action: 'create', entityType: 'Mechanic', entityId: mechanic.id, session, req })
    return NextResponse.json(mechanic, { status: 201 })
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? (err as { code?: string }).code : undefined
    if (code === 'P2002') {
      return NextResponse.json({ error: 'Ce mécanicien existe déjà.' }, { status: 409 })
    }
    if (code === 'P2003') {
      return NextResponse.json({ error: 'Garage introuvable pour ce compte.' }, { status: 400 })
    }
    // Ne jamais exposer le détail technique au client ; trace serveur minimale.
    console.error('[mechanics] création impossible', code ? `(code ${code})` : '')
    return NextResponse.json(
      { error: 'Une erreur temporaire empêche la création. Réessayez dans quelques instants.' },
      { status: 500 },
    )
  }
})
