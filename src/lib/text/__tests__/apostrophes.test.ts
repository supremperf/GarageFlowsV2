/**
 * L'apostrophe que l'utilisateur tape n'est pas celle que le code attend.
 *
 * Les listes de mots-clés du produit portent l'apostrophe DROITE. Les claviers
 * de téléphone, la correction automatique, le copier-coller depuis un
 * traitement de texte — et l'interface de GarageFlows elle-même — produisent la
 * TYPOGRAPHIQUE. Une comparaison de chaînes qui ne les confond pas échoue donc
 * sur la saisie la plus probable, en silence, et l'utilisateur conclut que la
 * fonction ne marche pas.
 */
import { describe, it, expect } from 'vitest'
import { plierApostrophes } from '@/lib/text/apostrophes'
import { classify } from '@/lib/copilot/router'
import { diagnose } from '@/lib/diagnostic'
import { normalizeSearch, rankParts } from '@/lib/stock/search'

describe('pliage des apostrophes', () => {
  it('toutes les variantes se ramènent à la forme droite', () => {
    for (const v of ['’', '‘', '‛', 'ʼ', 'ˈ', '`', '´', '′']) {
      expect(plierApostrophes(`chiffre d${v}affaires`), `variante ${v}`).toBe("chiffre d'affaires")
    }
  })

  it('la forme droite est laissée intacte', () => {
    expect(plierApostrophes("chiffre d'affaires")).toBe("chiffre d'affaires")
  })

  it('le reste du texte n\'est pas touché', () => {
    expect(plierApostrophes('Réf. BRK-100 « Ø 12 mm »')).toBe('Réf. BRK-100 « Ø 12 mm »')
  })
})

describe('copilote — l\'intention est reconnue quelle que soit l\'apostrophe', () => {
  it('« chiffre d’affaires » est compris comme « chiffre d\'affaires »', () => {
    // Avant le pliage : intention `null`, réponse « je n'ai pas compris » — sur
    // la question la plus courante qu'un garagiste puisse poser.
    expect(classify('Quel est mon chiffre d’affaires ?').intent).toBe('today_revenue')
    expect(classify("Quel est mon chiffre d'affaires ?").intent).toBe('today_revenue')
  })

  it('« CA d’aujourd’hui » aussi', () => {
    expect(classify('le CA d’aujourd’hui').intent).toBe('today_revenue')
  })

  it('les intentions sans apostrophe restent inchangées', () => {
    expect(classify('quels devis en attente ?').intent).toBe('pending_quotes')
    expect(classify('rupture de stock').intent).toBe('low_stock')
    expect(classify('creer un devis').intent).toBe('create_quote')
  })
})

describe('diagnostic — le symptôme saisi au téléphone est reconnu', () => {
  it('l\'apostrophe typographique ne fait pas perdre la cause probable', () => {
    const droite = diagnose({ symptoms: ["bruit d'embrayage"] })
    const typo = diagnose({ symptoms: ['bruit d’embrayage'] })
    expect(typo.causes.map((c) => c.id)).toEqual(droite.causes.map((c) => c.id))
  })
})

describe('recherche de pièces — même exigence', () => {
  const stock = [
    { id: '1', name: "Joint d'étanchéité culasse", reference: 'JT-100' },
    { id: '2', name: 'Filtre à huile', reference: 'FH-200' },
  ]

  it('les deux apostrophes donnent la même forme canonique', () => {
    expect(normalizeSearch('Joint d’étanchéité')).toBe(normalizeSearch("Joint d'étanchéité"))
  })

  it('la pièce est trouvée avec l\'apostrophe typographique', () => {
    expect(rankParts(stock, 'joint d’étanchéité').map((p) => p.id)).toContain('1')
    // Et le classement est identique à celui de la forme droite.
    expect(rankParts(stock, 'joint d’étanchéité')).toEqual(rankParts(stock, "joint d'étanchéité"))
  })
})
