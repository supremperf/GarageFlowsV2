/**
 * Disponibilité d'un véhicule de prêt — règle unique, partagée par la création
 * et la modification d'une réservation.
 *
 * Le contrôle a d'abord été écrit dans `POST /api/loaner-reservations` seul.
 * `PATCH /api/loaner-reservations/[id]` pouvait alors déplacer une réservation
 * sur une période déjà prise, ou ranimer une réservation annulée qui recouvrait
 * une autre : la garantie « un véhicule, un prêt à la fois » ne tenait que sur
 * un chemin d'écriture sur deux. Une règle métier qui vit dans une seule route
 * n'est pas une règle métier — d'où ce module.
 */

/** Seules les réservations VIVES occupent le véhicule. Rendue ou annulée = libre. */
export const STATUTS_OCCUPANTS = ['reserved', 'active'] as const

import type { Prisma } from '@prisma/client'

/**
 * Client de transaction Prisma. On prend ici le type réel plutôt qu'une
 * interface structurelle : ces deux fonctions s'exécutent TOUJOURS dans une
 * transaction de la base du poste, et leur intérêt tient précisément à ce
 * qu'elles y soient — un client simulé prouverait l'inverse de ce qu'on veut
 * démontrer. Elles sont vérifiées par des tests d'intégration sur base réelle.
 */
type Client = Pick<Prisma.TransactionClient, 'loanerReservation' | '$executeRaw'>

/**
 * Verrou de ligne sur le véhicule, sérialisant les réservations concurrentes du
 * MÊME véhicule (PostgreSQL uniquement — SQLite sérialise déjà les écritures).
 * Sans lui, deux transactions liraient « libre » en même temps, exactement comme
 * la relecture non verrouillante corrigée en GF31-AUD-010.
 *
 * Doit être appelé DANS la transaction, AVANT `findOverlappingReservation`.
 * Interpolation par gabarit balisé (`$executeRaw`) : la valeur passe en
 * paramètre lié, jamais concaténée dans le SQL.
 */
export async function lockLoanerVehicleRow(tx: Client, vehicleId: string): Promise<void> {
  await tx.$executeRaw`SELECT "id" FROM "LoanerVehicle" WHERE "id" = ${vehicleId} FOR UPDATE`
}

const UN_JOUR_MS = 24 * 60 * 60 * 1000

/**
 * Fin d'occupation RÉELLE d'une réservation.
 *
 * L'interface saisit des dates sans heure (`yyyy-MM-dd`) et propose — en
 * chiffrant son prix — le prêt « du 10 au 10 », c'est-à-dire la journée du 10.
 * Pris au pied de la lettre, cet intervalle est de longueur nulle : il ne
 * chevaucherait jamais rien, et le même véhicule serait prêtable deux fois le
 * même jour. On considère donc qu'une période dont les deux bornes coïncident
 * occupe la journée entière.
 *
 * La valeur STOCKÉE n'est pas modifiée : le document continue d'afficher les
 * dates saisies par l'utilisateur. Seul le calcul d'occupation est concerné.
 */
export function finEffective(startDate: Date, endDate: Date): Date {
  return endDate.getTime() === startDate.getTime()
    ? new Date(startDate.getTime() + UN_JOUR_MS)
    : endDate
}

/**
 * Cherche une réservation vive qui chevauche la période demandée.
 *
 * Chevauchement : l'existante commence AVANT la fin demandée ET se termine
 * APRÈS le début demandé. Deux périodes strictement adjacentes (fin = début) ne
 * se chevauchent donc pas — un véhicule rendu le matin est reprêtable le matin.
 *
 * @param exclureId réservation à ignorer (sa propre ligne, lors d'un PATCH)
 */
export async function findOverlappingReservation(
  tx: Client,
  params: { garageId: string; vehicleId: string; startDate: Date; endDate: Date; exclureId?: string },
): Promise<{ id: string; clientName: string } | null> {
  const fin = finEffective(params.startDate, params.endDate)
  const candidates = await tx.loanerReservation.findMany({
    where: {
      garageId: params.garageId,
      vehicleId: params.vehicleId,
      status: { in: [...STATUTS_OCCUPANTS] },
      startDate: { lt: fin },
      // Borne large : une réservation d'un seul jour a `endDate == startDate` en
      // base ; c'est `finEffective` qui lui rend sa journée, filtre appliqué
      // juste après. Sans cette largeur, elle serait exclue par la requête.
      endDate: { gte: params.startDate },
      ...(params.exclureId ? { id: { not: params.exclureId } } : {}),
    },
    select: { id: true, clientName: true, startDate: true, endDate: true },
  })

  const conflit = candidates.find((c) => finEffective(c.startDate, c.endDate).getTime() > params.startDate.getTime())
  return conflit ? { id: conflit.id, clientName: conflit.clientName } : null
}
