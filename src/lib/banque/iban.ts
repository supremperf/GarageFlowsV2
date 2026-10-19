/**
 * IBAN et BIC — normalisation, formatage, VALIDATION (GF-023).
 *
 * ─── Ce qui existait ────────────────────────────────────────────────────────
 * `iban: z.string().max(34)` et `bic: z.string().max(11)`. Aucune vérification :
 * un IBAN amputé d'un chiffre, un BIC de six lettres, un copier-coller avec un
 * retour à la ligne — tout était accepté, enregistré, puis IMPRIMÉ tel quel au
 * pied de chaque facture. Le garage l'apprenait quand le virement du client
 * était rejeté.
 *
 * ─── Ce que ce module garantit ──────────────────────────────────────────────
 * La clé de contrôle d'un IBAN (norme ISO 13616, modulo 97) est vérifiable HORS
 * LIGNE et détecte une faute de frappe avec une probabilité de 1/97. C'est le
 * contrôle qui manquait, et il ne coûte rien.
 *
 * Ce module ne dit PAS si le compte existe — aucun contrôle local ne le peut.
 * Il dit que la saisie est bien formée. La distinction est faite explicitement
 * dans les messages : on ne prétend pas garantir ce qu'on ne vérifie pas.
 */

/** Longueur attendue de l'IBAN par pays — les plus courants en clientèle FR. */
const LONGUEURS: Record<string, number> = {
  FR: 27, MC: 27, BE: 16, LU: 20, CH: 21, DE: 22, ES: 24, IT: 27, PT: 25,
  NL: 18, GB: 22, IE: 22, AT: 20, PL: 28, MA: 28, TN: 24, DZ: 26, SN: 28,
  CI: 28, CM: 27, GA: 27, ML: 28, BF: 28, TG: 28, BJ: 28, NE: 28,
}

/** Retire espaces et séparateurs, met en majuscules. */
export function normaliserIban(valeur: string | null | undefined): string {
  return String(valeur ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** Présentation lisible : groupes de quatre — « FR76 3000 6000 0112 3456 7890 189 ». */
export function formaterIban(valeur: string | null | undefined): string {
  const brut = normaliserIban(valeur)
  return brut.replace(/(.{4})/g, '$1 ').trim()
}

/**
 * Reste de la division par 97 du grand entier formé par l'IBAN réarrangé.
 * Calculé par tranches : le nombre dépasse largement `Number.MAX_SAFE_INTEGER`.
 */
function modulo97(chaine: string): number {
  let reste = 0
  for (const c of chaine) {
    const valeur = /\d/.test(c) ? c : String(c.charCodeAt(0) - 55)
    for (const chiffre of valeur) reste = (reste * 10 + Number(chiffre)) % 97
  }
  return reste
}

export type MotifIbanInvalide =
  | 'VIDE' | 'TROP_COURT' | 'CARACTERES_INVALIDES' | 'PAYS_INCONNU'
  | 'LONGUEUR_PAYS' | 'CLE_INVALIDE'

export interface VerdictIban {
  valide: boolean
  motif?: MotifIbanInvalide
  message?: string
  /** IBAN normalisé (sans espaces), présent même en cas d'échec. */
  normalise: string
  /** Code pays ISO, si lisible. */
  pays?: string
  /** Code banque à 5 chiffres — IBAN FRANÇAIS uniquement. */
  codeBanque?: string
}

/**
 * Vérifie un IBAN : forme, longueur attendue pour le pays, et clé de contrôle.
 * Un IBAN VIDE n'est pas une erreur : le champ est facultatif.
 */
export function verifierIban(valeur: string | null | undefined): VerdictIban {
  const normalise = normaliserIban(valeur)
  if (!normalise) return { valide: false, motif: 'VIDE', normalise, message: 'IBAN non renseigné.' }
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(normalise)) {
    return { valide: false, motif: 'CARACTERES_INVALIDES', normalise, message: 'Format d’IBAN non reconnu.' }
  }
  if (normalise.length < 15 || normalise.length > 34) {
    return { valide: false, motif: 'TROP_COURT', normalise, message: 'Longueur d’IBAN impossible.' }
  }

  const pays = normalise.slice(0, 2)
  const attendue = LONGUEURS[pays]
  if (attendue && normalise.length !== attendue) {
    return {
      valide: false, motif: 'LONGUEUR_PAYS', normalise, pays,
      message: `Un IBAN ${pays} compte ${attendue} caractères, celui-ci en compte ${normalise.length}.`,
    }
  }

  // Norme ISO 13616 : les quatre premiers caractères passent à la fin.
  const reagence = normalise.slice(4) + normalise.slice(0, 4)
  if (modulo97(reagence) !== 1) {
    return {
      valide: false, motif: 'CLE_INVALIDE', normalise, pays,
      message: 'Clé de contrôle incorrecte — vérifiez la saisie (un chiffre est probablement faux).',
    }
  }

  return {
    valide: true, normalise, pays,
    codeBanque: pays === 'FR' ? normalise.slice(4, 9) : undefined,
  }
}

/**
 * BIC (ISO 9362) : 8 ou 11 caractères — banque(4) pays(2) localité(2)
 * [agence(3)]. Le contrôle est purement formel : aucun annuaire local ne dit
 * si le BIC existe.
 */
export function verifierBic(valeur: string | null | undefined): { valide: boolean; normalise: string; message?: string } {
  const normalise = String(valeur ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!normalise) return { valide: false, normalise, message: 'BIC non renseigné.' }
  if (!/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(normalise)) {
    return { valide: false, normalise, message: 'Un BIC compte 8 ou 11 caractères (ex. BNPAFRPP).' }
  }
  return { valide: true, normalise }
}

/** Le BIC et l'IBAN désignent-ils le même pays ? Incohérence fréquente au copier-coller. */
export function paysCoherents(iban: string | null | undefined, bic: string | null | undefined): boolean | null {
  const i = verifierIban(iban)
  const b = verifierBic(bic)
  if (!i.valide || !b.valide || !i.pays) return null
  return b.normalise.slice(4, 6) === i.pays
}
