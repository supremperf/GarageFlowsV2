/**
 * Machine à états des DOCUMENTS LÉGAUX (factures, devis, ordres de réparation).
 *
 * Invariant fondamental des documents à numérotation séquentielle (règles
 * françaises de facturation) : une fois qu'un document QUITTE l'état « draft »
 * (brouillon), il est ÉMIS et ne peut JAMAIS y revenir. Le retour silencieux à
 * « draft » était la faille qui rouvrait l'édition/suppression d'un document
 * pourtant scellé (facture émise réécrite/effacée, OR signé supprimé, devis
 * accepté modifié — tout cela en deux appels API).
 *
 * Ce module centralise :
 *   1. les transitions de statut AUTORISÉES par type de document
 *      (assertStatusTransition) — refus par défaut du retour à « draft » et de
 *      la sortie d'un état terminal ;
 *   2. les VERROUS d'édition des montants (areAmountsLocked) : une fois émis
 *      (facture) ou engagé côté client (devis accepté/converti), les lignes et
 *      le taux de TVA sont figés — la correction passe par un avoir/un nouveau
 *      document ;
 *   3. les VERROUS de suppression (isDeletable) : un document émis ou scellé
 *      n'est jamais supprimé physiquement (conservation FEC/comptable).
 *
 * Aucune dépendance à Prisma/Next : pur, testable, réutilisable côté serveur.
 */

export type DocumentKind = 'invoice' | 'quote' | 'workOrder'

/**
 * Graphe des transitions autorisées : depuis chaque statut, l'ensemble des
 * statuts cibles admissibles (le statut lui-même est toujours admissible —
 * un PATCH idempotent ne doit pas échouer). Volontairement PERMISSIF entre
 * états émis (l'application peut réordonner sent/overdue/paid) ; les seules
 * interdictions dures sont : (a) revenir à « draft » une fois émis, (b) quitter
 * un état terminal ('converted' pour un devis).
 */
const TRANSITIONS: Record<DocumentKind, Record<string, string[]>> = {
  invoice: {
    draft: ['draft', 'sent', 'paid', 'overdue'],
    sent: ['sent', 'paid', 'overdue'],
    overdue: ['overdue', 'sent', 'paid'],
    paid: ['paid', 'overdue'],
  },
  quote: {
    draft: ['draft', 'sent', 'accepted', 'refused', 'converted'],
    sent: ['sent', 'accepted', 'refused', 'converted'],
    accepted: ['accepted', 'refused', 'converted'],
    refused: ['refused', 'sent'],
    converted: ['converted'], // terminal : un devis converti en facture est figé
  },
  workOrder: {
    draft: ['draft', 'signed', 'in_progress', 'closed'],
    signed: ['signed', 'in_progress', 'closed'],
    in_progress: ['in_progress', 'signed', 'closed'],
    closed: ['closed', 'in_progress'],
  },
}

/** Statuts « brouillon » (seul état où tout est librement modifiable/supprimable). */
export function isDraft(status: string | null | undefined): boolean {
  return (status ?? 'draft') === 'draft'
}

/**
 * Valide une transition de statut. Retourne un message d'erreur (français,
 * sûr à exposer) si la transition est INTERDITE, sinon `null`.
 * Un statut cible identique au statut courant est toujours autorisé.
 */
export function checkStatusTransition(
  kind: DocumentKind,
  from: string | null | undefined,
  to: string,
): string | null {
  const current = from ?? 'draft'
  if (to === current) return null

  // Interdiction dure et universelle : pas de retour à l'état brouillon.
  if (to === 'draft' && current !== 'draft') {
    return 'Un document émis ne peut pas revenir à l\'état brouillon.'
  }

  const allowed = TRANSITIONS[kind][current]
  if (!allowed) {
    // Statut courant inconnu : on refuse par défaut (secure by default).
    return `Transition de statut non autorisée (« ${current} » → « ${to} »).`
  }
  if (!allowed.includes(to)) {
    return `Transition de statut non autorisée (« ${current} » → « ${to} »).`
  }
  return null
}

/**
 * Les montants (lignes, taux de TVA) sont-ils FIGÉS pour ce document ?
 * - facture : dès qu'elle quitte « draft » (émise = immuable, avoir requis) ;
 * - devis : une fois « accepted » ou « converted » (engagement client) ;
 * - ordre de réparation : le verrou signé est géré séparément (signature),
 *   ce module ne fige pas ses montants par statut.
 */
export function areAmountsLocked(kind: DocumentKind, status: string | null | undefined): boolean {
  const s = status ?? 'draft'
  if (kind === 'invoice') return s !== 'draft'
  if (kind === 'quote') return s === 'accepted' || s === 'converted'
  return false
}

/**
 * Le document peut-il être supprimé physiquement ?
 * - facture : uniquement en brouillon (une facture émise se conserve, s'annule
 *   par avoir) ;
 * - devis : brouillon/envoyé/refusé oui ; accepté ou converti NON (engagement
 *   client / référencé par une facture) ;
 * - ordre de réparation : brouillon ET non signé (un OR signé est scellé).
 */
export function isDeletable(
  kind: DocumentKind,
  status: string | null | undefined,
  opts?: { signed?: boolean },
): boolean {
  const s = status ?? 'draft'
  if (kind === 'invoice') return s === 'draft'
  if (kind === 'quote') return s === 'draft' || s === 'sent' || s === 'refused'
  if (kind === 'workOrder') return s === 'draft' && !opts?.signed
  return false
}
