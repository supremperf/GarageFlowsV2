/**
 * Remontée POSTE → CLOUD des factures.
 *
 * Le portail client lit des factures réelles ; l'e-facturation part de la
 * facture présente côté PostgreSQL. Sans cette voie, une facture émise au
 * comptoir n'existait que dans le SQLite du poste, et le client consultait un
 * portail vide.
 *
 * ── Fenêtre et curseur ──────────────────────────────────────────────────────
 * On ne remonte pas l'historique complet à chaque passage. Le curseur est en
 * mémoire, par garage : au premier passage après un démarrage, on repart d'une
 * FENÊTRE (30 jours) plutôt que du néant. Republier n'a aucun effet de bord —
 * la route est idempotente — mais republier dix ans de facturation à chaque
 * relance serait un gaspillage, pas une garantie.
 *
 * La contrepartie est assumée : une facture ANCIENNE modifiée après un
 * redémarrage sort de la fenêtre et ne remonte pas d'elle-même. Elle remontera
 * dès qu'une action la touchera à nouveau, ou par une republication explicite.
 * C'est une limite connue, pas un oubli.
 *
 * ── Ce qui n'est PAS fait ici ───────────────────────────────────────────────
 * Aucun mouvement de stock n'est propagé : l'inventaire appartient au poste.
 * Voir l'en-tête de /api/sync/invoice.
 *
 * Tout est BEST-EFFORT : une panne réseau ne bloque jamais le comptoir.
 */
import { prisma } from '@/lib/db'
import { cloudPost, isDesktopInstance, garageLicenseToken } from '@/lib/sync/cloud-client'
import { logger } from '@/lib/logger'

/** Tranche par passage — doit rester ≤ MAX_FACTURES de la route. */
const TRANCHE = 50

/** Fenêtre de rattrapage au premier passage suivant un démarrage. */
const FENETRE_MS = 30 * 24 * 3600 * 1000

/**
 * Recul du curseur : deux factures enregistrées à la même milliseconde, dont une
 * seule confirmée, seraient sinon sautées définitivement.
 */
const RECUL_MS = 60_000

/** Dernier `updatedAt` confirmé par le cloud, par garage. */
const curseurs = new Map<string, Date>()

export interface InvoiceSyncResult {
  skipped?: boolean
  /** Factures présentées au cloud lors de ce passage. */
  envoyees: number
  /** Factures que le cloud déclare avoir écrites. */
  appliquees: number
  /** Factures explicitement refusées, avec leur motif. */
  refusees: Array<{ id: string; code: string }>
  resteAPuiser: boolean
  code?: string
}

const vide = (over: Partial<InvoiceSyncResult> = {}): InvoiceSyncResult =>
  ({ envoyees: 0, appliquees: 0, refusees: [], resteAPuiser: false, ...over })

/** Remonte les factures modifiées depuis le dernier passage confirmé. */
export async function pushGarageInvoices(garageId: string): Promise<InvoiceSyncResult> {
  if (!isDesktopInstance()) return vide({ skipped: true })
  if (!garageId) return vide({ code: 'NO_GARAGE' })

  try {
    const licence = await garageLicenseToken(garageId)
    if (!licence) return vide({ code: 'NO_LICENSE' })

    const depuis = curseurs.get(garageId) ?? new Date(Date.now() - FENETRE_MS)

    const factures = await prisma.invoice.findMany({
      where: { garageId, updatedAt: { gt: depuis } },
      orderBy: { updatedAt: 'asc' },
      take: TRANCHE,
      select: {
        id: true, number: true, status: true, issueDate: true, dueDate: true,
        notes: true, taxRate: true, jobId: true, quoteId: true, stockCommittedAt: true,
        clientName: true, clientEmail: true, clientPhone: true, clientAddress: true,
        vehicleModel: true, licensePlate: true, updatedAt: true,
        lines: {
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true, description: true, quantityTenThousandths: true,
            unitPriceTenThousandths: true, unitCostTenThousandths: true,
            isLabor: true, sortOrder: true,
          },
        },
      },
    })
    if (factures.length === 0) return vide()

    const reponse = await cloudPost('/api/sync/invoice', {
      garageLicense: licence,
      invoices: factures.map((f) => ({
        ...f,
        stockCommittedAt: f.stockCommittedAt ? f.stockCommittedAt.toISOString() : null,
        updatedAt: undefined,
      })),
    })
    if (!reponse.ok) return vide({ envoyees: factures.length, code: reponse.code ?? 'REFUSED' })

    const appliquees = Array.isArray(reponse.data?.applied) ? (reponse.data.applied as string[]) : []
    const refusees = Array.isArray(reponse.data?.rejected)
      ? (reponse.data.rejected as Array<{ id: string; code: string }>)
      : []

    // Le curseur n'avance que sur ce que le cloud a RÉELLEMENT écrit. Une
    // facture refusée doit repasser au prochain tour, pas être oubliée.
    const confirmees = new Set(appliquees)
    const dernier = factures
      .filter((f) => confirmees.has(f.id))
      .reduce<Date | null>((max, f) => (!max || f.updatedAt > max ? f.updatedAt : max), null)
    if (dernier) curseurs.set(garageId, new Date(dernier.getTime() - RECUL_MS))

    if (refusees.length) {
      logger.warn('[sync/invoice] factures refusées par le cloud', {
        garage: garageId.slice(0, 8),
        motifs: refusees.slice(0, 5).map((r) => r.code).join(', '),
      })
    }

    return {
      envoyees: factures.length,
      appliquees: appliquees.length,
      refusees,
      // Tranche pleine : il reste probablement à puiser.
      resteAPuiser: factures.length === TRANCHE && appliquees.length > 0,
    }
  } catch (err) {
    logger.error('[sync/invoice] échec de la remontée', err)
    return vide({ code: 'INFRA' })
  }
}

/** Réinitialise le curseur d'un garage — réservé aux tests. */
export function resetInvoiceCursor(garageId?: string): void {
  if (garageId) curseurs.delete(garageId)
  else curseurs.clear()
}
