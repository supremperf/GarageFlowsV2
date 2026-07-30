export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { format } from 'date-fns'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { rateLimit } from '@/lib/rate-limit'
import { logAudit } from '@/lib/audit'
import { REPAIR_TYPES } from '@/lib/types'
import { forgottenPartsEngine } from '@/lib/forgotten-parts'
import { generateQuote, type QuoteOperation, type QuoteSuggestionInput } from '@/lib/quote-gen'

const BodySchema = z.object({
  repairTypes: z.array(z.string().min(1)).min(1).max(20),
  laborRatePerHour: z.number().positive().max(100000).optional(),
  vatRate: z.number().min(0).max(100).optional(),
  vehicleId: z.string().min(1).optional(),
  licensePlate: z.string().min(1).max(32).optional(),
  clientId: z.string().min(1).optional(),
  clientName: z.string().max(200).optional(),
  includeSuggestions: z.boolean().optional(),
  confirm: z.boolean().optional(),
})

// POST /api/quotes/generate — assemble a quote proposal from repair operations.
// Confirmation-gated: without confirm:true it returns a preview and never writes;
// with confirm:true it persists a draft Quote.
export const POST = withAuth(async (req) => {
  const session = await requireSession()
  const garageId = session.user.garageId

  const rl = rateLimit(`quote-gen:${garageId}`, 30, 60)
  if (!rl.ok) {
    return NextResponse.json({ error: `Trop de requêtes. Réessayez dans ${rl.retryAfter}s.` }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })
  }

  const parsed = BodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Requête invalide', details: parsed.error.flatten() }, { status: 400 })
  const body = parsed.data

  // De-duplicate (a repeated type would double-count labour + parts) and use
  // hasOwnProperty so inherited keys like "toString"/"constructor" are rejected.
  const validTypes = Array.from(new Set(body.repairTypes)).filter(
    (t): t is keyof typeof REPAIR_TYPES => Object.prototype.hasOwnProperty.call(REPAIR_TYPES, t),
  )
  if (validTypes.length === 0) return NextResponse.json({ error: 'Aucun type de réparation reconnu.' }, { status: 400 })

  const [garage, repairTypeParts, parts] = await Promise.all([
    prisma.garage.findUnique({ where: { id: garageId }, select: { hourlyRate: true, taxRate: true, currency: true } }),
    prisma.repairTypePart.findMany({
      where: { garageId, repairType: { in: validTypes } },
      select: { repairType: true, defaultQty: true, part: { select: { name: true, reference: true, unitPrice: true, unitCost: true } } },
    }),
    prisma.part.findMany({ where: { garageId }, select: { name: true, reference: true, unitPrice: true }, take: 5000 }),
  ])

  // Default parts (BOM) grouped by repair type.
  const partsByType = new Map<string, QuoteOperation['parts']>()
  for (const rtp of repairTypeParts) {
    if (!rtp.part) continue
    const list = partsByType.get(rtp.repairType) ?? []
    list!.push({
      name: rtp.part.name,
      reference: rtp.part.reference,
      unitPrice: rtp.part.unitPrice,
      unitCost: rtp.part.unitCost,
      quantity: rtp.defaultQty,
    })
    partsByType.set(rtp.repairType, list)
  }

  const operations: QuoteOperation[] = validTypes.map((t) => ({
    repairType: t,
    label: REPAIR_TYPES[t].label,
    laborMinutes: REPAIR_TYPES[t].defaultDuration,
    parts: partsByType.get(t) ?? [],
  }))

  // Forgotten-parts suggestions (priced from the garage catalogue).
  let suggestions: QuoteSuggestionInput[] = []
  if (body.includeSuggestions !== false) {
    const catalog = new Map<string, number>()
    for (const p of parts) {
      if (p.name) catalog.set(p.name.toLowerCase(), p.unitPrice)
      if (p.reference) catalog.set(p.reference.toLowerCase(), p.unitPrice)
    }
    const partsOnJob = operations.flatMap((o) => (o.parts ?? []).map((p) => ({ name: p.name, reference: p.reference })))
    const recs = forgottenPartsEngine.analyze({
      operations: operations.map((o) => o.label),
      partsOnJob,
      catalog,
      currency: garage?.currency ?? 'EUR',
    })
    suggestions = recs.map((r) => ({
      name: r.name,
      reference: r.reference ?? null,
      unitPrice: r.estimatedImpact.unitPrice,
      quantity: r.estimatedImpact.qty,
      reason: r.justification,
    }))
    // Drop any suggestion that overlaps a part already on the quote — the
    // engine's exact-name dedup misses brand/variant-named BOM parts.
    const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
    const jobNames = operations.flatMap((o) => (o.parts ?? []).map((p) => norm(p.name))).filter(Boolean)
    suggestions = suggestions.filter((s) => {
      const n = norm(s.name)
      return n.length > 0 && !jobNames.some((jn) => jn.includes(n) || n.includes(jn))
    })
  }

  const proposal = generateQuote(operations, suggestions, {
    laborRatePerHour: body.laborRatePerHour ?? garage?.hourlyRate ?? 60,
    vatRate: body.vatRate ?? garage?.taxRate ?? 20,
    currency: garage?.currency ?? 'EUR',
  })

  // Resolve client / vehicle snapshot (read-only).
  let vehicle: { id: string; model: string | null; plate: string | null; clientId: string | null } | null = null
  if (body.vehicleId) {
    const v = await prisma.vehicle.findFirst({ where: { id: body.vehicleId, garageId }, select: { id: true, make: true, model: true, licensePlate: true, clientId: true } })
    if (v) vehicle = { id: v.id, model: `${v.make} ${v.model}`.trim(), plate: v.licensePlate, clientId: v.clientId }
  } else if (body.licensePlate) {
    const v = await prisma.vehicle.findFirst({ where: { garageId, licensePlate: body.licensePlate }, select: { id: true, make: true, model: true, licensePlate: true, clientId: true } })
    if (v) vehicle = { id: v.id, model: `${v.make} ${v.model}`.trim(), plate: v.licensePlate, clientId: v.clientId }
  }
  // Resolve the client garage-scoped: a clientId that does not belong to this
  // garage is dropped (never linked), mirroring the vehicle handling above.
  let resolvedClientId: string | null = null
  let clientName = body.clientName ?? ''
  const requestedClientId = body.clientId ?? vehicle?.clientId ?? null
  if (requestedClientId) {
    const c = await prisma.client.findFirst({ where: { id: requestedClientId, garageId }, select: { id: true, name: true } })
    if (c) {
      resolvedClientId = c.id
      if (!clientName) clientName = c.name
    }
    // foreign / unknown id → resolvedClientId stays null; a free-text clientName is kept.
  }

  // Preview unless explicitly confirmed.
  if (!body.confirm) {
    return NextResponse.json({ confirmationRequired: true, proposal, vehicle, client: { id: resolvedClientId, name: clientName } })
  }

  const issueDate = format(new Date(), 'yyyy-MM-dd')
  const year = new Date(issueDate).getFullYear()

  const quote = await prisma.$transaction(async (tx) => {
    const g = await tx.garage.update({ where: { id: garageId }, data: { quoteCounter: { increment: 1 } } })
    const number = `${g.quotePrefix}-${year}-${String(g.quoteCounter).padStart(3, '0')}`
    return tx.quote.create({
      data: {
        number,
        garageId,
        clientId: resolvedClientId,
        vehicleId: vehicle?.id ?? null,
        clientName,
        vehicleModel: vehicle?.model ?? null,
        licensePlate: vehicle?.plate ?? null,
        status: 'draft',
        issueDate,
        taxRate: proposal.totals.vatRate,
        notes: 'Devis généré automatiquement (à vérifier).',
        lines: {
          create: proposal.lines.map((l, i) => ({
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            unitCost: l.unitCost,
            isLabor: l.isLabor,
            sortOrder: i,
          })),
        },
      },
      include: { lines: { orderBy: { sortOrder: 'asc' } } },
    })
  })

  await logAudit({ action: 'create', entityType: 'Quote', entityId: quote.id, session, req, details: { generated: true, repairTypes: validTypes, totalTTC: proposal.totals.totalTTC } })

  return NextResponse.json({ quote, proposal }, { status: 201 })
})
