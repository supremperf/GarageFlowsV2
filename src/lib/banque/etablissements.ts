/**
 * Établissements bancaires français — recherche par nom, sigle ou groupe (GF-023).
 *
 * ─── Règle absolue : NE JAMAIS INVENTER UN BIC ──────────────────────────────
 * Un BIC n'est pas une propriété de la marque : dans les réseaux fédérés
 * (Crédit Agricole, Caisse d'Épargne, Banque Populaire, Crédit Mutuel), il varie
 * d'une caisse régionale à l'autre. Proposer « le » BIC de la marque y serait
 * faux la plupart du temps, et un virement part alors chez quelqu'un d'autre.
 *
 * Chaque entrée porte donc l'un de deux états, jamais un entre-deux :
 *   · `bic` renseigné  → BIC UNIQUE pour tout le réseau, proposé comme valeur
 *     de départ, modifiable ;
 *   · `bicVariable`    → le BIC dépend de l'agence : RIEN n'est proposé, et
 *     l'écran demande de le recopier depuis le RIB.
 *
 * La liste n'a pas vocation à être exhaustive : elle sert la SAISIE. Un
 * établissement absent se tape à la main, sans blocage — c'est pourquoi la
 * recherche ne contraint jamais le champ.
 */

export interface Etablissement {
  nom: string
  /** Sigles et appellations courantes — « SG », « LCL », « BP »… */
  alias: string[]
  groupe?: string
  /** BIC valable pour TOUT le réseau. Absent si variable. */
  bic?: string
  /** Vrai quand le BIC dépend de la caisse régionale ou de l'agence. */
  bicVariable?: boolean
  /** Codes banque (5 chiffres de l'IBAN français) réservés à cet établissement. */
  codesBanque?: string[]
}

export const ETABLISSEMENTS: Etablissement[] = [
  // ── Réseaux à BIC UNIQUE ───────────────────────────────────────────────────
  { nom: 'BNP Paribas',        alias: ['BNP', 'BNPP'],            bic: 'BNPAFRPP', codesBanque: ['30004'] },
  { nom: 'Hello bank!',        alias: ['hellobank'],              groupe: 'BNP Paribas', bic: 'BNPAFRPP' },
  { nom: 'Société Générale',   alias: ['SG', 'SocGen'],           bic: 'SOGEFRPP', codesBanque: ['30003'] },
  { nom: 'LCL',                alias: ['Crédit Lyonnais'],        groupe: 'Crédit Agricole', bic: 'CRLYFRPP', codesBanque: ['30002'] },
  { nom: 'La Banque Postale',  alias: ['LBP', 'Banque Postale'],  bic: 'PSSTFRPP', codesBanque: ['20041'] },
  { nom: 'BRED Banque Populaire', alias: ['BRED'],                groupe: 'BPCE', bic: 'BREDFRPP', codesBanque: ['10107'] },
  { nom: 'HSBC Continental Europe', alias: ['HSBC'],              bic: 'CCFRFRPP', codesBanque: ['30056'] },
  { nom: 'Boursorama Banque',  alias: ['Boursorama', 'BoursoBank'], groupe: 'Société Générale', bic: 'BOUSFRPP', codesBanque: ['40618'] },
  { nom: 'Fortuneo',           alias: ['Fortunéo'],               groupe: 'Crédit Mutuel Arkéa', bic: 'FTNOFRP1', codesBanque: ['14458'] },
  { nom: 'Qonto',              alias: [],                         bic: 'QNTOFRP1' },
  { nom: 'Crédit Coopératif',  alias: ['Coopératif'],             groupe: 'BPCE', bic: 'CCOPFRPP', codesBanque: ['42559'] },

  // ── Réseaux FÉDÉRÉS : BIC variable, aucune proposition ────────────────────
  { nom: 'Crédit Agricole',    alias: ['CA', 'Crédit Agricole Mutuel'], bicVariable: true },
  { nom: 'Caisse d’Épargne',   alias: ['CE', "Caisse d'Epargne"],  groupe: 'BPCE', bicVariable: true },
  { nom: 'Banque Populaire',   alias: ['BP'],                      groupe: 'BPCE', bicVariable: true },
  { nom: 'Crédit Mutuel',      alias: ['CM'],                      bicVariable: true },
  { nom: 'CIC',                alias: ['Crédit Industriel et Commercial'], groupe: 'Crédit Mutuel', bicVariable: true },
  { nom: 'Banque Populaire Rives de Paris', alias: ['BPRI'],       groupe: 'BPCE', bicVariable: true },
  { nom: 'Crédit du Nord',     alias: [],                          groupe: 'Société Générale', bicVariable: true },
  { nom: 'Banque Palatine',    alias: ['Palatine'],                groupe: 'BPCE', bicVariable: true },
  { nom: 'AXA Banque',         alias: ['AXA'],                     bicVariable: true },
  { nom: 'Monabanq',           alias: [],                          groupe: 'Crédit Mutuel', bicVariable: true },
]

import { normaliserTexte } from '@/lib/recherche/normalisation'

/**
 * Recherche par nom, sigle ou groupe — « S » propose déjà Société Générale,
 * « So » resserre. Les correspondances par DÉBUT de mot passent devant.
 */
export function chercherEtablissements(recherche: string, limite = 8): Etablissement[] {
  const q = normaliserTexte(recherche)
  if (!q) return []

  /**
   * Le NOM propre prime sur le sigle, qui prime sur le GROUPE.
   *
   * Sans cette hiérarchie, « So » remontait « Boursorama Banque » avant
   * « Société Générale » — parce que Boursorama appartient au groupe Société
   * Générale et que l'égalité de score se départageait par ordre alphabétique.
   * Une banque doit se trouver par son propre nom avant celui de sa maison mère.
   */
  const scorePour = (valeur: string | undefined, poids: number): number => {
    const n = normaliserTexte(valeur)
    if (!n || !q) return -1
    if (n === q) return poids + 20
    if (n.startsWith(q)) return poids + 10
    if (n.split(' ').some((mot) => mot.startsWith(q))) return poids
    if (n.includes(q)) return poids - 20
    return -1
  }

  const score = (e: Etablissement): number => Math.max(
    scorePour(e.nom, 70),
    ...e.alias.map((a) => scorePour(a, 50)),
    scorePour(e.groupe, 20),
  )

  return ETABLISSEMENTS
    .map((e) => ({ e, s: score(e) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s || a.e.nom.localeCompare(b.e.nom, 'fr'))
    .slice(0, limite)
    .map((x) => x.e)
}

/** Établissement déduit du code banque d'un IBAN français, si connu. */
export function etablissementParCodeBanque(codeBanque: string | null | undefined): Etablissement | null {
  const code = String(codeBanque ?? '').trim()
  if (!/^\d{5}$/.test(code)) return null
  return ETABLISSEMENTS.find((e) => e.codesBanque?.includes(code)) ?? null
}
