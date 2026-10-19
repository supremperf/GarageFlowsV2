/**
 * FILE DE REPRISE des transmissions de facturation électronique.
 *
 * ─── Pourquoi une file, et pourquoi ce n'est pas un « retry » aveugle ───────
 * `envoyerFacture` sait déjà rejouer une transmission qui n'a JAMAIS abouti :
 * la prise exclusive en base empêche deux rejeux concurrents, et le critère
 * décisif est l'absence d'identifiant externe. Ce qui manquait est le
 * DÉCLENCHEUR : après une panne réseau passagère, quelqu'un devait rouvrir
 * l'écran et cliquer. Une facture pouvait rester des jours non déclarée alors
 * que la plateforme était revenue.
 *
 * ─── Ce que la file accepte de reprendre ───────────────────────────────────
 * UNIQUEMENT le statut `error` : la plateforme a répondu un code d'erreur, ou
 * la configuration était inutilisable — dans les deux cas elle n'a pas pris la
 * facture, et le renvoi ne peut pas créer de double déclaration.
 *
 * Elle refuse délibérément :
 *  · `unknown` / `submission_pending` abandonnées — la plateforme a peut-être
 *    reçu la facture ; seul un humain peut trancher (voir `declarerNonParvenue`) ;
 *  · `rejected` — le document a été refusé pour son CONTENU. Le renvoyer tel
 *    quel produirait le même refus, indéfiniment. C'est à l'exploitant de
 *    corriger la facture, puis de la renvoyer explicitement.
 *
 * ─── Le rythme ─────────────────────────────────────────────────────────────
 * Backoff exponentiel borné (5 min, 15 min, 1 h, 4 h, 24 h), cinq tentatives
 * automatiques au maximum. Au-delà, la facture reste en `error` et visible
 * dans l'interface : on cesse de réessayer, on ne cache rien.
 *
 * `tentatives` se lit dans le journal (`EInvoiceEvent`, type `error`) : aucun
 * compteur dénormalisé à maintenir, donc aucun risque de divergence entre le
 * compteur et l'historique réel.
 */

import { serverPrisma } from '@/lib/db'
import { linesToEuros } from '@/lib/money-db'
import { logger } from '@/lib/logger'
import { envoyerFacture, type ResultatEnvoi } from './submit'
import type { EInvoiceEnvironment } from './connection'

/** Délai avant la n-ième reprise (index 0 = après le 1er échec). */
export const BACKOFF_MS = [5 * 60_000, 15 * 60_000, 60 * 60_000, 4 * 3_600_000, 24 * 3_600_000]

/** Nombre maximal de reprises automatiques. */
export const MAX_TENTATIVES = BACKOFF_MS.length

/**
 * Délai à respecter APRÈS le n-ième échec.
 *
 * `tentatives` compte les échecs DÉJÀ enregistrés (1 = un échec) : le premier
 * palier s'applique donc à `tentatives = 1`. Les valeurs hors bornes sont
 * ramenées au palier le plus proche au lieu de produire `undefined` — un
 * `NaN` de délai ferait reprendre une facture immédiatement.
 */
export function delaiAvantEssai(tentatives: number): number {
  const i = Math.min(Math.max(Math.trunc(tentatives) - 1, 0), BACKOFF_MS.length - 1)
  return BACKOFF_MS[i]
}

export interface CandidatFile {
  transmissionId: string
  garageId: string
  invoiceId: string
  providerId: string
  environment: string
  tentatives: number
  dernierEchec: Date
}

export type DecisionFile =
  | { ok: true }
  | { ok: false; raison: 'STATUT_NON_REJOUABLE' | 'IDENTIFIANT_EXTERNE' | 'TENTATIVES_EPUISEES' | 'DELAI_NON_ECOULE' }

/**
 * Décide si une transmission peut être reprise MAINTENANT.
 *
 * Fonction pure : la politique est testable sans base et sans horloge réelle.
 */
export function decisionReprise(
  etat: { status: string; externalId: string | null; tentatives: number; dernierEchec: Date | string },
  maintenant: number = Date.now(),
): DecisionFile {
  if (etat.status !== 'error') return { ok: false, raison: 'STATUT_NON_REJOUABLE' }
  if (etat.externalId) return { ok: false, raison: 'IDENTIFIANT_EXTERNE' }
  if (etat.tentatives >= MAX_TENTATIVES) return { ok: false, raison: 'TENTATIVES_EPUISEES' }
  const dernier = etat.dernierEchec instanceof Date ? etat.dernierEchec.getTime() : Date.parse(etat.dernierEchec)
  if (!Number.isFinite(dernier)) return { ok: false, raison: 'DELAI_NON_ECOULE' }
  if (maintenant - dernier < delaiAvantEssai(etat.tentatives)) return { ok: false, raison: 'DELAI_NON_ECOULE' }
  return { ok: true }
}

/**
 * Transmissions susceptibles d'être reprises, de la plus ancienne à la plus
 * récente. Le pré-filtre SQL est volontairement LARGE (le plus petit délai) ;
 * `decisionReprise` tranche ensuite, échec par échec.
 */
export async function listerCandidats(
  limite = 20,
  maintenant: number = Date.now(),
): Promise<CandidatFile[]> {
  const db = serverPrisma()
  const seuil = new Date(maintenant - BACKOFF_MS[0])
  const lignes = await db.eInvoiceTransmission.findMany({
    where: { status: 'error', externalId: null, updatedAt: { lte: seuil } },
    orderBy: { updatedAt: 'asc' },
    // Marge : certains candidats seront écartés par le backoff exact.
    take: Math.min(Math.max(limite, 1) * 4, 200),
    select: {
      id: true, garageId: true, invoiceId: true, providerId: true,
      environment: true, updatedAt: true, status: true, externalId: true,
    },
  })

  const candidats: CandidatFile[] = []
  for (const ligne of lignes) {
    const tentatives = await db.eInvoiceEvent.count({
      where: { transmissionId: ligne.id, type: 'error' },
    })
    // Le pré-filtre SQL est une optimisation, jamais la décision : la politique
    // est réévaluée sur les valeurs RÉELLEMENT lues.
    const dec = decisionReprise(
      { status: ligne.status, externalId: ligne.externalId, tentatives, dernierEchec: ligne.updatedAt },
      maintenant,
    )
    if (!dec.ok) continue
    candidats.push({
      transmissionId: ligne.id,
      garageId: ligne.garageId,
      invoiceId: ligne.invoiceId,
      providerId: ligne.providerId,
      environment: ligne.environment,
      tentatives,
      dernierEchec: ligne.updatedAt,
    })
    if (candidats.length >= limite) break
  }
  return candidats
}

export interface ResultatFile {
  examines: number
  repris: number
  reussis: number
  echoues: number
  ignores: number
  details: Array<{
    transmissionId: string
    invoiceId: string
    issue: 'reussi' | 'echoue' | 'ignore'
    code?: string
    message?: string
  }>
}

/**
 * Reprend une transmission : relit la facture DEPUIS LE CLOUD (elle y a été
 * publiée par le poste) et rappelle `envoyerFacture`, qui porte toute la
 * logique d'idempotence et de prise exclusive.
 */
export async function reprendre(candidat: CandidatFile): Promise<ResultatEnvoi | { ok: false; code: 'INVOICE_NOT_PUBLISHED'; message: string }> {
  const db = serverPrisma()
  const facture = await db.invoice.findFirst({
    where: { id: candidat.invoiceId, garageId: candidat.garageId },
    include: { lines: { orderBy: { sortOrder: 'asc' } } },
  })
  if (!facture) {
    return {
      ok: false,
      code: 'INVOICE_NOT_PUBLISHED',
      message: 'La facture n’est pas présente côté service en ligne : reprise impossible.',
    }
  }
  const garage = await db.garage.findUnique({ where: { id: candidat.garageId } })
  if (!garage) {
    return { ok: false, code: 'INVOICE_NOT_PUBLISHED', message: 'Garage introuvable côté service en ligne.' }
  }

  return envoyerFacture({
    garageId: candidat.garageId,
    invoiceId: facture.id,
    environment: candidat.environment as EInvoiceEnvironment,
    garage: { name: garage.name, siret: garage.siret, vatNumber: garage.vatNumber, address: garage.address },
    invoice: {
      number: facture.number,
      issueDate: facture.issueDate,
      dueDate: facture.dueDate,
      taxRate: facture.taxRate,
      clientName: facture.clientName,
      clientAddress: facture.clientAddress,
    },
    lines: linesToEuros(facture.lines).map((l) => ({
      description: l.description,
      quantityTenThousandths: l.quantityTenThousandths,
      unitPriceTenThousandths: l.unitPriceTenThousandths,
    })),
    // Aucun acteur : une reprise est un acte AUTOMATIQUE. Le journal d'audit
    // doit pouvoir la distinguer d'un clic d'exploitant.
    actorUserId: null,
  })
}

/** Traite la file : examine, reprend, agrège. Jamais silencieux en cas d'échec. */
export async function traiterFile(limite = 20, maintenant: number = Date.now()): Promise<ResultatFile> {
  const candidats = await listerCandidats(limite, maintenant)
  const resultat: ResultatFile = {
    examines: candidats.length, repris: 0, reussis: 0, echoues: 0, ignores: 0, details: [],
  }

  for (const candidat of candidats) {
    try {
      const r = await reprendre(candidat)
      if (r.ok) {
        resultat.repris += 1
        resultat.reussis += 1
        resultat.details.push({
          transmissionId: candidat.transmissionId, invoiceId: candidat.invoiceId, issue: 'reussi',
        })
      } else if (r.code === 'ALREADY_SUBMITTED' || r.code === 'INVOICE_NOT_PUBLISHED') {
        resultat.ignores += 1
        resultat.details.push({
          transmissionId: candidat.transmissionId, invoiceId: candidat.invoiceId,
          issue: 'ignore', code: r.code, message: r.message,
        })
      } else {
        resultat.repris += 1
        resultat.echoues += 1
        resultat.details.push({
          transmissionId: candidat.transmissionId, invoiceId: candidat.invoiceId,
          issue: 'echoue', code: r.code, message: r.message,
        })
      }
    } catch (err) {
      // Une exception inattendue ne doit pas arrêter la file : les autres
      // factures doivent pouvoir être reprises. Elle est journalisée et comptée.
      resultat.repris += 1
      resultat.echoues += 1
      resultat.details.push({
        transmissionId: candidat.transmissionId,
        invoiceId: candidat.invoiceId,
        issue: 'echoue',
        code: 'EXCEPTION',
        message: err instanceof Error ? err.message : 'Erreur inattendue',
      })
      logger.error('[einvoicing/queue] reprise en exception', err)
    }
  }

  if (resultat.examines > 0) {
    logger.info('[einvoicing/queue] file traitée', {
      examines: resultat.examines, reussis: resultat.reussis,
      echoues: resultat.echoues, ignores: resultat.ignores,
    })
  }
  return resultat
}
