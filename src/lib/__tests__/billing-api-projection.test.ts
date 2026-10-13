import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { withTotals } from '../billing'
import { linesToEuros } from '../money-db'

/**
 * Invariant — une réponse de CRÉATION doit avoir la MÊME forme qu'une lecture.
 *
 * Depuis le passage de la monnaie en entiers exacts, les lignes stockées ne
 * portent plus que `quantityTenThousandths` / `unitPriceTenThousandths` /
 * `unitCostTenThousandths`. La vue « euros » (`quantity`, `unitPrice`,
 * `unitCost`) et les totaux (`totalHT`, `totalTTC`) sont reconstruits par
 * `withTotals({ ...doc, lines: linesToEuros(doc.lines) })`.
 *
 * GET et PATCH l'appliquaient ; les trois routes de CRÉATION renvoyaient
 * l'objet Prisma BRUT. Le client réinjecte cette réponse dans son état puis
 * affiche `line.unitPrice.toFixed(2)` → « Cannot read properties of undefined
 * (reading 'toFixed') », et la limite d'erreur remplaçait TOUTE l'application.
 * Constaté en test réel à l'enregistrement d'une facture (réf.
 * GF-ERR-20260808-1D72C4) ; la facture était pourtant bien créée en base.
 *
 * Ces tests gardent les deux bouts : la forme produite par la projection, et
 * le fait que les routes de création l'appliquent réellement.
 */

const ROOT = path.join(__dirname, '..', '..', '..')
const ROUTES_CREATION = [
  'src/app/api/invoices/route.ts',
  'src/app/api/quotes/route.ts',
  'src/app/api/quotes/[id]/convert/route.ts',
]

/** Ligne telle que Prisma la renvoie : entiers exacts uniquement. */
const ligneBrute = {
  id: 'l1',
  description: 'Huile moteur 5W-40 — 4 L',
  quantityTenThousandths: 10_000,
  unitPriceTenThousandths: 425_000,
  unitCostTenThousandths: 0,
  isLabor: false,
  sortOrder: 0,
}

describe('projection des documents de facturation', () => {
  it('l’objet Prisma BRUT ne porte pas la vue euros — c’est la cause du plantage', () => {
    expect(ligneBrute).not.toHaveProperty('unitPrice')
    expect((ligneBrute as Record<string, unknown>).unitPrice).toBeUndefined()
  })

  it('linesToEuros + withTotals produisent la vue attendue par le client', () => {
    const projete = withTotals({ taxRate: 20, lines: linesToEuros([ligneBrute]) })
    const ligne = projete.lines[0]
    expect(ligne.quantity).toBe(1)
    expect(ligne.unitPrice).toBe(42.5)
    expect(ligne.unitCost).toBe(0)
    // Le rendu client fait exactement ceci — il ne doit plus jamais lever.
    expect(() => ligne.unitPrice.toFixed(2)).not.toThrow()
    expect(ligne.unitPrice.toFixed(2)).toBe('42.50')
    expect(projete.totalHT).toBe(42.5)
    expect(projete.totalTTC).toBe(51)
  })

  it.each(ROUTES_CREATION)('%s applique withTotals + linesToEuros à sa réponse', (rel) => {
    const src = readFileSync(path.join(ROOT, rel), 'utf8')
    // La réponse de création ne doit jamais renvoyer l'entité Prisma nue.
    expect(src).toMatch(/NextResponse\.json\(\s*withTotals\(/)
    expect(src).toContain('linesToEuros(')
    expect(src).not.toMatch(/NextResponse\.json\((invoice|quote),\s*\{\s*status:\s*201/)
  })
})
