/**
 * Matrice de permissions — « deny by default ».
 * Prouve qu'un mécanicien ne dispose QUE de ses permissions restreintes et
 * qu'aucune permission administrative/financière ne lui est accordée.
 */
import { describe, it, expect } from 'vitest'
import { can, permissionsOf, type Permission } from '@/lib/authz'

describe('authz — MECHANIC (périmètre strict)', () => {
  const allowed: Permission[] = [
    'job:read_assigned', 'schedule:read_self', 'photo:create_assigned',
    'comment:create_assigned', 'note:create_assigned', 'observation:create_assigned',
    'issue:create_assigned', 'checklist:update_assigned', 'timer:update_assigned',
    'profile:read_self', 'session:logout',
  ]
  const denied: Permission[] = [
    'job:manage', 'customer:manage', 'vehicle:manage', 'invoice:manage', 'quote:manage',
    'financial:read', 'stock:manage', 'settings:manage', 'user:manage', 'mechanic:manage',
    'assignment:manage', 'license:manage', 'mechanicLicense:register', 'mechanicLicense:assign',
    'mechanicLicense:revoke', 'mechanicLicense:read',
  ]

  for (const p of allowed) {
    it(`MECHANIC a la permission ${p}`, () => expect(can('MECHANIC', p)).toBe(true))
  }
  for (const p of denied) {
    it(`MECHANIC N'A PAS la permission ${p}`, () => expect(can('MECHANIC', p)).toBe(false))
  }
})

describe('authz — deny by default', () => {
  // Object-prototype property names are strings too, but never application roles.
  // Both public helpers must reject them without throwing or returning permissions.
  const inheritedNames = ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty', '__defineGetter__']

  it.each(inheritedNames)('can refuse le rôle hérité %s sans exception', (role) => {
    expect(can(role, 'job:manage')).toBe(false)
  })

  it.each(inheritedNames)('permissionsOf refuse le rôle hérité %s sans exception', (role) => {
    expect(permissionsOf(role)).toEqual([])
  })

  it('un rôle inconnu ne possède aucune permission', () => {
    expect(can('HACKER', 'job:read_assigned')).toBe(false)
    expect(can('', 'job:manage')).toBe(false)
    expect(can(null, 'job:manage')).toBe(false)
    expect(can(undefined, 'settings:manage')).toBe(false)
  })

  it('OWNER est un sur-ensemble de MANAGER (permissions mécanicien incluses)', () => {
    const owner = new Set(permissionsOf('OWNER'))
    for (const p of permissionsOf('MANAGER')) expect(owner.has(p)).toBe(true)
    expect(can('OWNER', 'mechanicLicense:assign')).toBe(true)
    expect(can('OWNER', 'mechanicLicense:revoke')).toBe(true)
  })

  it('MANAGER lit les accès mais ne peut pas les attribuer/révoquer', () => {
    expect(can('MANAGER', 'mechanicLicense:read')).toBe(true)
    expect(can('MANAGER', 'mechanicLicense:disconnect')).toBe(true)
    expect(can('MANAGER', 'mechanicLicense:assign')).toBe(false)
    expect(can('MANAGER', 'mechanicLicense:revoke')).toBe(false)
    expect(can('MANAGER', 'mechanicLicense:register')).toBe(false)
  })

  it('RECEPTIONIST ne gère pas les accès mécaniciens ni le financier', () => {
    expect(can('RECEPTIONIST', 'mechanicLicense:read')).toBe(false)
    expect(can('RECEPTIONIST', 'financial:read')).toBe(false)
  })
})
