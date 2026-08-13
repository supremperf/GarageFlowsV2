/**
 * GF-PLAN-004 — validation serveur de la photo de profil mécanicien.
 *
 * Le MIME annoncé par le navigateur ne prouve rien : il est choisi par
 * l'appelant. Ces tests construisent de VRAIES structures d'image (et de vrais
 * fichiers malveillants) octet par octet, plutôt que de simuler la validation.
 */
import { describe, it, expect } from 'vitest'
import {
  AVATAR_MAX_BYTES,
  AVATAR_MAX_DIMENSION,
  AVATAR_MIN_DIMENSION,
  typeReel,
  dimensionsImage,
  retirerMetadonneesJpeg,
  contientExif,
  validerAvatar,
  jetonCache,
} from '@/lib/mechanics/avatar-image'

// ─── Fabriques d'images réelles ──────────────────────────────────────────────

/** PNG minimal valide : signature + IHDR aux dimensions demandées. */
function png(largeur = 256, hauteur = 256): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(25)
  ihdr.writeUInt32BE(13, 0)
  ihdr.write('IHDR', 4, 'ascii')
  ihdr.writeUInt32BE(largeur, 8)
  ihdr.writeUInt32BE(hauteur, 12)
  ihdr[16] = 8   // profondeur
  ihdr[17] = 6   // RVBA
  return Buffer.concat([sig, ihdr, Buffer.alloc(32)])
}

/** JPEG minimal valide : SOI, segments optionnels, SOF0, SOS. */
function jpeg(largeur = 256, hauteur = 256, segments: Buffer[] = []): Buffer {
  const soi = Buffer.from([0xff, 0xd8])
  const sof = Buffer.alloc(11)
  sof[0] = 0xff; sof[1] = 0xc0
  sof.writeUInt16BE(9, 2) // longueur (hors marqueur)
  sof[4] = 8              // précision
  sof.writeUInt16BE(hauteur, 5)
  sof.writeUInt16BE(largeur, 7)
  sof[9] = 1              // composantes
  const sos = Buffer.concat([Buffer.from([0xff, 0xda, 0x00, 0x08]), Buffer.alloc(6), Buffer.from([0xff, 0xd9])])
  return Buffer.concat([soi, ...segments, sof, sos])
}

/** Segment APP1 portant un bloc EXIF (avec une position GPS factice). */
function segmentExifAvecGps(): Buffer {
  const charge = Buffer.concat([
    Buffer.from('Exif\0\0', 'binary'),
    Buffer.from('MM\0*'),                       // en-tête TIFF gros-boutiste
    Buffer.from('GPSLatitude 48.8566 GPSLongitude 2.3522 iPhone 15 Pro'),
  ])
  const entete = Buffer.alloc(4)
  entete[0] = 0xff; entete[1] = 0xe1
  entete.writeUInt16BE(charge.length + 2, 2)
  return Buffer.concat([entete, charge])
}

/** WebP VP8X aux dimensions demandées. */
function webp(largeur = 256, hauteur = 256): Buffer {
  const b = Buffer.alloc(30)
  b.write('RIFF', 0, 'ascii')
  b.writeUInt32LE(22, 4)
  b.write('WEBP', 8, 'ascii')
  b.write('VP8X', 12, 'ascii')
  b.writeUInt32LE(10, 16)
  const l = largeur - 1, h = hauteur - 1
  b[24] = l & 0xff; b[25] = (l >> 8) & 0xff; b[26] = (l >> 16) & 0xff
  b[27] = h & 0xff; b[28] = (h >> 8) & 0xff; b[29] = (h >> 16) & 0xff
  return b
}

const url = (buf: Buffer, mimeAnnonce = 'image/png') => `data:${mimeAnnonce};base64,${buf.toString('base64')}`

// ─── Type réel ───────────────────────────────────────────────────────────────

describe('le type vient des OCTETS, jamais de ce que le client annonce', () => {
  it('reconnaît les trois formats acceptés', () => {
    expect(typeReel(png())).toBe('image/png')
    expect(typeReel(jpeg())).toBe('image/jpeg')
    expect(typeReel(webp())).toBe('image/webp')
  })

  it('un PNG annoncé « image/jpeg » reste un PNG', () => {
    const v = validerAvatar(url(png(), 'image/jpeg'))
    expect(v.ok && v.mime).toBe('image/png')
  })

  it('refuse ce qui n\'est pas une image, quel que soit le nom ou le MIME annoncé', () => {
    const malveillants: Array<[string, Buffer]> = [
      ['exécutable Windows renommé photo.jpg', Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff\x00\x00', 'binary')],
      ['script ELF', Buffer.from('\x7fELF\x02\x01\x01\x00\x00\x00\x00\x00\x00\x00\x00\x00', 'binary')],
      ['page HTML renommée .png', Buffer.from('<!DOCTYPE html><html><body><h1>hello</h1></body></html>')],
      ['SVG porteur de script', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
      ['archive ZIP', Buffer.from('PK\x03\x04\x14\x00\x00\x00\x08\x00\x00\x00\x00\x00\x00\x00', 'binary')],
      ['PDF', Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n')],
      ['texte brut', Buffer.from('ceci est simplement du texte, pas une image du tout')],
    ]
    for (const [nom, contenu] of malveillants) {
      const v = validerAvatar(url(contenu, 'image/png'))
      expect(v.ok, nom).toBe(false)
    }
  })
})

// ─── Structure et dimensions ─────────────────────────────────────────────────

describe('dimensions lues dans l\'en-tête', () => {
  it('PNG, JPEG et WebP donnent leurs vraies dimensions', () => {
    expect(dimensionsImage(png(640, 480), 'image/png')).toEqual({ width: 640, height: 480 })
    expect(dimensionsImage(jpeg(800, 600), 'image/jpeg')).toEqual({ width: 800, height: 600 })
    expect(dimensionsImage(webp(1024, 768), 'image/webp')).toEqual({ width: 1024, height: 768 })
  })

  it('un JPEG dont la chaîne de marqueurs est rompue est rejeté', () => {
    // Bons octets magiques, structure incohérente : c'est le cas d'un fichier
    // fabriqué pour passer un contrôle purement « magic bytes ».
    const faux = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('pas du tout un JPEG structuré ici')])
    expect(dimensionsImage(faux, 'image/jpeg')).toBeNull()
    expect(validerAvatar(url(faux, 'image/jpeg')).ok).toBe(false)
  })

  it('un PNG tronqué avant IHDR est rejeté', () => {
    const tronque = png().subarray(0, 14)
    expect(validerAvatar(url(tronque)).ok).toBe(false)
  })

  it('refuse une image démesurée (bombe de décompression)', () => {
    const v = validerAvatar(url(png(20000, 20000)))
    expect(v.ok).toBe(false)
    expect(!v.ok && v.reason).toMatch(/trop grande/i)
  })

  it('refuse une image minuscule', () => {
    const v = validerAvatar(url(png(8, 8)))
    expect(v.ok).toBe(false)
    expect(!v.ok && v.reason).toMatch(/trop petite/i)
  })

  it('accepte exactement aux bornes', () => {
    expect(validerAvatar(url(png(AVATAR_MIN_DIMENSION, AVATAR_MIN_DIMENSION))).ok).toBe(true)
    expect(validerAvatar(url(png(AVATAR_MAX_DIMENSION, AVATAR_MAX_DIMENSION))).ok).toBe(true)
  })
})

// ─── Taille ──────────────────────────────────────────────────────────────────

describe('taille', () => {
  it('refuse un fichier au-delà du plafond, sans le décoder entièrement', () => {
    const enorme = 'A'.repeat(Math.ceil(AVATAR_MAX_BYTES * 1.4) + 10)
    const v = validerAvatar(`data:image/png;base64,${enorme}`)
    expect(v.ok).toBe(false)
    expect(!v.ok && v.reason).toMatch(/volumineuse/i)
  })

  it('refuse un fichier vide', () => {
    expect(validerAvatar('data:image/png;base64,').ok).toBe(false)
    expect(validerAvatar(url(Buffer.alloc(0))).ok).toBe(false)
  })

  it('refuse une entrée qui n\'est pas une data URL', () => {
    for (const v of ['', 'pas-une-url', 'https://exemple.test/photo.jpg', null, undefined, 42, {}]) {
      expect(validerAvatar(v).ok, String(v)).toBe(false)
    }
  })
})

// ─── Métadonnées / vie privée ────────────────────────────────────────────────

describe('métadonnées EXIF et position GPS', () => {
  it('un JPEG porteur d\'EXIF GPS ressort SANS ses métadonnées', () => {
    const avec = jpeg(256, 256, [segmentExifAvecGps()])
    expect(contientExif(avec)).toBe(true)
    expect(avec.includes(Buffer.from('GPSLatitude'))).toBe(true)

    const v = validerAvatar(url(avec, 'image/jpeg'))
    expect(v.ok).toBe(true)
    if (!v.ok) return
    expect(contientExif(v.bytes)).toBe(false)
    expect(v.bytes.includes(Buffer.from('GPSLatitude'))).toBe(false)
    expect(v.bytes.includes(Buffer.from('iPhone'))).toBe(false)
  })

  it('l\'image elle-même n\'est pas altérée : dimensions inchangées', () => {
    const v = validerAvatar(url(jpeg(640, 480, [segmentExifAvecGps()]), 'image/jpeg'))
    expect(v.ok && v.width).toBe(640)
    expect(v.ok && v.height).toBe(480)
    // Le fichier nettoyé reste un JPEG valide et relisible.
    expect(v.ok && typeReel(v.bytes)).toBe('image/jpeg')
    expect(v.ok && dimensionsImage(v.bytes, 'image/jpeg')).toEqual({ width: 640, height: 480 })
  })

  it('retire aussi les commentaires et les autres segments applicatifs', () => {
    const commentaire = Buffer.concat([Buffer.from([0xff, 0xfe, 0x00, 0x10]), Buffer.from('secret interne')])
    const app13 = Buffer.concat([Buffer.from([0xff, 0xed, 0x00, 0x0c]), Buffer.from('Photoshop!')])
    const nettoye = retirerMetadonneesJpeg(jpeg(256, 256, [commentaire, app13, segmentExifAvecGps()]))
    expect(nettoye.includes(Buffer.from('secret interne'))).toBe(false)
    expect(nettoye.includes(Buffer.from('Photoshop!'))).toBe(false)
  })

  it('un JPEG sans métadonnées traverse le nettoyage intact', () => {
    const propre = jpeg(256, 256)
    expect(retirerMetadonneesJpeg(propre).equals(propre)).toBe(true)
  })

  it('le nettoyage ne casse jamais un fichier qui n\'est pas un JPEG', () => {
    const p = png()
    expect(retirerMetadonneesJpeg(p).equals(p)).toBe(true)
  })
})

// ─── Jeton de cache ──────────────────────────────────────────────────────────

describe('invalidation de cache', () => {
  it('deux images différentes donnent deux jetons différents', () => {
    const a = validerAvatar(url(png(256, 256)))
    const b = validerAvatar(url(png(256, 257)))
    expect(a.ok && b.ok && jetonCache(a.hash) !== jetonCache(b.hash)).toBe(true)
  })

  it('la même image donne le même jeton (pas de rechargement inutile)', () => {
    const a = validerAvatar(url(png(256, 256)))
    const b = validerAvatar(url(png(256, 256)))
    expect(a.ok && b.ok && jetonCache(a.hash) === jetonCache(b.hash)).toBe(true)
  })

  it('le jeton est dérivé du CONTENU, pas de l\'horodatage', () => {
    // Deux remplacements dans la même seconde doivent produire deux URL
    // distinctes : un horodatage à la seconde ne l'aurait pas garanti.
    const a = validerAvatar(url(jpeg(256, 256, [segmentExifAvecGps()]), 'image/jpeg'))
    const b = validerAvatar(url(jpeg(256, 256), 'image/jpeg'))
    // Même image visible, métadonnées différentes → après nettoyage, MÊME contenu.
    expect(a.ok && b.ok && a.hash === b.hash).toBe(true)
  })
})
