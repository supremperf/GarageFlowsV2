import { describe, it, expect } from 'vitest'
import { CreateInvoiceSchema, UpdateInvoiceSchema, CreateQuoteSchema } from '../schemas'

/**
 * Régression — e-mail client FACULTATIF laissé vide.
 *
 * Un formulaire HTML envoie `''` pour un champ vide, jamais `undefined`.
 * `z.string().email().optional().nullable()` refuse `''` : enregistrer une
 * facture sans e-mail renvoyait
 *   400 {"error":"Données invalides","fieldErrors":{"clientEmail":["Email invalide"]}}
 * alors que l'interface ne marque pas ce champ comme requis. Pour un client de
 * passage — cas courant en garage — la facture était impossible à créer.
 *
 * Constaté en test fonctionnel réel sur l'application packagée.
 */
describe('e-mail client facultatif', () => {
  const base = { clientName: 'Jean Moreau', lines: [{ description: 'Vidange', quantity: 1, unitPrice: 85.4 }] }

  for (const [nom, schema] of [
    ['CreateInvoiceSchema', CreateInvoiceSchema],
    ['CreateQuoteSchema', CreateQuoteSchema],
  ] as const) {
    it(`${nom} accepte une chaîne vide et la normalise en null`, () => {
      const r = schema.safeParse({ ...base, clientEmail: '' })
      expect(r.success).toBe(true)
      if (r.success) expect(r.data.clientEmail).toBeNull()
    })

    it(`${nom} accepte des espaces seuls`, () => {
      const r = schema.safeParse({ ...base, clientEmail: '   ' })
      expect(r.success).toBe(true)
      if (r.success) expect(r.data.clientEmail).toBeNull()
    })

    it(`${nom} accepte l'absence du champ`, () => {
      expect(schema.safeParse(base).success).toBe(true)
    })

    it(`${nom} conserve un e-mail valide`, () => {
      const r = schema.safeParse({ ...base, clientEmail: 'jean.moreau@example.fr' })
      expect(r.success).toBe(true)
      if (r.success) expect(r.data.clientEmail).toBe('jean.moreau@example.fr')
    })

    it(`${nom} REFUSE toujours un e-mail réellement invalide`, () => {
      const r = schema.safeParse({ ...base, clientEmail: 'pas-un-email' })
      expect(r.success).toBe(false)
    })
  }

  it('UpdateInvoiceSchema accepte aussi le vide (édition d’une facture existante)', () => {
    const r = UpdateInvoiceSchema.safeParse({ clientEmail: '' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.clientEmail).toBeNull()
  })
})
