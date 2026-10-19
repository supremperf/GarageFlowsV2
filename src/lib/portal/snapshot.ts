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

/**
 * Budget TOTAL des photos inlinées, aligné sur le récepteur.
 *
 * `POST /api/sync/portal` refuse tout instantané dépassant 4 Mio sérialisés
 * (`MAX_PAYLOAD_BYTES`). Or les bornes de ce module autorisaient 24 photos de
 * 400 Kio, soit 9,6 Mio bruts — près de 13 Mio une fois en base64. Le plafond
 * par photo était de surcroît CONTOURNÉ dès que la photo venait de la colonne
 * `base64` : la borne ne s'appliquait qu'à la relecture disque. Et c'est le cas
 * NORMAL — toute photo de mécanicien arrive sur le poste avec `photoPath: null`
 * et un base64 plein, plafonné seulement à 8 Mo décodés.
 *
 * Conséquence mesurable : une SEULE photo de mécanicien de 3 Mo produisait un
 * 413 systématique, et la fonction portail devenait définitivement indisponible
 * pour cette intervention — sous un message qui imputait le blocage au réseau.
 *
 * La marge sous les 4 Mio couvre le reste de l'instantané (devis, logo, texte).
 */
const MAX_PHOTOS_TOTAL_BYTES = 3 * 1024 * 1024 + 512 * 1024

/**
 * Poids de l'IMAGE portée par une data-URL, en octets.
 *
 * Le base64 encode trois octets sur quatre caractères ; le préfixe
 * `data:…;base64,` et le remplissage `=` final n'appartiennent pas à l'image.
 */
function octetsDecodes(dataUrl: string): number {
  const virgule = dataUrl.indexOf(',')
  const corps = virgule >= 0 ? dataUrl.slice(virgule + 1) : dataUrl
  const remplissage = corps.endsWith('==') ? 2 : corps.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((corps.length * 3) / 4) - remplissage)
}

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
  let octetsPhotos = 0
  const photos: Array<Record<string, unknown>> = []
  for (const p of job.photos) {
    if (photos.length >= MAX_PHOTOS) { photosOmitted++; continue }

    // La borne PAR PHOTO s'applique aux deux origines. Elle ne portait que sur
    // la relecture disque, laissant passer sans contrôle la colonne `base64`.
    // Elle se mesure sur les octets DÉCODÉS des deux côtés : `readPhotoAsDataUrl`
    // borne la taille du fichier, donc l'image ; comparer ici la longueur
    // ENCODÉE rendrait la même borne un tiers plus sévère sur ce chemin.
    const enLigne = p.base64 && octetsDecodes(p.base64) <= MAX_PHOTO_BYTES
      ? p.base64
      : null
    const base64 = enLigne || readPhotoAsDataUrl(p.photoPath, MAX_PHOTO_BYTES)
    if (!base64) { photosOmitted++; continue }

    // Budget GLOBAL : c'est lui qui garantit que le récepteur acceptera. Sans
    // lui, l'instantané partait, était refusé en bloc (413), et le portail
    // devenait inutilisable pour l'intervention entière.
    const taille = Buffer.byteLength(base64, 'utf8')
    if (octetsPhotos + taille > MAX_PHOTOS_TOTAL_BYTES) { photosOmitted++; continue }
    octetsPhotos += taille

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
