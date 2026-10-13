/**
 * Machine à états des documents légaux (src/lib/document-status.ts).
 *
 * Prouve l'invariant central : un document ÉMIS ne revient jamais à « draft »
 * (c'était la faille qui rouvrait l'édition/suppression d'une facture émise,
 * d'un OR signé, d'un devis accepté). Couvre transitions, verrous de montants
 * et verrous de suppression pour les trois types.
 */
import { describe, it, expect } from 'vitest'
import {
  checkStatusTransition,
  areAmountsLocked,
  isDeletable,
  isDraft,
} from '@/lib/document-status'

describe('checkStatusTransition — invariant « pas de retour à draft »', () => {
  it('refuse tout retour à draft depuis un état émis (facture)', () => {
    for (const from of ['sent', 'paid', 'overdue']) {
      expect(checkStatusTransition('invoice', from, 'draft')).toBeTruthy()
    }
  })
  it('refuse tout retour à draft depuis un état émis (devis)', () => {
    for (const from of ['sent', 'accepted', 'refused', 'converted']) {
      expect(checkStatusTransition('quote', from, 'draft')).toBeTruthy()
    }
  })
  it('refuse tout retour à draft depuis un état non-brouillon (OR)', () => {
    for (const from of ['signed', 'in_progress', 'closed']) {
      expect(checkStatusTransition('workOrder', from, 'draft')).toBeTruthy()
    }
  })

  it('autorise les transitions avant légitimes', () => {
    expect(checkStatusTransition('invoice', 'draft', 'sent')).toBeNull()
    expect(checkStatusTransition('invoice', 'sent', 'paid')).toBeNull()
    expect(checkStatusTransition('invoice', 'sent', 'overdue')).toBeNull()
    expect(checkStatusTransition('quote', 'draft', 'accepted')).toBeNull()
    expect(checkStatusTransition('quote', 'accepted', 'converted')).toBeNull()
    expect(checkStatusTransition('workOrder', 'draft', 'signed')).toBeNull()
    expect(checkStatusTransition('workOrder', 'signed', 'closed')).toBeNull()
  })

  it('autorise une transition idempotente (même statut)', () => {
    expect(checkStatusTransition('invoice', 'paid', 'paid')).toBeNull()
    expect(checkStatusTransition('quote', 'converted', 'converted')).toBeNull()
  })

  it('traite null/undefined comme draft', () => {
    expect(checkStatusTransition('invoice', null, 'sent')).toBeNull()
    expect(checkStatusTransition('invoice', undefined, 'draft')).toBeNull()
  })

  it('refuse de quitter un état terminal (devis converti)', () => {
    expect(checkStatusTransition('quote', 'converted', 'sent')).toBeTruthy()
    expect(checkStatusTransition('quote', 'converted', 'accepted')).toBeTruthy()
  })
})

describe('areAmountsLocked — verrou des montants', () => {
  it('facture : figée dès qu\'elle quitte draft', () => {
    expect(areAmountsLocked('invoice', 'draft')).toBe(false)
    expect(areAmountsLocked('invoice', 'sent')).toBe(true)
    expect(areAmountsLocked('invoice', 'paid')).toBe(true)
    expect(areAmountsLocked('invoice', 'overdue')).toBe(true)
  })
  it('devis : figé une fois accepté ou converti, éditable avant', () => {
    expect(areAmountsLocked('quote', 'draft')).toBe(false)
    expect(areAmountsLocked('quote', 'sent')).toBe(false)
    expect(areAmountsLocked('quote', 'accepted')).toBe(true)
    expect(areAmountsLocked('quote', 'converted')).toBe(true)
  })
  it('OR : les montants ne sont pas figés par statut (verrou de signature séparé)', () => {
    expect(areAmountsLocked('workOrder', 'signed')).toBe(false)
  })
})

describe('isDeletable — verrou de suppression', () => {
  it('facture : seul un brouillon est supprimable', () => {
    expect(isDeletable('invoice', 'draft')).toBe(true)
    for (const s of ['sent', 'paid', 'overdue']) expect(isDeletable('invoice', s)).toBe(false)
  })
  it('devis : brouillon/envoyé/refusé oui ; accepté/converti non', () => {
    expect(isDeletable('quote', 'draft')).toBe(true)
    expect(isDeletable('quote', 'sent')).toBe(true)
    expect(isDeletable('quote', 'refused')).toBe(true)
    expect(isDeletable('quote', 'accepted')).toBe(false)
    expect(isDeletable('quote', 'converted')).toBe(false)
  })
  it('OR : brouillon ET non signé ; un OR signé est scellé même en brouillon', () => {
    expect(isDeletable('workOrder', 'draft', { signed: false })).toBe(true)
    expect(isDeletable('workOrder', 'draft', { signed: true })).toBe(false)
    expect(isDeletable('workOrder', 'signed', { signed: true })).toBe(false)
    expect(isDeletable('workOrder', 'in_progress')).toBe(false)
  })
})

describe('isDraft', () => {
  it('null/undefined/draft = brouillon ; le reste non', () => {
    expect(isDraft(null)).toBe(true)
    expect(isDraft(undefined)).toBe(true)
    expect(isDraft('draft')).toBe(true)
    expect(isDraft('sent')).toBe(false)
  })
})
