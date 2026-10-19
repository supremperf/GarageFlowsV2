/**
 * GF-023 — IBAN et BIC : vérifiés, pas seulement bornés en longueur (§18).
 *
 * `iban: z.string().max(34)` et `bic: z.string().max(11)` laissaient passer un
 * IBAN amputé d'un chiffre ou un BIC de six lettres. Enregistrés sans un mot,
 * ils étaient ensuite IMPRIMÉS au pied de chaque facture : le garage
 * l'apprenait quand le virement de son client était rejeté.
 *
 * La clé de contrôle ISO 13616 (modulo 97) se vérifie HORS LIGNE et détecte une
 * faute de frappe avec une probabilité de 1/97.
 */
import { describe, it, expect } from 'vitest'
import {
  normaliserIban, formaterIban, verifierIban, verifierBic, paysCoherents,
} from '@/lib/banque/iban'
import { chercherEtablissements, etablissementParCodeBanque, ETABLISSEMENTS } from '@/lib/banque/etablissements'

/** IBAN de démonstration — clés de contrôle réelles, comptes fictifs. */
const FR_VALIDE = 'FR7630006000011234567890189'
const DE_VALIDE = 'DE89370400440532013000'
const GB_VALIDE = 'GB82WEST12345698765432'

describe('normalisation et présentation', () => {
  it('retire espaces et séparateurs', () => {
    expect(normaliserIban(' fr76 3000-6000 0112 3456 7890 189 ')).toBe(FR_VALIDE)
  })
  it('présente par groupes de quatre', () => {
    expect(formaterIban(FR_VALIDE)).toBe('FR76 3000 6000 0112 3456 7890 189')
  })
})

describe('clé de contrôle (ISO 13616)', () => {
  it.each([FR_VALIDE, DE_VALIDE, GB_VALIDE])('accepte %s', (iban) => {
    expect(verifierIban(iban).valide, iban).toBe(true)
  })

  it('accepte la saisie avec espaces', () => {
    expect(verifierIban('FR76 3000 6000 0112 3456 7890 189').valide).toBe(true)
  })

  it('REFUSE un chiffre changé — c’est tout l’intérêt de la clé', () => {
    const faux = FR_VALIDE.slice(0, 10) + (FR_VALIDE[10] === '1' ? '2' : '1') + FR_VALIDE.slice(11)
    const v = verifierIban(faux)
    expect(v.valide).toBe(false)
    expect(v.motif).toBe('CLE_INVALIDE')
    expect(v.message).toMatch(/clé de contrôle/i)
  })

  it('REFUSE une longueur incompatible avec le pays', () => {
    const v = verifierIban(FR_VALIDE.slice(0, 26))
    expect(v.valide).toBe(false)
    expect(v.motif).toBe('LONGUEUR_PAYS')
    expect(v.message).toMatch(/27 caractères/)
  })

  it('REFUSE ce qui n’est pas un IBAN', () => {
    expect(verifierIban('mon compte').valide).toBe(false)
    expect(verifierIban('1234567890').valide).toBe(false)
  })

  it('un IBAN VIDE n’est pas une erreur de saisie', () => {
    // Les coordonnées bancaires sont facultatives : le champ vide doit rester
    // distinguable d'un champ mal rempli.
    expect(verifierIban('').motif).toBe('VIDE')
    expect(verifierIban(null).motif).toBe('VIDE')
  })

  it('extrait le code banque d’un IBAN FRANÇAIS', () => {
    expect(verifierIban(FR_VALIDE).codeBanque).toBe('30006')
    expect(verifierIban(DE_VALIDE).codeBanque, 'hors France : pas de code banque').toBeUndefined()
  })
})

describe('BIC (ISO 9362)', () => {
  it.each(['BNPAFRPP', 'SOGEFRPP', 'BNPAFRPPXXX', 'DEUTDEFF500'])('accepte %s', (bic) => {
    expect(verifierBic(bic).valide, bic).toBe(true)
  })

  it.each(['BNPAFR', 'BNPAFRPPXX', '1234FRPP', ''])('refuse « %s »', (bic) => {
    expect(verifierBic(bic).valide).toBe(false)
  })

  it('signale une incohérence de pays entre IBAN et BIC', () => {
    expect(paysCoherents(FR_VALIDE, 'BNPAFRPP')).toBe(true)
    expect(paysCoherents(FR_VALIDE, 'DEUTDEFF')).toBe(false)
    expect(paysCoherents('', 'BNPAFRPP'), 'sans IBAN, on ne conclut pas').toBeNull()
  })
})

describe('recherche d’établissement (§16)', () => {
  it('« S » propose déjà Société Générale, « So » resserre', () => {
    expect(chercherEtablissements('S').map((e) => e.nom)).toContain('Société Générale')
    const so = chercherEtablissements('So').map((e) => e.nom)
    expect(so[0]).toBe('Société Générale')
  })

  it('trouve par sigle et par groupe', () => {
    expect(chercherEtablissements('LCL')[0].nom).toBe('LCL')
    expect(chercherEtablissements('BPCE').length).toBeGreaterThan(1)
  })

  it('tolère accents et casse', () => {
    expect(chercherEtablissements('credit agricole')[0].nom).toBe('Crédit Agricole')
  })

  it('une recherche VIDE ne propose rien', () => {
    expect(chercherEtablissements('')).toEqual([])
    expect(chercherEtablissements('   ')).toEqual([])
  })
})

describe('BIC : jamais inventé (§17)', () => {
  it('chaque établissement est SOIT à BIC unique, SOIT déclaré variable', () => {
    // Un entre-deux — ni BIC, ni mention « variable » — laisserait l'écran muet
    // là où il doit demander le RIB.
    const flous = ETABLISSEMENTS.filter((e) => !e.bic && !e.bicVariable).map((e) => e.nom)
    expect(flous, 'état indéterminé : ni BIC sûr, ni BIC variable').toEqual([])
  })

  it('aucun BIC n’est proposé pour un réseau fédéré', () => {
    // Crédit Agricole, Caisse d'Épargne, Banque Populaire, Crédit Mutuel : le
    // BIC dépend de la caisse régionale. En proposer un serait faux la plupart
    // du temps — et un virement partirait chez quelqu'un d'autre.
    for (const nom of ['Crédit Agricole', 'Caisse d’Épargne', 'Banque Populaire', 'Crédit Mutuel']) {
      const e = ETABLISSEMENTS.find((x) => x.nom === nom)
      expect(e, `${nom} absent du référentiel`).toBeTruthy()
      expect(e!.bic, `${nom} ne doit proposer AUCUN BIC`).toBeUndefined()
      expect(e!.bicVariable).toBe(true)
    }
  })

  it('les BIC proposés sont tous bien formés', () => {
    for (const e of ETABLISSEMENTS) {
      if (!e.bic) continue
      expect(verifierBic(e.bic).valide, `${e.nom} : BIC mal formé`).toBe(true)
    }
  })

  it('le code banque d’un IBAN français retrouve l’établissement', () => {
    expect(etablissementParCodeBanque('30004')?.nom).toBe('BNP Paribas')
    expect(etablissementParCodeBanque('30003')?.nom).toBe('Société Générale')
    expect(etablissementParCodeBanque('99999'), 'code inconnu : rien plutôt qu’une devinette').toBeNull()
    expect(etablissementParCodeBanque('abc')).toBeNull()
  })
})
