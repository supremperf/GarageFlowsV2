/**
 * GF-PLAN-003 — repli d'avatar mécanicien.
 *
 * `Mechanic.avatar` est une colonne TEXTE remplie à la création par
 * `name.slice(0, 2).toUpperCase()`. « Jean Dupont » donnait donc « JE » — les
 * deux premières lettres du PRÉNOM — et tous les Jean d'un garage partageaient
 * le même avatar. Une valeur saisie à la main pouvait par ailleurs être
 * n'importe quoi : « M1 », une chaîne vide, ou un texte qui déborde du cercle.
 */
import { describe, it, expect } from 'vitest'
import { initialesDe, texteAvatar, texteAlternatifAvatar } from '@/lib/planning/avatar'

describe('initiales', () => {
  it('prend la première lettre du prénom ET du nom', () => {
    expect(initialesDe('Jean Dupont')).toBe('JD')
    expect(initialesDe('Paul Martin')).toBe('PM')
    // Le défaut d'origine : `slice(0, 2)` rendait « JE » pour tous les Jean.
    expect(initialesDe('Jean Dupont')).not.toBe('JE')
  })

  it('distingue deux mécaniciens au même prénom', () => {
    expect(initialesDe('Jean Dupont')).not.toBe(initialesDe('Jean Martin'))
  })

  it('gère les noms composés et les séparateurs', () => {
    expect(initialesDe('Jean-Pierre Martin')).toBe('JM')
    expect(initialesDe('Marie   Claire   Dubois')).toBe('MD')
    expect(initialesDe('  Luc   Bernard  ')).toBe('LB')
    expect(initialesDe('anne_sophie leroy')).toBe('AL')
  })

  it('un nom d\'un seul mot donne ses deux premières lettres', () => {
    expect(initialesDe('Madonna')).toBe('MA')
    expect(initialesDe('Bo')).toBe('BO')
    expect(initialesDe('X')).toBe('X')
  })

  it('conserve les diacritiques — un mécanicien doit se reconnaître', () => {
    expect(initialesDe('Éric Ålund')).toBe('ÉÅ')
    expect(initialesDe('Ötzi Ñuñez')).toBe('ÖÑ')
  })

  it('ne coupe jamais un caractère en deux', () => {
    // Découpage par point de code : « 🙂b » ne doit pas produire un demi-emoji.
    expect(Array.from(initialesDe('🙂b')).length).toBeLessThanOrEqual(2)
  })

  it('un nom vide ou absent ne casse rien', () => {
    for (const v of ['', '   ', null, undefined]) {
      expect(initialesDe(v as string)).toBe('?')
    }
  })

  it('rend toujours au plus deux caractères', () => {
    for (const n of ['Jean Dupont', 'Madonna', 'Marie Claire Dubois', 'X', '', 'Éric Ålund']) {
      expect(Array.from(initialesDe(n)).length).toBeLessThanOrEqual(2)
    }
  })
})

describe('texte affiché dans la pastille', () => {
  it('respecte un avatar explicitement saisi par le garage', () => {
    expect(texteAvatar({ name: 'Jean Dupont', avatar: 'JD' })).toBe('JD')
    expect(texteAvatar({ name: 'Jean Dupont', avatar: 'zz' })).toBe('ZZ')
  })

  it('borne un avatar trop long plutôt que de le laisser déborder', () => {
    expect(texteAvatar({ name: 'Jean', avatar: 'SUPERMECANO' })).toBe('SU')
  })

  it('ignore les anciens libellés de POSITION (M1, M2…)', () => {
    // Ce ne sont pas des identités : ce sont d'anciens numéros de colonne.
    for (const m of ['M1', 'M2', 'M12', 'm3']) {
      expect(texteAvatar({ name: 'Jean Dupont', avatar: m })).toBe('JD')
    }
  })

  it('…mais ne confond pas un vrai libellé avec un numéro de position', () => {
    expect(texteAvatar({ name: 'Marc Petit', avatar: 'MP' })).toBe('MP')
    expect(texteAvatar({ name: 'Marc Petit', avatar: 'M' })).toBe('M')
  })

  it('retombe sur les initiales si l\'avatar est vide', () => {
    for (const v of ['', '   ', null, undefined]) {
      expect(texteAvatar({ name: 'Jean Dupont', avatar: v as string })).toBe('JD')
    }
  })

  it('ne rend jamais une pastille vide', () => {
    expect(texteAvatar({ name: null, avatar: null })).toBe('?')
    expect(texteAvatar({}).length).toBeGreaterThan(0)
  })
})

describe('texte alternatif (accessibilité)', () => {
  it('nomme la personne, pas « avatar »', () => {
    expect(texteAlternatifAvatar('Jean Dupont')).toBe('Photo de Jean Dupont')
  })

  it('reste utilisable sans nom', () => {
    expect(texteAlternatifAvatar('')).toBe('Photo du mécanicien')
    expect(texteAlternatifAvatar(null)).toBe('Photo du mécanicien')
  })
})
