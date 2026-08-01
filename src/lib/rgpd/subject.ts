/**
 * Mécanismes RGPD — droit d'accès/portabilité et droit à l'effacement, pour une
 * personne concernée (le CLIENT du garage). Toutes les opérations sont ISOLÉES
 * par garageId.
 *
 * Effacement = ANONYMISATION, pas suppression brute : les documents comptables
 * (factures, devis) doivent être CONSERVÉS (obligation légale de conservation),
 * mais leurs données personnelles sont neutralisées. Le compte portail (accès)
 * est, lui, supprimé. Ce choix respecte à la fois le droit à l'effacement et les
 * obligations de conservation ; il reste à VALIDER PAR UN JURISTE (voir
 * docs/RGPD_DATA_MAPPING.md).
 */
import { prisma } from '@/lib/db'

export const ANON_NAME = '[Personne anonymisée – RGPD]'
export const ANON_PLATE = 'ANONYMISÉ'

export interface SubjectExport {
  exportedAt: string
  garageId: string
  client: unknown
  vehicles: unknown[]
  quotes: unknown[]
  invoices: unknown[]
  reminders: unknown[]
  appointments: unknown[]
  portalUsers: unknown[]
}

/**
 * Export complet des données personnelles d'un client (droit d'accès /
 * portabilité). Renvoie null si le client n'appartient pas au garage.
 */
export async function exportSubject(garageId: string, clientId: string): Promise<SubjectExport | null> {
  const client = await prisma.client.findFirst({ where: { id: clientId, garageId } })
  if (!client) return null
  const where = { clientId, garageId }
  const [vehicles, quotes, invoices, reminders, appointments, portalUsers] = await Promise.all([
    prisma.vehicle.findMany({ where }),
    prisma.quote.findMany({ where }),
    prisma.invoice.findMany({ where }),
    prisma.reminder.findMany({ where }),
    prisma.appointment.findMany({ where }),
    // Le compte portail ne renvoie jamais le hash de mot de passe ni les secrets 2FA.
    prisma.portalUser.findMany({ where, select: { id: true, email: true, name: true, createdAt: true } }),
  ])
  return {
    exportedAt: new Date().toISOString(), garageId,
    client, vehicles, quotes, invoices, reminders, appointments, portalUsers,
  }
}

export interface EraseReport {
  ok: boolean
  anonymized: Record<string, number>
  deleted: Record<string, number>
  error?: string
}

/**
 * Effacement RGPD : anonymise les données personnelles liées au client tout en
 * CONSERVANT les documents comptables (montants/lignes intacts), et supprime le
 * compte portail. Transactionnel, scopé garageId.
 */
export async function eraseSubject(garageId: string, clientId: string): Promise<EraseReport> {
  const client = await prisma.client.findFirst({ where: { id: clientId, garageId } })
  if (!client) return { ok: false, anonymized: {}, deleted: {}, error: 'Client introuvable' }
  const where = { clientId, garageId }

  return prisma.$transaction(async (tx) => {
    const anonymized: Record<string, number> = {}
    anonymized.vehicles = (await tx.vehicle.updateMany({ where, data: { licensePlate: ANON_PLATE, vin: null, notes: null, color: null } })).count
    anonymized.quotes = (await tx.quote.updateMany({ where, data: { clientName: ANON_NAME, clientEmail: null, clientPhone: null, clientAddress: null, licensePlate: null } })).count
    anonymized.invoices = (await tx.invoice.updateMany({ where, data: { clientName: ANON_NAME, clientEmail: null, clientPhone: null, clientAddress: null, licensePlate: null } })).count
    anonymized.reminders = (await tx.reminder.updateMany({ where, data: { clientName: ANON_NAME, phone: null, email: null, licensePlate: null } })).count
    anonymized.appointments = (await tx.appointment.updateMany({ where, data: { clientName: ANON_NAME, licensePlate: null } })).count

    // Le compte portail (accès) est SUPPRIMÉ (identifiant/authentification).
    const deleted = { portalUsers: (await tx.portalUser.deleteMany({ where }).then(r => r.count)) }

    // Le client est anonymisé (la ligne subsiste pour l'intégrité des documents conservés).
    await tx.client.update({ where: { id: clientId }, data: { name: ANON_NAME, phone: null, email: null, address: null } })
    anonymized.client = 1

    return { ok: true, anonymized, deleted }
  })
}
