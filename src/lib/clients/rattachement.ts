/**
 * Rattachement d'une intervention au CLIENT et au VÉHICULE réels (GF-015).
 *
 * ─── Le défaut ──────────────────────────────────────────────────────────────
 * `POST /api/clients` et `POST /api/vehicles` existaient, corrects — mais AUCUN
 * écran ne les appelait. La seule voie de saisie d'un nouveau client dans le
 * produit est la modale d'intervention, et elle se contentait d'écrire un
 * annuaire parallèle dans le `localStorage` du poste (`gf_clients`), puis de
 * créer une intervention dont le nom du client, le modèle et la plaque sont du
 * TEXTE LIBRE.
 *
 * Conséquences mesurables sur une installation réelle : l'annuaire Clients reste
 * vide quel que soit le nombre d'interventions ; la fiche véhicule ouverte
 * depuis le planning ne trouve rien ; les alertes de contrôle technique ne
 * remontent jamais ; aucun accès portail ne peut être ouvert (il faut un
 * `Client`) ; et toutes les factures portent `clientId = null`.
 *
 * ─── La correction ──────────────────────────────────────────────────────────
 * Le rattachement se fait CÔTÉ SERVEUR, au moment où l'intervention est écrite.
 * C'est le seul endroit qui voit passer TOUTES les créations — modale, import,
 * synchronisation — et le seul où l'opération peut être transactionnelle.
 *
 * Règles, choisies pour ne jamais réécrire une donnée existante :
 *  · sans plaque, on ne crée AUCUN véhicule : la plaque est la seule identité
 *    fiable d'un véhicule, et `Vehicle.clientId` est obligatoire ;
 *  · une plaque déjà connue rattache l'intervention au véhicule EXISTANT et ne
 *    change JAMAIS son propriétaire — un nom saisi différemment ne doit pas
 *    transférer une voiture d'un client à un autre ;
 *  · le client est retrouvé par son nom normalisé (accents, casse, espaces)
 *    avant d'être créé, pour ne pas fabriquer un doublon à chaque variante de
 *    frappe ;
 *  · tout est idempotent : rejouer la même intervention ne crée rien de plus.
 */
import type { PrismaClient } from '@prisma/client'
import { normaliserTexte, normaliserPlaque } from '@/lib/recherche/normalisation'

/**
 * Nombre de lignes examinées au plus lors d'une recherche par forme normalisée.
 * Elle n'a lieu QUE si la correspondance exacte (indexée) a échoué, donc au plus
 * une fois par nouveau client ou nouveau véhicule.
 */
const MAX_BALAYAGE = 5_000

/**
 * Sous-ensemble de Prisma réellement utilisé — le client complet ou une
 * transaction (`Prisma.TransactionClient` porte les mêmes délégués).
 */
export type BaseRattachement = Pick<PrismaClient, 'client' | 'vehicle'>

export interface SaisieIntervention {
  customerName?: string | null
  vehicleModel?: string | null
  licensePlate?: string | null
}

export interface Rattachement {
  clientId: string | null
  vehicleId: string | null
  /** Ce que l'opération a réellement créé — utile aux journaux et aux tests. */
  creations: { client: boolean; vehicule: boolean }
}

/**
 * Sépare un modèle saisi librement en marque + modèle.
 *
 * « Renault Clio 4 » → marque « Renault », modèle « Clio 4 ». Un seul mot →
 * marque et modèle identiques : `Vehicle.model` est obligatoire, et inventer
 * « (inconnu) » afficherait un libellé que le garage n'a pas écrit.
 */
export function separerMarqueModele(saisie: string | null | undefined): { make: string; model: string } {
  const propre = String(saisie ?? '').trim().replace(/\s+/g, ' ')
  if (!propre) return { make: 'Inconnu', model: 'Inconnu' }
  const [premier, ...reste] = propre.split(' ')
  return { make: premier, model: reste.length ? reste.join(' ') : premier }
}

/** Retrouve un client par son nom (exact puis normalisé), ou le crée. */
async function resoudreClient(
  db: BaseRattachement, garageId: string, nomBrut: string,
): Promise<{ id: string; cree: boolean }> {
  const nom = nomBrut.trim().replace(/\s+/g, ' ')

  const exact = await db.client.findFirst({ where: { garageId, name: nom }, select: { id: true } })
  if (exact) return { id: exact.id, cree: false }

  // La correspondance exacte a échoué : « Lefèvre » et « lefevre » désignent le
  // même client, et fabriquer un doublon rendrait l'annuaire inutilisable.
  const cible = normaliserTexte(nom)
  const candidats = await db.client.findMany({
    where: { garageId }, select: { id: true, name: true }, take: MAX_BALAYAGE,
  })
  const proche = candidats.find((c) => normaliserTexte(c.name) === cible)
  if (proche) return { id: proche.id, cree: false }

  const cree = await db.client.create({ data: { name: nom, garageId } })
  return { id: cree.id, cree: true }
}

/**
 * Rattache une intervention à son client et à son véhicule, en les créant s'ils
 * n'existent pas. Ne lève pas sur une saisie vide : elle rend simplement `null`.
 */
export async function rattacherClientEtVehicule(
  db: BaseRattachement,
  garageId: string,
  saisie: SaisieIntervention,
): Promise<Rattachement> {
  const vide: Rattachement = { clientId: null, vehicleId: null, creations: { client: false, vehicule: false } }

  const nom = String(saisie.customerName ?? '').trim()
  const plaqueBrute = String(saisie.licensePlate ?? '').trim()
  if (!nom && !plaqueBrute) return vide

  // ── Véhicule déjà connu ? ──────────────────────────────────────────────────
  if (plaqueBrute) {
    const plaque = plaqueBrute.toUpperCase()
    const exact = await db.vehicle.findFirst({
      where: { garageId, licensePlate: plaque }, select: { id: true, clientId: true },
    })
    if (exact) {
      // Le propriétaire du véhicule ne change PAS parce qu'un nom a été saisi
      // autrement : ce serait transférer une voiture sur une faute de frappe.
      return { clientId: exact.clientId ?? null, vehicleId: exact.id, creations: { client: false, vehicule: false } }
    }

    // « AB-123-CD » et « AB123CD » sont la même plaque. Sans cette comparaison,
    // chaque variante de frappe créait un véhicule de plus.
    const cible = normaliserPlaque(plaque)
    if (cible) {
      const candidats = await db.vehicle.findMany({
        where: { garageId }, select: { id: true, licensePlate: true, clientId: true }, take: MAX_BALAYAGE,
      })
      const proche = candidats.find((v) => normaliserPlaque(v.licensePlate) === cible)
      if (proche) {
        return { clientId: proche.clientId ?? null, vehicleId: proche.id, creations: { client: false, vehicule: false } }
      }
    }
  }

  // ── Rien de connu : on matérialise ce que le garage vient de saisir ────────
  if (!nom) return vide  // `Vehicle.clientId` est obligatoire : pas de client, pas de véhicule.

  const client = await resoudreClient(db, garageId, nom)
  if (!plaqueBrute) {
    return { clientId: client.id, vehicleId: null, creations: { client: client.cree, vehicule: false } }
  }

  const { make, model } = separerMarqueModele(saisie.vehicleModel)
  const vehicule = await db.vehicle.create({
    data: { licensePlate: plaqueBrute.toUpperCase(), make, model, clientId: client.id, garageId },
  })
  return { clientId: client.id, vehicleId: vehicule.id, creations: { client: client.cree, vehicule: true } }
}
