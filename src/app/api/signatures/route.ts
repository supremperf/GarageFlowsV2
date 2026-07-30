export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { withAuth, requireSession } from '@/lib/api-helpers'
import { enforceRateLimit } from '@/lib/security/rate-limit'
import { headers } from 'next/headers'
import {
  buildSignableDocument,
  createCertificate,
  isSupportedEntityType,
  resolveSignatureKey,
  verifyCertificate,
  type SignableEntityType,
  type SignatureMeta,
} from '@/lib/signature'

const MAX_SIGNATURE_BYTES = 2_000_000 // ~2 MB base64 — a signature PNG is tiny

const CreateSchema = z.object({
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  signatureData: z.string().min(1).max(MAX_SIGNATURE_BYTES),
  signerName: z.string().trim().min(1).max(200),
  signerRole: z.string().trim().max(50).optional().nullable(),
})

/** Load a signable entity scoped to the garage, with the fields we canonicalize. */
async function loadEntity(
  entityType: SignableEntityType,
  entityId: string,
  garageId: string,
): Promise<Record<string, unknown> | null> {
  if (entityType === 'quote') {
    return prisma.quote.findFirst({
      where: { id: entityId, garageId },
      include: { lines: { orderBy: { sortOrder: 'asc' } } },
    }) as Promise<Record<string, unknown> | null>
  }
  if (entityType === 'invoice') {
    return prisma.invoice.findFirst({
      where: { id: entityId, garageId },
      include: { lines: { orderBy: { sortOrder: 'asc' } } },
    }) as Promise<Record<string, unknown> | null>
  }
  if (entityType === 'work_order') {
    return prisma.workOrder.findFirst({
      where: { id: entityId, garageId },
    }) as Promise<Record<string, unknown> | null>
  }
  return null
}

// POST /api/signatures — seal a signature for a document.
export const POST = withAuth(async (req) => {
  const session = await requireSession()
  const rl = await enforceRateLimit('api', `sign:${session.user.garageId}`, { max: 20, windowSec: 60 })
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Trop de requêtes. Réessayez dans ${rl.retryAfterSec}s.` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
    )
  }

  const parsed = CreateSchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Données invalides', details: parsed.error.flatten() }, { status: 400 })
  }
  const { entityType, entityId, signatureData, signerName, signerRole } = parsed.data

  if (!isSupportedEntityType(entityType)) {
    return NextResponse.json({ error: `Type de document non supporté : ${entityType}` }, { status: 400 })
  }

  const entity = await loadEntity(entityType, entityId, session.user.garageId)
  if (!entity) {
    return NextResponse.json({ error: 'Document introuvable' }, { status: 404 })
  }

  const document = buildSignableDocument(entityType, entity)
  const meta: SignatureMeta = {
    signerName,
    signerRole: signerRole ?? 'client',
    ipAddress: headers().get('x-forwarded-for')?.split(',')[0].trim() ?? null,
    userAgent: headers().get('user-agent'),
    signedAt: new Date().toISOString(),
  }

  const key = resolveSignatureKey()
  const cert = createCertificate(document, signatureData, meta, key)

  const record = await prisma.signature.create({
    data: {
      garageId: session.user.garageId,
      entityType,
      entityId,
      signerName,
      signerRole: meta.signerRole ?? null,
      algorithm: cert.algorithm,
      contentHash: cert.contentHash,
      imageHash: cert.imageHash,
      seal: cert.seal,
      signatureData,
      documentSnapshotJson: cert.documentSnapshot,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      // Pin the stored timestamp to the exact value sealed into the HMAC, so
      // re-verification reconstructs identical metadata.
      signedAt: new Date(meta.signedAt),
    },
    select: { id: true, algorithm: true, contentHash: true, seal: true, signedAt: true },
  })

  return NextResponse.json({ ...record, valid: true }, { status: 201 })
})

// GET /api/signatures?entityType=&entityId= — latest signature + live verification.
export const GET = withAuth(async (req) => {
  const session = await requireSession()
  const { searchParams } = new URL(req.url)
  const entityType = searchParams.get('entityType') ?? ''
  const entityId = searchParams.get('entityId') ?? ''
  if (!entityType || !entityId) {
    return NextResponse.json({ error: 'entityType et entityId requis' }, { status: 400 })
  }
  if (!isSupportedEntityType(entityType)) {
    return NextResponse.json({ error: `Type non supporté : ${entityType}` }, { status: 400 })
  }

  const sig = await prisma.signature.findFirst({
    where: { garageId: session.user.garageId, entityType, entityId },
    orderBy: { signedAt: 'desc' },
  })
  if (!sig) return NextResponse.json({ signed: false })

  const entity = await loadEntity(entityType, entityId, session.user.garageId)
  const key = resolveSignatureKey()

  // Reconstruct the sealed certificate from the stored columns.
  const certForVerify = {
    contentHash: sig.contentHash,
    imageHash: sig.imageHash,
    seal: sig.seal,
    meta: {
      signerName: sig.signerName,
      signerRole: sig.signerRole,
      ipAddress: sig.ipAddress,
      userAgent: sig.userAgent,
      signedAt: sig.signedAt.toISOString(),
    },
  }

  // Re-verify against the CURRENT document → auto-invalidation if it changed.
  const verification = entity
    ? verifyCertificate(buildSignableDocument(entityType, entity), certForVerify, key)
    : { valid: false, reasons: ['entity_deleted'] }

  return NextResponse.json({
    signed: true,
    signature: {
      id: sig.id,
      entityType: sig.entityType,
      entityId: sig.entityId,
      signerName: sig.signerName,
      signerRole: sig.signerRole,
      algorithm: sig.algorithm,
      contentHash: sig.contentHash,
      signedAt: sig.signedAt,
      ipAddress: sig.ipAddress,
    },
    verification,
  })
})
