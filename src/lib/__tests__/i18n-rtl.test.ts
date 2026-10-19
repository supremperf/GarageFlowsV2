/**
 * Restauration lang/dir sur <html> (AUD-026) — lot H.
 *
 * Prouve que applyLangAttributes pose bien lang ET dir (LTR/RTL) sur
 * documentElement — le correctif qui manquait au rechargement (une langue RTL
 * comme l'arabe restait en LTR avec lang="fr"). Teste l'effet DOM via un
 * document stubbé (pas de dépendance DOM).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { applyLangAttributes } from '@/lib/i18n/apply-lang'

const attrs: Record<string, string> = {}
const realDoc = (globalThis as { document?: unknown }).document

beforeEach(() => {
  for (const k of Object.keys(attrs)) delete attrs[k]
  ;(globalThis as unknown as { document: unknown }).document = {
    documentElement: { setAttribute: (k: string, v: string) => { attrs[k] = v } },
  }
})
afterEach(() => {
  ;(globalThis as unknown as { document: unknown }).document = realDoc
  vi.restoreAllMocks()
})

describe('applyLangAttributes', () => {
  it('arabe → lang=ar ET dir=rtl (le bug : dir restait ltr)', () => {
    applyLangAttributes('ar')
    expect(attrs.lang).toBe('ar')
    expect(attrs.dir).toBe('rtl')
  })

  it('français → lang=fr ET dir=ltr', () => {
    applyLangAttributes('fr')
    expect(attrs.lang).toBe('fr')
    expect(attrs.dir).toBe('ltr')
  })

  it('anglais → lang=en ET dir=ltr', () => {
    applyLangAttributes('en')
    expect(attrs.lang).toBe('en')
    expect(attrs.dir).toBe('ltr')
  })

  it('code inconnu → aucun attribut posé (pas de crash)', () => {
    applyLangAttributes('zz' as never)
    expect(attrs.lang).toBeUndefined()
    expect(attrs.dir).toBeUndefined()
  })
})
