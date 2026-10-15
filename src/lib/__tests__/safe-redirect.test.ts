/**
 * Anti open-redirect — safeInternalPath (V15).
 *
 * Prouve qu'une cible de redirection contrôlée par l'attaquant ne peut jamais
 * quitter l'origine : seules les URL internes (chemin relatif à la racine) sont
 * conservées, tout le reste retombe sur le fallback.
 */
import { describe, it, expect } from 'vitest'
import { safeInternalPath } from '@/lib/safe-redirect'

describe('safeInternalPath — cibles internes autorisées', () => {
  it('conserve un chemin relatif simple', () => {
    expect(safeInternalPath('/dashboard')).toBe('/dashboard')
    expect(safeInternalPath('/dashboard/clients?tab=1#x')).toBe('/dashboard/clients?tab=1#x')
    expect(safeInternalPath('/')).toBe('/')
  })
})

describe('safeInternalPath — cibles externes rejetées (retombe sur le fallback)', () => {
  it('URL absolue http/https', () => {
    expect(safeInternalPath('https://evil.com')).toBe('/')
    expect(safeInternalPath('http://evil.com/login')).toBe('/')
  })
  it('protocol-relative //host', () => {
    expect(safeInternalPath('//evil.com')).toBe('/')
    expect(safeInternalPath('//evil.com/path')).toBe('/')
  })
  it('variantes à antislash (normalisées en //host par les navigateurs)', () => {
    expect(safeInternalPath('/\\evil.com')).toBe('/')
    expect(safeInternalPath('/ /evil.com')).toBe('/') // blanc de tête + suite
  })
  it('schéma dangereux sans slash de tête', () => {
    expect(safeInternalPath('javascript:alert(1)')).toBe('/')
    expect(safeInternalPath('data:text/html,x')).toBe('/')
  })
  it('valeurs vides / absentes', () => {
    expect(safeInternalPath(null)).toBe('/')
    expect(safeInternalPath(undefined)).toBe('/')
    expect(safeInternalPath('')).toBe('/')
  })
  it('fallback personnalisé respecté', () => {
    expect(safeInternalPath('https://evil.com', '/login')).toBe('/login')
  })
})
