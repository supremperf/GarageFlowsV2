/**
 * Garde-fous PURS du cycle de vie employé — autorisation serveur et protection
 * du dernier propriétaire actif.
 */
import { describe, it, expect } from 'vitest'
import {
  isValidRole, canManageEmployees, activeOwnerCount, assertNotLastOwner,
  validateSuspend, validateRoleChange, validateRevokeSessions, validateTransferOwnership,
  type EmployeeLike,
} from '../lifecycle'

const owner: EmployeeLike = { id: 'o1', role: 'OWNER', status: 'active' }
const owner2: EmployeeLike = { id: 'o2', role: 'OWNER', status: 'active' }
const recept: EmployeeLike = { id: 'r1', role: 'RECEPTIONIST', status: 'active' }
const suspendedOwner: EmployeeLike = { id: 'o3', role: 'OWNER', status: 'suspended' }

describe('rôles & autorisation', () => {
  it('valide les rôles connus', () => {
    expect(isValidRole('OWNER')).toBe(true)
    expect(isValidRole('MANAGER')).toBe(true)
    expect(isValidRole('ROOT')).toBe(false)
  })
  it('seul OWNER gère les employés', () => {
    expect(canManageEmployees('OWNER')).toBe(true)
    expect(canManageEmployees('MANAGER')).toBe(false)
    expect(canManageEmployees('RECEPTIONIST')).toBe(false)
  })
  it('compte les propriétaires ACTIFS', () => {
    expect(activeOwnerCount([owner, owner2, recept, suspendedOwner])).toBe(2)
  })
})

describe('protection du dernier propriétaire', () => {
  it('interdit de retirer le seul propriétaire actif', () => {
    const users = [owner, recept]
    expect(assertNotLastOwner(users, 'o1', false).ok).toBe(false)
  })
  it("autorise si un AUTRE propriétaire actif subsiste", () => {
    const users = [owner, owner2, recept]
    expect(assertNotLastOwner(users, 'o1', false).ok).toBe(true)
  })
  it("autorise si la cible reste propriétaire actif après l'opération", () => {
    const users = [owner, recept]
    expect(assertNotLastOwner(users, 'o1', true).ok).toBe(true)
  })
  it('sans effet sur un non-propriétaire', () => {
    const users = [owner, recept]
    expect(assertNotLastOwner(users, 'r1', false).ok).toBe(true)
  })
})

describe('validateSuspend', () => {
  const actor = { id: 'o1', role: 'OWNER' }
  it('refuse un acteur non propriétaire', () => {
    expect(validateSuspend({ id: 'x', role: 'MANAGER' }, [owner, owner2], 'o2').ok).toBe(false)
  })
  it("refuse l'auto-suspension", () => {
    expect(validateSuspend(actor, [owner, owner2], 'o1').ok).toBe(false)
  })
  it('refuse de suspendre le dernier propriétaire', () => {
    expect(validateSuspend(actor, [owner, recept], 'o1').ok).toBe(false) // self anyway
    expect(validateSuspend({ id: 'r1', role: 'OWNER' }, [owner, { id: 'r1', role: 'OWNER', status: 'active' }], 'o1').ok).toBe(true)
  })
  it('autorise la suspension d\'un employé ordinaire', () => {
    expect(validateSuspend(actor, [owner, recept], 'r1').ok).toBe(true)
  })
})

describe('validateRoleChange', () => {
  const actor = { id: 'o1', role: 'OWNER' }
  it('refuse un rôle invalide', () => {
    expect(validateRoleChange(actor, [owner, owner2], 'o2', 'ROOT').ok).toBe(false)
  })
  it('refuse de rétrograder le dernier propriétaire', () => {
    expect(validateRoleChange(actor, [owner, recept], 'o1', 'MANAGER').ok).toBe(false)
  })
  it('autorise la rétrogradation si un autre propriétaire subsiste', () => {
    expect(validateRoleChange(actor, [owner, owner2], 'o1', 'MANAGER').ok).toBe(true)
  })
  it('autorise la promotion en propriétaire', () => {
    expect(validateRoleChange(actor, [owner, recept], 'r1', 'OWNER').ok).toBe(true)
  })
})

describe('validateRevokeSessions & validateTransferOwnership', () => {
  const actor = { id: 'o1', role: 'OWNER' }
  it('révocation réservée au propriétaire', () => {
    expect(validateRevokeSessions(actor).ok).toBe(true)
    expect(validateRevokeSessions({ id: 'x', role: 'MECHANIC' }).ok).toBe(false)
  })
  it('transfert : refuse soi-même et cible inactive', () => {
    expect(validateTransferOwnership(actor, [owner, recept], 'o1').ok).toBe(false)
    expect(validateTransferOwnership(actor, [owner, suspendedOwner], 'o3').ok).toBe(false)
    expect(validateTransferOwnership(actor, [owner, recept], 'r1').ok).toBe(true)
  })
})
