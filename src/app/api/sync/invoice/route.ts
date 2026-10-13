export const dynamic = 'force-dynamic'

/**
 * POST /api/sync/invoice — publication POSTE → CLOUD des factures.
 *
 * ── Pourquoi ────────────────────────────────────────────────────────────────
 * Le portail client lit des factures RÉELLES (`prisma.invoice.findMany`). Une
 * facture émise sur un poste n'y parvenait jamais : la ligne n'existait pas. Le
 * client voyait donc un portail vide alors que son garage lui avait facturé la
 * réparation. La facturation électronique, elle aussi, part de la facture
 * présente côté PostgreSQL.
 *
 * ── L'autorité du STOCK reste au POSTE ──────────────────────────────────────
 * C'est le point délicat. `Invoice.stockCommittedAt` est le verrou
 * d'idempotence du décrément définitif, et chaque `InvoiceLine.partId` désigne
 * une pièce de l'inventaire LOCAL.
 *
 *   · aucun `StockMovement` n'est créé ici — le cloud n'est pas un second
 *     comptable, et deux décréments pour une seule vente seraient la pire des
 *     régressions ;
 *   · `partId` est mis à NULL : la pièce n'est pas publiée, la clé étrangère
 *     pointerait dans le vide. La désignation reste sur la ligne, c'est elle
 *     que le client lit ;
 *   · `stockCommittedAt` est en revanche recopié VERBATIM : c'est un fait daté,
 *     et le masquer laisserait croire qu'une facture n'a jamais engagé le stock.
 *
 * ── Garanties ────────────────────────────────────────────────────────────────
 * Identiques à /api/sync/quote : identité par licence GARAGE GF2, `garageId`
 * issu de la LICENCE, identifiant du poste réutilisé, écriture transactionnelle,
 * idempotence, et refus explicite plutôt qu'écrasement silencieux.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { authenticateGarageLicense, shortId } from '@/lib/sync/garage-auth'
import { clientIpFrom, enforceRateLimit, rateLimitResponse } from '@/lib/security/rate-limit'
import { logger } from '@/lib/logger'

const FAILURE_STATUS: Record<string, number> = {
  MISSING_LICENSE: 400, LICENSE_INVALID: 403, NOT_A_GARAGE_LICENSE: 403,
  LICENSE_UNKNOWN: 403, LICENSE_REVOKED: 403, LICENSE_SUSPENDED: 403,
  LICENSE_EXPIRED: 403, GARAGE_MISMATCH: 403,
  GARAGE_ALREADY_CLAIMED: 409, LICENSE_NOT_BOUND: 409,
}

/** Factures par envoi, et lignes par facture. Bornes de bon sens. */
const MAX_FACTURES = 50
const MAX_LIGNES = 200

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')
const strOrNull = (v: unknown, max: number): string | null => {
  const s = typeof v === 'string' ? v.trim().slice(0, max) : ''
  return s === '' ? null : s
}
const entier = (v: unknown, defaut = 0): number => (Number.isSafeInteger(v) ? (v as number) : defaut)
const dateOrNull = (v: unknown): Date | null => {
  if (typeof v !== 'string') return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

export async function POST(req: Request) {
  const rl = await enforceRateLimit('license_status', clientIpFrom(req))
  if (!rl.ok) return rateLimitResponse(rl)

  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 })
  }

  const auth = await authenticateGarageLicense(body.garageLicense, null)
  if (!auth.ok) {
    logger.warn('[sync/invoice] refus auth', { code: auth.code })
    return NextResponse.json({ ok: false, code: auth.code }, { status: FAILURE_STATUS[auth.code] ?? 403 })
  }
  const garageId = auth.garageId as string

  const brutes = Array.isArray(body.invoices) ? body.invoices : []
  if (brutes.length === 0) {
    return NextResponse.json({ ok: true, applied: [], rejected: [] })
  }
  if (brutes.length > MAX_FACTURES) {
    return NextResponse.json({ ok: false, code: 'TOO_MANY_INVOICES' }, { status: 422 })
  }

  const applied: string[] = []
  const rejected: Array<{ id: string; code: string }> = []

  try {
    for (const brute of brutes) {
      const f = (brute ?? {}) as Record<string, unknown>
      const lignesBrutes = Array.isArray(f.lines) ? f.lines : []
      const id = str(f.id, 64)
      const number = str(f.number, 64)
      const issueDate = str(f.issueDate, 10)

      if (!id || !number || !issueDate) { rejected.push({ id: id || '?', code: 'BAD_REQUEST' }); continue }
      if (lignesBrutes.length > MAX_LIGNES) { rejected.push({ id, code: 'TOO_MANY_LINES' }); continue }

      // Facture d'un autre garage : jamais écrasée.
      const existant = await prisma.invoice.findUnique({
        where: { id }, select: { id: true, garageId: true },
      })
      if (existant && existant.garageId !== garageId) {
        logger.warn('[sync/invoice] refus — facture d’un autre garage', { invoice: shortId(id) })
        rejected.push({ id, code: 'INVOICE_FOREIGN_GARAGE' }); continue
      }

      // `@@unique([garageId, number])` — on le dit plutôt que de laisser Prisma
      // remonter une contrainte opaque.
      const homonyme = await prisma.invoice.findFirst({
        where: { garageId, number, id: { not: id } }, select: { id: true },
      })
      if (homonyme) { rejected.push({ id, code: 'INVOICE_NUMBER_TAKEN' }); continue }

      const jobIdBrut = strOrNull(f.jobId, 64)
      const jobId = jobIdBrut
        ? (await prisma.job.findFirst({ where: { id: jobIdBrut, garageId }, select: { id: true } }))?.id ?? null
        : null

      const donnees = {
        number,
        garageId,
        // Fiches et pièces non publiées : aucune clé pendante (cf. en-tête).
        clientId: null,
        vehicleId: null,
        jobId,
        quoteId: strOrNull(f.quoteId, 64),
        clientName: str(f.clientName, 200),
        clientEmail: strOrNull(f.clientEmail, 200),
        clientPhone: strOrNull(f.clientPhone, 50),
        clientAddress: strOrNull(f.clientAddress, 500),
        vehicleModel: strOrNull(f.vehicleModel, 200),
        licensePlate: strOrNull(f.licensePlate, 32),
        status: str(f.status, 32) || 'draft',
        issueDate,
        dueDate: strOrNull(f.dueDate, 10),
        notes: strOrNull(f.notes, 5000),
        taxRate: typeof f.taxRate === 'number' && Number.isFinite(f.taxRate) ? f.taxRate : 20,
        // Fait daté, recopié tel quel — le cloud ne décrémente RIEN.
        stockCommittedAt: dateOrNull(f.stockCommittedAt),
      }

      const lignes = lignesBrutes.map((l, i) => {
        const o = (l ?? {}) as Record<string, unknown>
        return {
          id: str(o.id, 64) || undefined,
          description: str(o.description, 500),
          // Entiers exacts recopiés VERBATIM : aucun recalcul, donc aucune
          // divergence possible entre le montant du poste et celui du client.
          quantityTenThousandths: entier(o.quantityTenThousandths, 10000),
          unitPriceTenThousandths: entier(o.unitPriceTenThousandths, 0),
          unitCostTenThousandths: entier(o.unitCostTenThousandths, 0),
          isLabor: o.isLabor === true,
          sortOrder: entier(o.sortOrder, i),
          partId: null,
        }
      })

      await prisma.$transaction(async (tx) => {
        if (existant) {
          await tx.invoice.updateMany({ where: { id, garageId }, data: donnees as never })
        } else {
          await tx.invoice.create({ data: { ...donnees, id } as never })
        }
        // Lignes REMPLACÉES : une ligne retirée sur le poste doit disparaître de
        // la facture que lit le client.
        await tx.invoiceLine.deleteMany({ where: { invoiceId: id } })
        if (lignes.length) {
          await tx.invoiceLine.createMany({ data: lignes.map((l) => ({ ...l, invoiceId: id })) as never })
        }
      })
      applied.push(id)
    }

    logger.info('[sync/invoice] factures publiées', {
      garage: shortId(garageId), appliquees: applied.length, refusees: rejected.length,
    })
    return NextResponse.json({ ok: true, applied, rejected })
  } catch (err) {
    logger.error('[sync/invoice] erreur infra', err)
    return NextResponse.json({ ok: false, code: 'INFRA' }, { status: 503 })
  }
}
