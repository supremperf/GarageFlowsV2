/**
 * Construction de l'INSTANTANÉ portail client.
 *
 * Même contenu que la réponse de `GET /api/portal/[token]` — un seul endroit
 * décide de ce que le client voit, donc un seul endroit à auditer. Le filtrage
 * de sécurité est identique : sélection explicite des colonnes, JAMAIS
 * `unitCost` (coût d'achat / marge du garage).
 *
 * Sert à publier vers le cloud le portail d'une intervention qui n'existe que
 * dans le SQLite d'un poste (cf. src/app/api/sync/portal/route.ts).
 */
import { prisma } from '@/lib/db'
import { calcTotalHT, calcTotalTTC, roundCents } from '@/lib/billing'
import { billingLines, salesLinesToEuros } from '@/lib/money-db'
import { readPhotoAsDataUrl } from '@/lib/photo-store'

/** Bornes de publication — évite d'envoyer 200 Mo de photos au serveur. */
const MAX_PHOTOS = 24
const MAX_PHOTO_BYTES = 400 * 1024

export interface PortalSnapshotResult {
  payload: Record<string, unknown>
  /** Photos écartées faute de place — signalé, jamais silencieux. */
  photosOmitted: number
}

/**
 * Construit le contenu portail d'une intervention DU GARAGE DONNÉ.
 * Renvoie null si l'intervention n'appartient pas à ce garage (isolation).
 */
export async function buildPortalSnapshot(jobId: string, garageId: string): Promise<PortalSnapshotResult | null> {
  const job = await prisma.job.findFirst({
    where: { id: jobId, garageId },
    include: {
      mechanic: { select: { name: true, avatar: true, color: true } },
      photos: { select: { id: true, phase: true, caption: true, base64: true, photoPath: true, createdAt: true } },
      quotes: {
        where: { status: { not: 'draft' } },
        include: {
          lines: {
            select: { id: true, description: true, quantityTenThousandths: true, unitPriceTenThousandths: true, isLabor: true, sortOrder: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
      garage: { select: { name: true, phone: true, email: true, logoBase64: true, logoPath: true } },
    },
  })
  if (!job) return null

  const rawQuote = job.quotes[0] ?? null
  const quote = rawQuote
    ? {
        ...rawQuote,
        // Même contrat que GET /api/portal/[token] : entiers exacts + dérivés
        // euros/unités. L'instantané est SERVI TEL QUEL au client — s'il ne
        // porte pas `quantity`/`unitPrice`, la page portail plante.
        lines: salesLinesToEuros(rawQuote.lines),
        totalHT:  roundCents(calcTotalHT(billingLines(rawQuote.lines))),
        totalTTC: roundCents(calcTotalTTC(billingLines(rawQuote.lines), rawQuote.taxRate)),
      }
    : null

  // Les photos stockées sur disque doivent être INLINÉES : le cloud n'a pas
  // accès au dossier local du poste.
  let photosOmitted = 0
  const photos: Array<Record<string, unknown>> = []
  for (const p of job.photos) {
    if (photos.length >= MAX_PHOTOS) { photosOmitted++; continue }
    const base64 = p.base64 || readPhotoAsDataUrl(p.photoPath, MAX_PHOTO_BYTES)
    if (!base64) { photosOmitted++; continue }
    photos.push({ id: p.id, phase: p.phase, caption: p.caption, base64, photoPath: null, createdAt: p.createdAt })
  }

  return {
    photosOmitted,
    payload: {
      customerName: job.customerName,
      vehicleModel: job.vehicleModel,
      licensePlate: job.licensePlate,
      status: job.status,
      date: job.date,
      startTime: job.startTime,
      repairType: job.repairType,
      notes: job.notes,
      mechanic: job.mechanic,
      photos,
      quote,
      garage: {
        ...job.garage,
        // Le portail est public : /api/photos est authentifié, on inline.
        logoBase64: job.garage?.logoBase64 ?? readPhotoAsDataUrl(job.garage?.logoPath),
        logoPath: null,
      },
    },
  }
}
