/**
 * Vérification des webhooks de plateforme agréée — partie PURE (aucune base).
 *
 * ─── Pourquoi une signature, et pourquoi ce schéma ──────────────────────────
 * Un webhook est une requête ANONYME : elle vient d'Internet, elle n'a ni
 * session ni licence, et elle prétend modifier le statut réglementaire d'une
 * facture. Sans preuve d'origine, n'importe qui pourrait déclarer « acceptée »
 * une facture jamais transmise. Le statut ne doit venir que d'une réponse
 * RÉELLE de la plateforme, jamais d'un appelant non authentifié.
 *
 * Le connecteur générique ne peut pas imposer le schéma d'un fournisseur
 * particulier : il documente donc le sien, inspiré des pratiques dominantes
 * (Stripe, GitHub) :
 *
 *   X-GF-Timestamp: <secondes Unix>
 *   X-GF-Signature: <hex HMAC-SHA256 de "«timestamp».«corps brut»">
 *
 * · HMAC-SHA256 avec un secret PAR GARAGE (jamais global) ;
 * · comparaison à temps constant (`timingSafeEqual`) ;
 * · fenêtre anti-rejeu de 5 minutes, dans les deux sens (une horloge en avance
 *   ne doit pas rendre le webhook définitivement invérifiable) ;
 * · le corps est signé BRUT, avant tout parsing : re-sérialiser le JSON
 *   changerait les octets et invaliderait la preuve.
 *
 * Un webhook rejoué au-delà de la fenêtre est refusé ; un rejeu DANS la fenêtre
 * reste sans effet grâce à l'identifiant d'événement (voir `webhook.ts`).
 */

import crypto from 'crypto'

/** Fenêtre anti-rejeu, en secondes. */
export const TOLERANCE_SECONDES = 300

export type MotifSignature =
  | 'SECRET_ABSENT'
  | 'ENTETES_ABSENTS'
  | 'HORODATAGE_INVALIDE'
  | 'HORODATAGE_PERIME'
  | 'SIGNATURE_INVALIDE'

export interface ResultatSignature {
  ok: boolean
  motif?: MotifSignature
}

/**
 * Signature attendue. Exportée pour que la documentation et les tests puissent
 * la reproduire avec un client indépendant (openssl, Python…).
 */
export function signatureWebhook(secret: string, timestamp: string, corpsBrut: string): string {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${corpsBrut}`).digest('hex')
}

/** Lit un en-tête sans dépendre de la casse (Request la normalise, pas un test). */
function entete(entetes: Record<string, string | undefined>, nom: string): string | undefined {
  const direct = entetes[nom]
  if (typeof direct === 'string') return direct
  const cherche = nom.toLowerCase()
  for (const [cle, valeur] of Object.entries(entetes)) {
    if (cle.toLowerCase() === cherche && typeof valeur === 'string') return valeur
  }
  return undefined
}

export function verifierSignatureWebhook(input: {
  secret: string | null | undefined
  entetes: Record<string, string | undefined>
  corpsBrut: string
  /** Injectable pour les tests ; secondes Unix. */
  maintenant?: number
  toleranceSecondes?: number
}): ResultatSignature {
  const secret = typeof input.secret === 'string' ? input.secret.trim() : ''
  if (!secret) return { ok: false, motif: 'SECRET_ABSENT' }

  const horodatage = entete(input.entetes, 'x-gf-timestamp')
  const signature = entete(input.entetes, 'x-gf-signature')
  if (!horodatage || !signature) return { ok: false, motif: 'ENTETES_ABSENTS' }

  // Un horodatage non entier ne peut pas entrer dans la fenêtre : on le refuse
  // explicitement plutôt que de laisser `NaN` rendre la comparaison fausse.
  if (!/^\d{1,12}$/.test(horodatage)) return { ok: false, motif: 'HORODATAGE_INVALIDE' }
  const ts = Number(horodatage)
  if (!Number.isSafeInteger(ts) || ts <= 0) return { ok: false, motif: 'HORODATAGE_INVALIDE' }

  const maintenant = input.maintenant ?? Math.floor(Date.now() / 1000)
  const tolerance = input.toleranceSecondes ?? TOLERANCE_SECONDES
  if (Math.abs(maintenant - ts) > tolerance) return { ok: false, motif: 'HORODATAGE_PERIME' }

  // Une signature non hexadécimale ne doit pas lever dans `Buffer.from(..., 'hex')`
  // (qui tronque silencieusement) : on exige exactement 64 caractères hex.
  if (!/^[0-9a-f]{64}$/i.test(signature)) return { ok: false, motif: 'SIGNATURE_INVALIDE' }

  const attendue = Buffer.from(signatureWebhook(secret, horodatage, input.corpsBrut), 'hex')
  const recue = Buffer.from(signature, 'hex')
  if (attendue.length !== recue.length) return { ok: false, motif: 'SIGNATURE_INVALIDE' }
  return crypto.timingSafeEqual(attendue, recue)
    ? { ok: true }
    : { ok: false, motif: 'SIGNATURE_INVALIDE' }
}

/**
 * Le nouveau statut peut-il remplacer l'ancien ?
 *
 * Un webhook peut arriver dans le désordre (deux files, deux régions) : un
 * « submitted » retardataire ne doit pas effacer un « accepted » déjà reçu. On
 * interdit donc toute RÉGRESSION dans la progression normale, et toute sortie
 * d'un état terminal (`paid`). En revanche un refus peut suivre une acceptation
 * — la plateforme peut corriger son verdict — et `refused`/`rejected` restent
 * remplaçables par un statut ultérieur.
 */
const RANG: Record<string, number> = {
  submitted: 1,
  received_by_platform: 2,
  delivered: 3,
  accepted: 4,
  paid: 5,
}

export function doitRemplacerStatut(
  actuel: string,
  nouveau: string,
): boolean {
  if (actuel === nouveau) return false
  if (actuel === 'paid') return false
  // `unknown` ne doit jamais écraser un statut connu : l'absence de traduction
  // n'est pas une information sur la facture.
  if (nouveau === 'unknown') return false
  const rangActuel = RANG[actuel]
  const rangNouveau = RANG[nouveau]
  if (rangActuel !== undefined && rangNouveau !== undefined && rangNouveau < rangActuel) return false
  return true
}
