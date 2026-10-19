/**
 * GF-043 — un PDF que le garage peut réellement ENVOYER.
 *
 * ─── Le défaut, mesuré en navigateur réel ───────────────────────────────────
 * Chaque page du PDF était ajoutée en PNG. Sur le même document, à la même
 * échelle :
 *
 *     facture 1 page  · PNG  4,61 Mo · JPEG q=0,85  0,13 Mo   (×35)
 *     facture 4 pages · PNG 35,83 Mo · JPEG q=0,85  1,13 Mo   (×32)
 *
 * Une facture d'une page à 4,6 Mo passe déjà mal en pièce jointe ; à quatre
 * pages, 35,8 Mo dépassent la limite de toutes les messageries courantes
 * (Gmail : 25 Mo). Le garage produisait donc un document qu'il ne pouvait pas
 * transmettre, sans qu'aucun message ne l'explique — l'envoi échouait chez le
 * fournisseur de messagerie, loin de l'application.
 *
 * Le JPEG n'a pas de couche alpha : sans conséquence ici, la bande est remplie
 * en blanc opaque avant le dessin. À `scale: 2`, l'image source fait 1684 px de
 * large pour 190 mm imprimés — le texte reste net.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { A4_CONTENT_WIDTH_PX, JPEG_QUALITY } from '@/lib/pdf/render-a4'

const SRC = fs.readFileSync(
  path.resolve(__dirname, '../render-a4.ts'), 'utf8',
)

describe('GF-043 — les pages du PDF ne sont plus des PNG', () => {
  it('chaque page est ajoutée en JPEG, à la qualité déclarée', () => {
    expect(SRC).toContain("band.toDataURL('image/jpeg', JPEG_QUALITY)")
    expect(SRC).toContain("'JPEG'")
    expect(SRC, 'plus aucune page en PNG').not.toContain("toDataURL('image/png')")
  })

  it('la qualité reste dans la plage où le texte demeure net', () => {
    // Sous 0,7 le texte se dégrade visiblement ; au-dessus de 0,9 le gain de
    // poids disparaît.
    expect(JPEG_QUALITY).toBeGreaterThanOrEqual(0.7)
    expect(JPEG_QUALITY).toBeLessThanOrEqual(0.9)
  })

  it('la largeur de rendu reste FIXE — l’export ne suit pas l’écran', () => {
    // Invariant antérieur (GF-DUR) : c'est lui qui rend le PDF identique sur
    // poste et sur téléphone. Le changement de format ne doit pas l'entamer.
    expect(A4_CONTENT_WIDTH_PX).toBe(794)
    expect(SRC).toContain('windowWidth: A4_CONTENT_WIDTH_PX')
  })

  it('la bande est remplie en BLANC avant le dessin (le JPEG n’a pas d’alpha)', () => {
    // Sans ce remplissage, les zones transparentes du canevas sortiraient
    // noires en JPEG.
    expect(SRC).toContain("ctx.fillStyle = '#ffffff'")
    expect(SRC).toContain('ctx.fillRect(0, 0, band.width, band.height)')
  })
})
