/**
 * Passerelle POSTE → CLOUD pour la facturation électronique.
 *
 * Les quatre modèles d'e-facturation n'existent que dans le schéma PostgreSQL.
 * Un poste ne peut donc pas les servir lui-même — il délègue au service en
 * ligne, par le canal licence déjà en place (`/api/sync/einvoicing`).
 *
 * Ce module ne contient AUCUNE logique métier : il transporte. La validation,
 * le chiffrement des identifiants, les protections SSRF et l'idempotence de
 * l'envoi restent au même endroit qu'avant, exécutés une seule fois, côté
 * cloud. Dupliquer quoi que ce soit ici garantirait qu'un jour les deux
 * versions divergent.
 */
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { cloudPost, garageLicenseToken } from '@/lib/sync/cloud-client'
import { logger } from '@/lib/logger'

/** Actions reconnues par le tunnel — mêmes noms des deux côtés. */
export type ActionEInvoicing =
  | 'connection.get' | 'connection.put' | 'connection.delete' | 'connection.test'
  | 'invoice.submit' | 'invoice.status' | 'invoice.not-received' | 'invoice.transmissions'
  | 'flags.get'

/**
 * Relaie une action vers le service en ligne et rend SA réponse.
 *
 * Les échecs de transport sont distingués des refus métier : un garage doit
 * savoir si sa plateforme a refusé, ou si c'est simplement le réseau qui manque
 * — les gestes à faire ne sont pas les mêmes.
 *
 * `enrichir` n'est appliqué qu'aux réponses ABOUTIES (statut < 400) : une
 * lecture peut avoir besoin d'ajouter une donnée que seul le poste connaît —
 * typiquement un droit lié au RÔLE de la session, que la licence garage
 * n'identifie pas. Les refus, eux, ressortent toujours intacts : y ajouter quoi
 * que ce soit reviendrait à retoucher le motif rendu par la plateforme.
 */
export async function relayerVersCloud(
  garageId: string,
  action: ActionEInvoicing,
  payload: Record<string, unknown> = {},
  enrichir?: (donnees: Record<string, unknown>) => Record<string, unknown>,
): Promise<NextResponse> {
  const licence = await garageLicenseToken(garageId)
  if (!licence) {
    return NextResponse.json({
      ok: false,
      code: 'LICENCE_GARAGE_ABSENTE',
      error: 'Aucune licence garage active sur ce poste : la facturation électronique, '
        + 'gérée par le service en ligne, est inaccessible.',
    }, { status: 409 })
  }

  const reponse = await cloudPost('/api/sync/einvoicing', { garageLicense: licence, action, payload })

  if (reponse.code === 'NETWORK' || reponse.code === 'TIMEOUT') {
    logger.info('[einvoicing/pont] service en ligne injoignable', { action })
    return NextResponse.json({
      ok: false,
      code: reponse.code,
      error: 'Le service en ligne GarageFlows est injoignable : la facturation électronique '
        + 'nécessite une connexion Internet. Votre facture reste enregistrée.',
    }, { status: 503 })
  }

  // Réponse métier du cloud — rendue telle quelle, statut compris : le garage
  // doit lire le motif exact de sa plateforme, pas une reformulation.
  const status = typeof reponse.status === 'number' && reponse.status >= 200 ? reponse.status : 502
  const donnees = (reponse.data ?? { ok: false, code: 'REPONSE_INATTENDUE' }) as Record<string, unknown>
  const corps = enrichir && status < 400 && reponse.data ? enrichir(donnees) : donnees
  return NextResponse.json(corps, { status })
}

/**
 * Drapeaux de facturation électronique tels que le SERVICE les applique.
 *
 * Un poste n'a jamais les variables `EINVOICING_*` : le reset ne les provisionne
 * pas (cf. `flags.ts`). S'il lisait les siennes, il conclurait « fonctionnalité
 * désactivée » et grisserait tout l'onglet — y compris quand le service en ligne
 * la propose. C'est le service qui décide, ici comme partout ailleurs dans ce
 * module.
 *
 * Rend `null` quand le service est injoignable : l'appelant doit alors dire
 * « service injoignable », jamais « fonctionnalité désactivée ». Les deux
 * phrases appellent des gestes différents.
 */
export async function drapeauxDuService(garageId: string): Promise<Record<string, unknown> | null> {
  const licence = await garageLicenseToken(garageId)
  if (!licence) return null
  const reponse = await cloudPost('/api/sync/einvoicing', {
    garageLicense: licence, action: 'flags.get', payload: {},
  })
  const drapeaux = (reponse.data as { flags?: Record<string, unknown> } | undefined)?.flags
  if (!reponse.ok || !drapeaux) {
    logger.info('[einvoicing/pont] drapeaux du service indisponibles', { code: reponse.code ?? reponse.status })
    return null
  }
  return drapeaux
}

/**
 * Le poste connaît-il cette facture, et appartient-elle bien à ce garage ?
 *
 * Contrôle local AVANT tout appel réseau : inutile de déranger le service en
 * ligne pour un identifiant qui n'existe pas ici, et une facture d'un autre
 * garage doit rester INTROUVABLE — pas « refusée », ce qui confirmerait son
 * existence.
 *
 * Rend l'état plutôt qu'un booléen : l'appelant a besoin des deux (existence et
 * transmissibilité), et une seule lecture suffit à les établir.
 */
export async function factureLocale(
  garageId: string,
  invoiceId: string,
): Promise<{ status: string | null } | null> {
  return prisma.invoice.findFirst({ where: { id: invoiceId, garageId }, select: { status: true } })
}
