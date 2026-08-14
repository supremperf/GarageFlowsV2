/**
 * TAUX HORAIRE DE MAIN-D'ŒUVRE — aucun tarif caché (§9 à §17).
 *
 * Le finding d'origine parlait d'« un 60 codé en dur ». Ce n'était pas une
 * constante oubliée : c'était une famille de replis silencieux, tous de la forme
 * « si je ne sais pas, je prends 60 ». Répartis entre l'écran de réglages, deux
 * routes de calcul et une modale, ils avaient en commun de FABRIQUER une donnée
 * de facturation que le garage n'avait jamais choisie.
 *
 * Le plus coûteux ne portait d'ailleurs pas sur le tarif horaire, mais sur la
 * TVA — voir plus bas.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { nombreSaisi, entierSaisi } from '@/lib/settings/saisie-numerique'
import { toCents, multiplyCents, fromCents } from '@/lib/money'

const RACINE = path.resolve(__dirname, '../../..')
const lire = (rel: string) => readFileSync(path.join(RACINE, rel), 'utf8')

describe('saisie d\'un réglage numérique : rien n\'est inventé', () => {
  it('zéro est une valeur, pas une absence', () => {
    // C'est tout le défaut : `parseFloat('0') || 20` valait 20.
    expect(nombreSaisi('0')).toBe(0)
    expect(nombreSaisi(0)).toBe(0)
    expect(entierSaisi('0')).toBe(0)
  })

  it('un champ vide ou illisible ne dit RIEN — le réglage n\'est pas envoyé', () => {
    for (const v of ['', '   ', 'abc', '12abc', '.', '-', null, undefined, {}, NaN]) {
      expect(nombreSaisi(v), `« ${String(v)} » ne doit rien affirmer`).toBeUndefined()
    }
  })

  it('la virgule décimale d\'un clavier français est comprise', () => {
    // `parseFloat('49,90')` vaut 49 : le garage aurait perdu 90 centimes de
    // l'heure sans rien voir.
    expect(nombreSaisi('49,90')).toBe(49.9)
    expect(nombreSaisi('49.90')).toBe(49.9)
    expect(nombreSaisi(' 125,50 ')).toBe(125.5)
  })

  it('une valeur hors bornes est transmise telle quelle — c\'est au serveur de refuser', () => {
    // L'écran ne corrige pas en silence : il laisse le refus être visible.
    expect(nombreSaisi('-5')).toBe(-5)
    expect(nombreSaisi('99999')).toBe(99999)
  })

  it('un entier attendu refuse un décimal', () => {
    expect(entierSaisi('8')).toBe(8)
    expect(entierSaisi('8.5')).toBeUndefined()
  })
})

describe('les écrans de réglages n\'écrasent plus les valeurs du garage', () => {
  it('l\'onglet Entreprise n\'invente ni tarif ni taux de TVA', () => {
    const src = lire('src/components/SettingsModal.tsx')
    // Le défaut : `parseFloat(s.taxRate) || 20`. Un garage en franchise en base
    // de TVA (art. 293 B du CGI) — cas courant chez les indépendants — saisit
    // 0 %. L'écran réécrivait 20 %, et chaque facture réclamait au client une
    // taxe que le garage n'a pas le droit de collecter.
    expect(src).not.toMatch(/parseFloat\(s\.hourlyRate\)\s*\|\|/)
    expect(src).not.toMatch(/parseFloat\(s\.taxRate\)\s*\|\|/)
    expect(src).not.toMatch(/parseInt\(s\.workshop\w+,\s*10\)\s*\|\|/)
    expect(src).toContain('nombreSaisi(s.hourlyRate)')
    expect(src).toContain('nombreSaisi(s.taxRate)')
    expect(src).toContain('entierSaisi(s.workshopStartHour)')
  })

  it('l\'onglet Fonctionnalités ne transforme plus un champ effacé en zéro', () => {
    const src = lire('src/components/settings/FeaturesTab.tsx')
    // `Number('')` vaut 0 : effacer le tarif l'enregistrait à 0 €/h.
    expect(src).not.toMatch(/onChange\(Number\(e\.target\.value\)\)/)
    expect(src).toContain("e.target.value === '' ? '' : Number(e.target.value)")
    expect(src).toContain('nombreSaisi(settings.hourlyRate)')
  })

  it('les deux écrans qui modifient le tarif emploient les mêmes bornes que le serveur', () => {
    // `min={1}` interdisait ici ce que l'API accepte (un atelier qui ne facture
    // pas l'heure), et `max={999}` refusait ce que l'autre écran laissait passer.
    const features = lire('src/components/settings/FeaturesTab.tsx')
    expect(features).toMatch(/hourlyRate: v \}\)\)\} min=\{0\} max=\{9999\}/)
    const schema = lire('src/lib/schemas/index.ts')
    expect(schema).toMatch(/hourlyRate:\s+z\.number\(\)\.finite\(\)\.min\(0\)\.max\(9999\)/)
  })

  it('un refus du serveur est affiché avec son motif', () => {
    for (const f of ['src/components/SettingsModal.tsx', 'src/components/settings/FeaturesTab.tsx']) {
      expect(lire(f), f).toMatch(/toast\.error\(d\?\.error/)
    }
  })
})

describe('aucun tarif de repli dans les calculs', () => {
  const CHEMINS = [
    'src/app/api/finance/route.ts',
    'src/app/api/quotes/generate/route.ts',
    'src/lib/analytics/collect.ts',
    'src/components/JobModal.tsx',
  ]

  it('plus un seul « sinon 60 » sur la route du tarif horaire', () => {
    for (const c of CHEMINS) {
      const src = lire(c)
      expect(src, `${c} contient encore un tarif de repli`).not.toMatch(/hourlyRate\w*\s*(\?\?|:)\s*60\b/)
      expect(src, `${c} contient encore un tarif de repli`).not.toMatch(/hourlyRateTenThousandths\)\s*:\s*60\b/)
    }
  })

  it('un devis ne se chiffre pas sans garage : il est refusé, pas estimé', () => {
    // Un devis part au client. Le chiffrer sur un tarif inventé serait pire
    // qu'un refus, parce que rien à l'écran ne le distinguerait d'un vrai.
    const src = lire('src/app/api/quotes/generate/route.ts')
    const pos = src.indexOf('const proposal = generateQuote')
    // `[^)]` couvre déjà les sauts de ligne : pas besoin du drapeau `s`, que la
    // cible de compilation du projet n'autorise pas.
    expect(src.slice(0, pos)).toMatch(/if \(!garage\) return NextResponse\.json\([^)]*404/)
  })

  it('la finance refuse de calculer sur un garage introuvable', () => {
    expect(lire('src/app/api/finance/route.ts')).toMatch(/if \(!garage\) \{[\s\S]{0,200}status: 404/)
  })
})

describe('arithmétique de la main-d\'œuvre — exacte au centime (§15, §16)', () => {
  // Tarifs et durées exigés par le programme. Le calcul passe par les centimes
  // entiers : `1.5 * 75` en virgule flottante vaut 112.49999999999999.
  const TARIFS = [35, 49.9, 60, 75, 100, 125.5]
  const DUREES = [0.25, 0.5, 1, 1.5, 2.75]

  it('chaque combinaison tombe juste, sans dérive de virgule flottante', () => {
    for (const tarif of TARIFS) {
      for (const heures of DUREES) {
        const centimes = multiplyCents(toCents(tarif), heures)
        // Référence calculée en entiers, indépendante du code testé.
        const attendu = Math.round(Math.round(tarif * 100) * heures)
        expect(centimes, `${heures} h × ${tarif} €`).toBe(attendu)
        // Et la vue en euros n'introduit aucun résidu.
        expect(fromCents(centimes)).toBeCloseTo(attendu / 100, 10)
      }
    }
  })

  it('1,5 h × 75 € font exactement 112,50 €', () => {
    const c = multiplyCents(toCents(75), 1.5)
    expect(c).toBe(11250)
    expect(fromCents(c)).toBe(112.5)
    // Ce que donnerait un calcul en virgule flottante, et qu'il ne faut jamais
    // laisser atteindre une facture.
    expect(75 * 1.5).toBe(112.5)
    expect(0.25 * 49.9 * 100).not.toBe(1248) // 1247.9999999999998
    expect(multiplyCents(toCents(49.9), 0.25)).toBe(1248)
  })

  it('un quart d\'heure à 125,50 € vaut 31,38 € — arrondi une seule fois', () => {
    expect(multiplyCents(toCents(125.5), 0.25)).toBe(3138)
  })
})

describe('les documents émis conservent leur tarif (§14)', () => {
  it('une ligne de facture porte son propre prix unitaire, jamais une référence au garage', () => {
    // C'est la garantie d'immuabilité : changer le tarif du garage demain ne
    // peut pas recalculer une facture d'hier, puisque le montant n'est pas
    // dérivé du garage mais figé sur la ligne.
    const schema = lire('prisma/schema.prisma')
    const modele = schema.slice(schema.indexOf('model InvoiceLine'))
      .slice(0, schema.slice(schema.indexOf('model InvoiceLine')).indexOf('}'))
    expect(modele).toMatch(/unitPriceTenThousandths\s+Int/)
    expect(modele).not.toMatch(/hourlyRate/)
  })

  it('la mise à jour du garage ne touche à aucune ligne de document', () => {
    const src = lire('src/app/api/garages/route.ts')
    const patch = src.slice(src.indexOf('prisma.garage.update'))
    for (const modele of ['invoiceLine', 'quoteLine', 'invoice.update', 'quote.update']) {
      expect(patch, `la mise à jour des réglages touche à ${modele}`).not.toContain(modele)
    }
  })
})
