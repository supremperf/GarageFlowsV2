/**
 * GF-040 — les pièces d'un ordre de réparation se rattachent au catalogue.
 *
 * ─── Le défaut ──────────────────────────────────────────────────────────────
 * Nom et référence étaient deux champs libres : aucun rattachement, aucun prix
 * repris, aucune disponibilité affichée. Le magasinier recopiait une référence
 * à la main pendant que la pièce existait au catalogue, à deux mètres.
 *
 * ─── Pourquoi le champ ne suffisait pas à l'écran ───────────────────────────
 * `partsJson` n'est pas un blob libre : il traverse `PartLineV1` (permissif,
 * qui STRIPPE les clés inconnues) ou `PartLineV2` (`.strict()`, qui les
 * REFUSE). Ajouter `partId` à la seule interface aurait donc produit un
 * rattachement qui disparaît au rechargement — ou un document refusé.
 *
 * ─── Ce que le lien ne fait PAS ─────────────────────────────────────────────
 * Il ne consomme aucun stock. Un ordre de réparation est prévisionnel, comme un
 * devis : seules la validation d'une facture et la pose d'une pièce sur une
 * intervention décrémentent l'inventaire.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  parsePartsJson, serializePartsJsonV2, partLinesToEuros,
} from '@/lib/money-json'

describe('GF-040 — `partId` survit à l’aller-retour', () => {
  it('une ligne v2 conserve son rattachement', () => {
    const json = serializePartsJsonV2([{
      partId: 'piece-123', name: 'Filtre à huile', reference: 'F-1',
      qtyTenThousandths: 2 * 10_000, unitPriceTenThousandths: 12 * 10_000,
      lineTotalCents: 2400,
    }])
    const relu = parsePartsJson(json)
    expect(relu.version).toBe(2)
    expect(relu.lines[0].partId, 'sans lui, `.strict()` aurait refusé le document').toBe('piece-123')
  })

  it('une ligne v1 (saisie de l’écran) conserve son rattachement', () => {
    // L'écran envoie un TABLEAU : c'est la forme v1, qui strippe les clés
    // inconnues sans rien dire.
    const relu = parsePartsJson(JSON.stringify([
      { partId: 'piece-456', name: 'Plaquettes', reference: 'P-9', qty: 1, unitPrice: 45 },
    ]))
    expect(relu.version).toBe(1)
    expect(relu.lines[0].partId).toBe('piece-456')
  })

  it('la saisie LIBRE reste possible — aucune pièce imposée', () => {
    const relu = parsePartsJson(JSON.stringify([
      { name: 'Pièce hors catalogue', qty: 1, unitPrice: 30 },
    ]))
    expect(relu.lines[0].partId).toBeUndefined()
    expect(relu.lines[0].name).toBe('Pièce hors catalogue')
  })

  it('le rattachement redescend jusqu’à l’écran', () => {
    const euros = partLinesToEuros([{
      partId: 'piece-789', name: 'Courroie', reference: 'C-3',
      qtyTenThousandths: 10_000, unitPriceTenThousandths: 60 * 10_000,
      lineTotalCents: 6000,
    }])
    expect(euros[0].partId).toBe('piece-789')
    expect(euros[0].unitPrice).toBe(60)
  })

  it('une ligne SANS rattachement ne fabrique pas de clé', () => {
    // Le JSON canonique d'un document déjà SIGNÉ ne doit pas bouger d'un
    // caractère, sinon sa signature ne se revérifierait plus.
    const relu = parsePartsJson(JSON.stringify([{ name: 'X', qty: 1, unitPrice: 1 }]))
    expect(Object.prototype.hasOwnProperty.call(relu.lines[0], 'partId')).toBe(false)
  })

  it('un identifiant aberrant est refusé, pas tronqué', () => {
    expect(() => parsePartsJson(JSON.stringify([
      { partId: 'x'.repeat(200), name: 'X', qty: 1, unitPrice: 1 },
    ]))).toThrow()
  })
})

describe('GF-040 — l’écran choisit dans le stock', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../components/WorkOrderModal.tsx'), 'utf8',
  )

  it('le nom de pièce passe par l’autocomplétion du catalogue', () => {
    expect(src).toContain('<PartAutocomplete')
    expect(src).toContain('onSelectPart')
    expect(src).toContain('linkedPartId={p.partId}')
  })

  it('choisir une pièce reprend son PRIX et sa RÉFÉRENCE', () => {
    expect(src).toContain('unitPrice: piece.unitPrice')
    expect(src).toContain("reference: piece.reference ?? ''")
  })

  it('modifier la saisie DÉLIE la ligne', () => {
    // Sinon une ligne renommée à la main resterait rattachée à une autre pièce.
    expect(src).toContain('onClearPart')
    expect(src).toContain('partId: null')
  })

  it('l’ordre de réparation ne décrémente toujours AUCUN stock', () => {
    // Document prévisionnel : le rattachement est documentaire.
    expect(src).not.toMatch(/decrement|stockMovement/)
  })
})
