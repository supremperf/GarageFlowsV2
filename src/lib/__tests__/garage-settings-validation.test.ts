/**
 * RÉGRESSION — les réglages du garage partaient en base SANS validation.
 *
 * Trouvé en jouant le parcours d'un vrai garage sur une base vierge, pas en
 * relisant le code : `UpdateGarageSchema` existait depuis toujours dans
 * `src/lib/schemas`, mais `PATCH /api/garages` ne l'appelait pas. Le corps de
 * requête était recopié champ par champ, avec des coercitions maison.
 *
 * Quatre conséquences mesurées sur l'API réelle :
 *
 *  1. `taxRate: 150` accepté et PERSISTÉ. Le taux du garage alimente chaque
 *     devis et chaque facture : un garage pouvait facturer 150 % de TVA.
 *  2. `taxRate: 0` REMPLACÉ par 20, à cause de `parseFloat(x) || 20`. Un garage
 *     en franchise de TVA (art. 293 B du CGI — le cas de tout auto-entrepreneur)
 *     ne pouvait tout simplement pas se déclarer exonéré.
 *  3. `hourlyRate: 68.123456` silencieusement remplacé par 60 €/h
 *     (`parseAmountToScaled(...) ?? 600000`) : le garage facturait sa
 *     main-d'œuvre à un tarif qu'il n'avait jamais choisi.
 *  4. `currency: 'EUROS'` et une adresse e-mail malformée acceptées telles quelles.
 *
 * Même famille pour `workshopStartHour: 0` (→ 8) et `warrantyMonthsDefault: 0`
 * (→ 12) : `||` écrase toute valeur nulle légitime.
 *
 * Ces tests portent sur le SCHÉMA, seul juge désormais appelé par le handler.
 */
import { describe, it, expect } from 'vitest'
import { UpdateGarageSchema, CreateMechanicSchema } from '@/lib/schemas'
import { normalizeSpecialty, parseSpecialty } from '@/lib/specialty'

const ok = (patch: Record<string, unknown>) => UpdateGarageSchema.safeParse(patch).success

describe('réglages du garage — bornes financières', () => {
  it('refuse un taux de TVA hors de [0, 100]', () => {
    expect(ok({ taxRate: 150 })).toBe(false)
    expect(ok({ taxRate: -1 })).toBe(false)
  })

  it('ACCEPTE 0 % — franchise de TVA (art. 293 B du CGI)', () => {
    const r = UpdateGarageSchema.safeParse({ taxRate: 0 })
    expect(r.success).toBe(true)
    // La valeur doit ressortir telle quelle : c'est `|| 20` qui la détruisait.
    expect(r.success && r.data.taxRate).toBe(0)
  })

  it('accepte les taux réels français', () => {
    for (const t of [0, 5.5, 10, 20]) expect(ok({ taxRate: t })).toBe(true)
  })

  it('refuse un tarif horaire à plus de 4 décimales au lieu de le remplacer', () => {
    expect(ok({ hourlyRate: 68.123456 })).toBe(false)
    expect(ok({ hourlyRate: 68.5 })).toBe(true)
    expect(ok({ hourlyRate: 0 })).toBe(true)      // atelier qui ne facture pas la main-d'œuvre
  })

  it('refuse une devise qui n\'est pas un code à 3 lettres', () => {
    expect(ok({ currency: 'EUROS' })).toBe(false)
    expect(ok({ currency: 'EUR' })).toBe(true)
  })

  it('refuse une adresse e-mail malformée', () => {
    expect(ok({ email: 'pas-un-email' })).toBe(false)
    expect(ok({ email: 'contact@garage-dupre.fr' })).toBe(true)
  })
})

describe('réglages du garage — atelier et documents', () => {
  it('ACCEPTE 0 pour les champs où zéro a un sens', () => {
    // `|| 8` et `|| 12` écrasaient ces valeurs.
    const h = UpdateGarageSchema.safeParse({ workshopStartHour: 0 })
    expect(h.success && h.data.workshopStartHour).toBe(0)
    const w = UpdateGarageSchema.safeParse({ warrantyMonthsDefault: 0 })
    expect(w.success && w.data.warrantyMonthsDefault).toBe(0)
    const s = UpdateGarageSchema.safeParse({ smartReminderMonths: 0 })
    expect(s.success && s.data.smartReminderMonths).toBe(0)
  })

  it('refuse des horaires d\'atelier impossibles', () => {
    expect(ok({ workshopStartHour: 25 })).toBe(false)
    expect(ok({ workshopEndHour: 0 })).toBe(false)
    // Fermeture avant ouverture : un planning vide, silencieusement.
    expect(ok({ workshopStartHour: 18, workshopEndHour: 8 })).toBe(false)
    expect(ok({ workshopStartHour: 8, workshopEndHour: 18 })).toBe(true)
  })

  it('refuse un préfixe de document vide', () => {
    expect(ok({ invoicePrefix: '' })).toBe(false)
    expect(ok({ workOrderPrefix: '' })).toBe(false)
    expect(ok({ purchaseOrderPrefix: '' })).toBe(false)
    expect(ok({ invoicePrefix: 'FAC', workOrderPrefix: 'OR', purchaseOrderPrefix: 'BC' })).toBe(true)
  })

  it('les champs d\'atelier ne sont plus ignorés par le schéma', () => {
    // Zod retire les clés inconnues : absents du schéma, ces réglages auraient
    // été SILENCIEUSEMENT supprimés une fois la validation branchée.
    const r = UpdateGarageSchema.safeParse({
      workshopStartHour: 7, workshopEndHour: 19, workOrderPrefix: 'OR',
      purchaseOrderPrefix: 'BC', warrantyMonthsDefault: 24,
      smartReminderMonths: 6, loanerEnabled: true,
    })
    expect(r.success).toBe(true)
    expect(r.success && Object.keys(r.data).sort()).toEqual([
      'loanerEnabled', 'purchaseOrderPrefix', 'smartReminderMonths',
      'warrantyMonthsDefault', 'workOrderPrefix', 'workshopEndHour', 'workshopStartHour',
    ])
  })
})

/**
 * RÉGRESSION — spécialité de mécanicien acceptée puis jetée.
 *
 * `POST /api/mechanics` avec `specialty: 'Moteur'` répondait 201 et stockait
 * `"[]"`. Le schéma acceptait n'importe quelle chaîne, alors que l'écriture
 * (`normalizeSpecialty`) ne conserve QUE du JSON de tableau — comportement
 * délibéré, pour qu'une ligne corrompue ne fasse jamais lever la lecture.
 * L'entrée disparaissait donc en silence. Le refus est désormais explicite.
 */
describe('spécialité de mécanicien — accepter ou refuser, jamais jeter', () => {
  it('refuse un libellé nu au lieu de le perdre', () => {
    expect(CreateMechanicSchema.safeParse({ name: 'K', color: '#1d4ed8', specialty: 'Moteur' }).success).toBe(false)
  })

  it('accepte un tableau, la forme normale envoyée par l\'interface', () => {
    const r = CreateMechanicSchema.safeParse({ name: 'K', color: '#1d4ed8', specialty: ['Moteur', 'Freins'] })
    expect(r.success).toBe(true)
  })

  it('accepte un tableau JSON sérialisé (rétro-compat clients tiers)', () => {
    expect(CreateMechanicSchema.safeParse({ name: 'K', color: '#1d4ed8', specialty: '["Moteur"]' }).success).toBe(true)
  })

  it('tout ce qui est accepté survit à la normalisation', () => {
    // L'invariant qui manquait : ce que le schéma laisse passer doit être
    // stocké, pas réduit à un tableau vide.
    for (const entree of [['Moteur', 'Freins'], '["Moteur"]', []]) {
      const r = CreateMechanicSchema.safeParse({ name: 'K', color: '#1d4ed8', specialty: entree })
      expect(r.success, `refusé : ${JSON.stringify(entree)}`).toBe(true)
      const stocke = JSON.parse(normalizeSpecialty(r.success ? r.data.specialty : null))
      expect(stocke).toEqual(parseSpecialty(entree))
    }
  })
})
