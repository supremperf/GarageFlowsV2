/**
 * Résolution de versions de toolchain (V15.1) — anti-régression.
 *
 * Ferme définitivement le bug : « package.json autorise ^5.16.1, donc la baseline
 * affirme que 5.16.1 est installé » alors que package-lock verrouille 5.22.0.
 * La version RÉSOLUE vient de node_modules / package-lock, JAMAIS d'une plage
 * semver tronquée. La plage déclarée est conservée séparément.
 */
import { describe, it, expect } from 'vitest'
import {
  declaredRange,
  resolveVersion,
  buildDependency,
  buildDependencyMap,
} from '../../scripts/lib/toolchain-versions.mjs'

const lockWith = (name: string, version: string) => ({ packages: { [`node_modules/${name}`]: { version } } })

describe('resolveVersion — source de vérité de la version réelle', () => {
  it('Cas ^ : déclaré ^1.2.0, lock 1.9.4 → resolved 1.9.4 (jamais 1.2.0)', () => {
    const pkg = { dependencies: { example: '^1.2.0' } }
    const dep = buildDependency(pkg, 'example', { lock: lockWith('example', '1.9.4') })
    expect(dep).toEqual({ declared: '^1.2.0', resolved: '1.9.4', source: 'package-lock' })
    expect(dep.resolved).not.toBe('1.2.0')
  })

  it('Cas ~ : déclaré ~4.5.0, lock 4.5.7 → resolved 4.5.7', () => {
    const pkg = { dependencies: { pkg: '~4.5.0' } }
    const dep = buildDependency(pkg, 'pkg', { lock: lockWith('pkg', '4.5.7') })
    expect(dep.declared).toBe('~4.5.0')
    expect(dep.resolved).toBe('4.5.7')
  })

  it('Cas exact : 5.22.0 partout → resolved 5.22.0', () => {
    const pkg = { dependencies: { prisma: '5.22.0' } }
    const dep = buildDependency(pkg, 'prisma', { lock: lockWith('prisma', '5.22.0') })
    expect(dep).toEqual({ declared: '5.22.0', resolved: '5.22.0', source: 'package-lock' })
  })

  it('node_modules prime sur le lock (version réellement installée)', () => {
    const pkg = { dependencies: { prisma: '^5.16.1' } }
    const dep = buildDependency(pkg, 'prisma', { installed: '5.22.0', lock: lockWith('prisma', '5.99.9') })
    expect(dep.resolved).toBe('5.22.0')
    expect(dep.source).toBe('node_modules')
  })

  it('Absent du lock ET de node_modules → resolved null, status NOT_RESOLVED (jamais inventé)', () => {
    const pkg = { dependencies: { ghost: '^1.0.0' } }
    const dep = buildDependency(pkg, 'ghost', { lock: lockWith('other', '2.0.0') })
    expect(dep.resolved).toBeNull()
    expect(dep.status).toBe('NOT_RESOLVED')
    expect(dep.declared).toBe('^1.0.0')
  })

  it('déclaré ^5 (plage large) n’est JAMAIS retourné comme version installée', () => {
    const pkg = { devDependencies: { typescript: '^5' } }
    const dep = buildDependency(pkg, 'typescript', { installed: '5.9.3' })
    expect(dep.declared).toBe('^5')
    expect(dep.resolved).toBe('5.9.3')
    expect(dep.resolved).not.toBe('5')
  })

  it('declaredRange lit dependencies ET devDependencies', () => {
    expect(declaredRange({ dependencies: { a: '^1' } }, 'a')).toBe('^1')
    expect(declaredRange({ devDependencies: { b: '~2' } }, 'b')).toBe('~2')
    expect(declaredRange({}, 'x')).toBeNull()
  })

  it('resolveVersion pur : sans source → NOT_RESOLVED', () => {
    expect(resolveVersion('x', {})).toEqual({ resolved: null, source: null, status: 'NOT_RESOLVED' })
  })
})

describe('buildDependencyMap — carte des composants critiques', () => {
  it('construit declared+resolved pour chaque nom demandé', () => {
    const pkg = { dependencies: { prisma: '^5.16.1', '@prisma/client': '^5.16.1' } }
    const lock = { packages: { 'node_modules/prisma': { version: '5.22.0' }, 'node_modules/@prisma/client': { version: '5.22.0' } } }
    const map = buildDependencyMap(pkg, { lock, names: ['prisma', '@prisma/client'] })
    expect(map.prisma.resolved).toBe('5.22.0')
    expect(map['@prisma/client'].resolved).toBe('5.22.0')
    expect(map.prisma.declared).toBe('^5.16.1')
  })
})
