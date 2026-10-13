export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { prisma } from '@/lib/db'
import { buildSignableDocument } from '@/lib/signature/document'
import { createCertificate, verifyCertificate } from '@/lib/signature/seal'
import type { SignatureMeta } from '@/lib/signature/types'
import { resolveSignatureKey } from '@/lib/signature/key'
import { jwtVerify } from 'jose'
import { calcTotalHT, calcTotalTTC, roundCents } from '@/lib/billing'
import { billingLines, salesLinesToEuros } from '@/lib/money-db'
import { portalSecret } from '@/lib/portal-secret'
import { readPhotoAsDataUrl } from '@/lib/photo-store'

// GET — return quote data
export async function GET(_req: Request, { params }: { params: { token: string } }) {
  try {
    const { payload } = await jwtVerify(params.token, portalSecret())
    if (payload.typ !== 'quote-sign' || typeof payload.quoteId !== 'string') {
      return NextResponse.json({ error: 'Token invalide' }, { status: 403 })
    }

    const quote = await prisma.quote.findFirst({
      where: typeof payload.garageId === 'string'
        ? { id: payload.quoteId, garageId: payload.garageId }
        : { id: payload.quoteId },
      include: {
        // SÉCURITÉ : ne JAMAIS exposer unitCost (coût d'achat/marge du garage) au
        // client — select explicite limité aux champs nécessaires à l'affichage
        // et au calcul des totaux (calcTotalHT/TTC : quantity + unitPrice).
        lines: {
          orderBy: { sortOrder: 'asc' },
          select: { id: true, description: true, quantityTenThousandths: true, unitPriceTenThousandths: true, isLabor: true, sortOrder: true },
        },
        garage: { select: { name: true, phone: true, email: true, address: true, siret: true, logoBase64: true, logoPath: true, taxRate: true, invoiceFooter: true } },
      },
    })
    if (!quote) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })

    const totalHT  = roundCents(calcTotalHT(billingLines(quote.lines)))
    const totalTTC = roundCents(calcTotalTTC(billingLines(quote.lines), quote.taxRate))
    const alreadySigned = ['accepted', 'refused', 'converted'].includes(quote.status)

    // Lignes : entiers exacts + dérivés euros (quantity/unitPrice) pour l'affichage
    // portail. Le coût d'achat n'est jamais exposé au client. Helper PARTAGÉ avec
    // les autres producteurs portail — c'est la duplication de cette dérivation
    // qui avait laissé /api/portal/[token] et l'instantané poste en arrière.
    const lines = salesLinesToEuros(quote.lines)
    // Page publique : /api/photos est authentifié, on inline donc le logo
    // stocké sur disque (cf. src/lib/photo-store.ts).
    const garage = {
      ...quote.garage,
      logoBase64: quote.garage?.logoBase64 ?? readPhotoAsDataUrl(quote.garage?.logoPath),
    }

    // ── PREUVE : un statut n'est pas un accord (§74) ──────────────────────────
    // Le portail affichait « Devis accepté » sur la seule foi du statut, que le
    // garage peut poser lui-même. On distingue désormais les deux, et l'on
    // REVÉRIFIE que la preuve porte bien sur le document affiché aujourd'hui :
    // une preuve dont l'empreinte ne correspond plus n'est pas présentée comme
    // valide.
    const preuveBrute = await prisma.signature.findFirst({
      where: { garageId: quote.garageId, entityType: 'quote', entityId: quote.id, invalidatedAt: null },
      orderBy: { signedAt: 'desc' },
    })
    let acceptation: {
      signedAt: string
      contentHash: string
      matchesCurrentDocument: boolean
      signerName: string
    } | null = null
    if (preuveBrute) {
      let correspond = false
      try {
        // Le document signé se reconstruit sur les MÊMES champs qu'à la
        // signature — coût d'achat compris. Les lignes servies au client en sont
        // volontairement privées (marge du garage) : les réutiliser telles
        // quelles donnerait une empreinte différente et ferait passer une preuve
        // valide pour périmée.
        const lignesCompletes = await prisma.quoteLine.findMany({
          where: { quoteId: quote.id },
          orderBy: { sortOrder: 'asc' },
        })
        const doc = buildSignableDocument('quote', {
          ...quote,
          lines: lignesCompletes,
        } as unknown as Record<string, unknown>)
        correspond = verifyCertificate(
          doc,
          {
            contentHash: preuveBrute.contentHash,
            imageHash: preuveBrute.imageHash,
            seal: preuveBrute.seal,
            meta: {
              signerName: preuveBrute.signerName,
              signerRole: preuveBrute.signerRole,
              ipAddress: preuveBrute.ipAddress,
              userAgent: preuveBrute.userAgent,
              signedAt: preuveBrute.signedAt.toISOString(),
            },
          },
          resolveSignatureKey(),
        ).valid
      } catch {
        correspond = false
      }
      acceptation = {
        signedAt: preuveBrute.signedAt.toISOString(),
        contentHash: preuveBrute.contentHash,
        matchesCurrentDocument: correspond,
        signerName: preuveBrute.signerName,
      }
    }

    return NextResponse.json({
      ...quote,
      garage,
      lines,
      totalHT,
      totalTTC,
      alreadySigned,
      // `null` = statut posé côté garage, sans accord client enregistré.
      acceptation,
    })
  } catch {
    return NextResponse.json({ error: 'Token invalide ou expiré' }, { status: 403 })
  }
}

// POST — sign (accept or refuse)
export async function POST(req: Request, { params }: { params: { token: string } }) {
  try {
    const { payload } = await jwtVerify(params.token, portalSecret())
    if (payload.typ !== 'quote-sign' || typeof payload.quoteId !== 'string') {
      return NextResponse.json({ error: 'Token invalide' }, { status: 403 })
    }

    const { action } = await req.json()  // 'accept' | 'refuse'
    if (!['accept', 'refuse'].includes(action)) {
      return NextResponse.json({ error: 'Action invalide' }, { status: 400 })
    }

    const quote = await prisma.quote.findFirst({
      where: typeof payload.garageId === 'string'
        ? { id: payload.quoteId, garageId: payload.garageId }
        : { id: payload.quoteId },
      include: { lines: { orderBy: { sortOrder: 'asc' } } },
    })
    if (!quote) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })
    if (['accepted', 'refused', 'converted'].includes(quote.status)) {
      return NextResponse.json({ error: 'Ce devis a déjà été traité' }, { status: 409 })
    }

    // ── PREUVE D'ACCEPTATION (§74) ────────────────────────────────────────────
    //
    // L'accord du client n'était qu'un changement de statut : rien ne le liait
    // au contenu accepté, rien ne le datait, rien ne le distinguait d'un statut
    // posé par le garage lui-même. En cas de litige sur une réparation, il n'y
    // avait donc AUCUNE preuve — ni pour le client, ni pour le garage.
    //
    // On produit un certificat scellé sur le document RÉELLEMENT affiché :
    // empreinte du contenu canonique, horodatage, adresse IP et agent
    // utilisateur, le tout sous HMAC. La possession du lien signé vaut
    // identification du client — c'est ce que le portail garantit.
    //
    // Il n'y a pas d'image de signature ici : le portail propose un bouton, pas
    // un pavé de signature. On ne fabrique donc aucune image (ce serait une
    // preuve inventée) ; la preuve repose sur le contenu et les circonstances.
    const document = buildSignableDocument('quote', quote as unknown as Record<string, unknown>)
    let cert: ReturnType<typeof createCertificate>
    const meta: SignatureMeta = {
      signerName: quote.clientName || 'Client',
      signerRole: 'client',
      ipAddress: headers().get('x-forwarded-for')?.split(',')[0].trim() ?? null,
      userAgent: headers().get('user-agent'),
      signedAt: new Date().toISOString(),
    }
    try {
      cert = createCertificate(document, '', meta, resolveSignatureKey())
    } catch {
      // Sans clé de scellement, on refuse plutôt que d'enregistrer un accord
      // sans preuve : c'est exactement le défaut que l'on corrige.
      return NextResponse.json(
        { error: 'Signature indisponible sur ce serveur : contactez votre garage.', code: 'SIGNATURE_UNAVAILABLE' },
        { status: 503 },
      )
    }

    const newStatus = action === 'accept' ? 'accepted' : 'refused'
    // Revendication de statut ET preuve dans la MÊME transaction : un devis
    // « accepté » sans certificat est structurellement impossible par ce chemin.
    const applique = await prisma.$transaction(async (tx) => {
      const claim = await tx.quote.updateMany({
        where: { id: quote.id, status: { in: ['draft', 'sent'] } },
        data: { status: newStatus },
      })
      if (claim.count === 0) return false
      await tx.signature.create({
        data: {
          garageId: quote.garageId,
          entityType: 'quote',
          entityId: quote.id,
          signerName: meta.signerName,
          signerRole: 'client',
          algorithm: cert.algorithm,
          contentHash: cert.contentHash,
          imageHash: cert.imageHash,
          seal: cert.seal,
          signatureData: '',
          documentSnapshotJson: cert.documentSnapshot,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
          signedAt: new Date(meta.signedAt),
        },
      })
      return true
    })
    if (!applique) {
      return NextResponse.json({ error: 'Ce devis a déjà été traité' }, { status: 409 })
    }

    return NextResponse.json({
      ok: true,
      status: newStatus,
      // Le client repart avec de quoi opposer sa décision : date et empreinte
      // du document exact qu'il a accepté.
      proof: { signedAt: meta.signedAt, contentHash: cert.contentHash },
    })
  } catch {
    return NextResponse.json({ error: 'Token invalide ou expiré' }, { status: 403 })
  }
}
