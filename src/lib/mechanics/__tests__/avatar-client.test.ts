/**
 * GF-PLAN-007 — préparation de la photo côté navigateur.
 *
 * Le décodage et le canvas exigent un DOM (l'environnement de test est `node`) :
 * on éprouve donc pour de vrai la partie PURE — le calcul de recadrage — et on
 * verrouille sur la source les propriétés du composant qui ne peuvent pas être
 * rendues ici.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { cadreCarre, AVATAR_ACCEPT, AVATAR_SOURCE_MAX_BYTES } from '@/lib/mechanics/avatar-client'
import { AVATAR_THUMBNAIL_SIZE } from '@/lib/mechanics/avatar-image'

const RACINE = path.resolve(__dirname, '../../../..')
const lire = (rel: string) => readFileSync(path.join(RACINE, rel), 'utf8')

describe('recadrage carré centré', () => {
  it('une image déjà carrée n\'est pas recadrée', () => {
    expect(cadreCarre(512, 512)).toMatchObject({ sx: 0, sy: 0, taille: 512, cible: AVATAR_THUMBNAIL_SIZE })
  })

  it('une image paysage est rognée à gauche et à droite, à parts égales', () => {
    const c = cadreCarre(800, 400)
    expect(c.taille).toBe(400)
    expect(c.sy).toBe(0)
    expect(c.sx).toBe(200)
    // Rognage symétrique : le sujet reste centré.
    expect(800 - c.taille - c.sx).toBe(c.sx)
  })

  it('une image portrait est rognée en haut et en bas — le cas du téléphone', () => {
    const c = cadreCarre(1080, 1920)
    expect(c.taille).toBe(1080)
    expect(c.sx).toBe(0)
    expect(c.sy).toBe(420)
    expect(1920 - c.taille - c.sy).toBe(c.sy)
  })

  it('une vignette n\'est JAMAIS agrandie', () => {
    // Agrandir produirait une bouillie interpolée sans rien apporter.
    expect(cadreCarre(100, 100).cible).toBe(100)
    expect(cadreCarre(64, 90).cible).toBe(64)
    expect(cadreCarre(4000, 3000).cible).toBe(AVATAR_THUMBNAIL_SIZE)
  })

  it('les dimensions dégénérées ne produisent jamais un canvas nul', () => {
    for (const [l, h] of [[0, 0], [1, 0], [0, 1], [1, 1], [-5, 10]]) {
      const c = cadreCarre(l, h)
      expect(c.taille).toBeGreaterThanOrEqual(1)
      expect(c.cible).toBeGreaterThanOrEqual(1)
      expect(c.sx).toBeGreaterThanOrEqual(0)
      expect(c.sy).toBeGreaterThanOrEqual(0)
    }
  })

  it('le carré découpé tient TOUJOURS dans l\'image source', () => {
    for (const [l, h] of [[800, 400], [400, 800], [1920, 1080], [37, 91], [1, 5000]]) {
      const c = cadreCarre(l, h)
      expect(c.sx + c.taille).toBeLessThanOrEqual(Math.max(l, c.taille))
      expect(c.sy + c.taille).toBeLessThanOrEqual(Math.max(h, c.taille))
    }
  })
})

describe('contrat du champ de téléversement', () => {
  const src = lire('src/components/settings/MechanicAvatarField.tsx')

  it('n\'accepte au sélecteur que les formats réellement pris en charge', () => {
    expect(AVATAR_ACCEPT).toBe('image/jpeg,image/png,image/webp')
    expect(src).toContain('accept={AVATAR_ACCEPT}')
  })

  it('l\'image est optimisée AVANT l\'envoi', () => {
    expect(src).toContain('preparerAvatar(fichier)')
  })

  it('la vignette n\'est mise à jour qu\'APRÈS la réponse du serveur', () => {
    // Afficher la nouvelle photo dès la sélection donnerait à croire qu'un
    // envoi refusé a réussi.
    const envoi = src.slice(src.indexOf('async function choisir'), src.indexOf('async function supprimer'))
    const posOnChange = envoi.indexOf('onChange(')
    const posReponse = envoi.indexOf('if (!res.ok)')
    expect(posReponse).toBeGreaterThan(-1)
    expect(posOnChange).toBeGreaterThan(posReponse)
  })

  it('un refus du serveur est affiché, jamais avalé', () => {
    expect(src).toMatch(/toast\.error\(corps\?\.error/)
  })

  it('le champ fichier est réinitialisé pour permettre de resélectionner le même fichier', () => {
    // Sans cela, réessayer le MÊME fichier après un échec n'émet aucun événement.
    expect(src).toContain("e.target.value = ''")
  })

  it('le bouton de suppression n\'apparaît que s\'il y a une photo', () => {
    expect(src).toMatch(/\{mechanic\.avatarUrl && \(/)
  })

  it('l\'utilisateur est informé du retrait des données de localisation', () => {
    expect(src).toMatch(/localisation/i)
  })
})

describe('bornes', () => {
  it('le plafond du fichier source est plus large que celui de la vignette', () => {
    // L'utilisateur choisit une photo de téléphone ; c'est la VIGNETTE qui doit
    // être petite, pas le fichier d'origine.
    expect(AVATAR_SOURCE_MAX_BYTES).toBeGreaterThan(5 * 1024 * 1024)
  })
})
