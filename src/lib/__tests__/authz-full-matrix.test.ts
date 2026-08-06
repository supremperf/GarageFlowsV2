/**
 * Matrice d'autorisation COMPLÈTE — permutation exhaustive rôle × permission
 * (lot C, axe « rôles »).
 *
 * Les tests existants prouvent le rôle MECHANIC en entier et quelques cas
 * qualitatifs pour les autres. Ici on asserte les 4 × 32 = 128 cellules
 * explicitement contre une table ATTENDUE déclarée INDÉPENDAMMENT de authz.ts :
 * toute dérive de la matrice de production (permission ajoutée/retirée à un rôle)
 * fait échouer ce test. C'est le comble du trou de couverture signalé
 * (authz-mechanic-matrix n'énumérait que 15 permissions sur 32).
 */
import { describe, it, expect } from 'vitest'
import { can, permissionsOf, type Permission, type Role } from '@/lib/authz'

// ── Univers complet des 32 permissions (déclaré ici, pas importé de authz.ts) ──
const ALL_PERMISSIONS: Permission[] = [
  // espace mécanicien (11)
  'job:read_assigned', 'schedule:read_self', 'photo:create_assigned', 'comment:create_assigned',
  'note:create_assigned', 'observation:create_assigned', 'issue:create_assigned',
  'checklist:update_assigned', 'timer:update_assigned', 'profile:read_self', 'session:logout',
  // gestion des accès mécaniciens (9)
  'mechanicLicense:read', 'mechanicLicense:register', 'mechanicLicense:assign', 'mechanicLicense:suspend',
  'mechanicLicense:revoke', 'mechanicLicense:reactivate', 'mechanicLicense:disconnect',
  'mechanicLicense:copyToken', 'mechanicNote:read',
  // périmètre garage (12)
  'job:manage', 'customer:manage', 'vehicle:manage', 'invoice:manage', 'quote:manage',
  'financial:read', 'stock:manage', 'settings:manage', 'user:manage', 'mechanic:manage',
  'assignment:manage', 'license:manage',
]

// ── Table ATTENDUE (source de vérité indépendante) ────────────────────────────
const EXPECTED: Record<Role, Set<Permission>> = {
  MECHANIC: new Set<Permission>([
    'job:read_assigned', 'schedule:read_self', 'photo:create_assigned', 'comment:create_assigned',
    'note:create_assigned', 'observation:create_assigned', 'issue:create_assigned',
    'checklist:update_assigned', 'timer:update_assigned', 'profile:read_self', 'session:logout',
  ]),
  RECEPTIONIST: new Set<Permission>([
    'job:manage', 'customer:manage', 'vehicle:manage', 'quote:manage', 'mechanicNote:read',
  ]),
  MANAGER: new Set<Permission>([
    'job:manage', 'customer:manage', 'vehicle:manage', 'quote:manage', 'mechanicNote:read',
    'invoice:manage', 'financial:read', 'stock:manage', 'mechanic:manage', 'assignment:manage',
    'mechanicLicense:read', 'mechanicLicense:disconnect',
  ]),
  OWNER: new Set<Permission>([
    'job:manage', 'customer:manage', 'vehicle:manage', 'quote:manage', 'mechanicNote:read',
    'invoice:manage', 'financial:read', 'stock:manage', 'mechanic:manage', 'assignment:manage',
    'mechanicLicense:read', 'mechanicLicense:disconnect',
    'settings:manage', 'user:manage', 'license:manage', 'mechanicLicense:register',
    'mechanicLicense:assign', 'mechanicLicense:suspend', 'mechanicLicense:revoke',
    'mechanicLicense:reactivate', 'mechanicLicense:copyToken',
  ]),
}

const ROLES: Role[] = ['OWNER', 'MANAGER', 'RECEPTIONIST', 'MECHANIC']

describe('authz — 128 cellules rôle × permission asserties explicitement', () => {
  for (const role of ROLES) {
    for (const perm of ALL_PERMISSIONS) {
      const expected = EXPECTED[role].has(perm)
      it(`${role} × ${perm} = ${expected ? 'ACCORDÉ' : 'REFUSÉ'}`, () => {
        expect(can(role, perm)).toBe(expected)
      })
    }
  }
})

describe('authz — comptes par rôle (garde contre l\'ajout silencieux de permissions)', () => {
  it('MECHANIC a exactement 11 permissions, toutes du périmètre « _assigned/_self/logout »', () => {
    expect(permissionsOf('MECHANIC')).toHaveLength(11)
    for (const p of permissionsOf('MECHANIC')) {
      expect(p === 'session:logout' || /_(assigned|self)$/.test(p)).toBe(true)
    }
  })
  it('RECEPTIONIST a exactement 5 permissions', () => expect(permissionsOf('RECEPTIONIST')).toHaveLength(5))
  it('MANAGER a exactement 12 permissions', () => expect(permissionsOf('MANAGER')).toHaveLength(12))
  it('OWNER a exactement 21 permissions', () => expect(permissionsOf('OWNER')).toHaveLength(21))
})

describe('authz — hiérarchie stricte OWNER ⊇ MANAGER ⊇ RECEPTIONIST', () => {
  it('MANAGER est un sur-ensemble strict de RECEPTIONIST', () => {
    const mgr = new Set(permissionsOf('MANAGER'))
    for (const p of permissionsOf('RECEPTIONIST')) expect(mgr.has(p)).toBe(true)
    expect(permissionsOf('MANAGER').length).toBeGreaterThan(permissionsOf('RECEPTIONIST').length)
  })
  it('OWNER est un sur-ensemble strict de MANAGER', () => {
    const own = new Set(permissionsOf('OWNER'))
    for (const p of permissionsOf('MANAGER')) expect(own.has(p)).toBe(true)
    expect(permissionsOf('OWNER').length).toBeGreaterThan(permissionsOf('MANAGER').length)
  })
  it('MECHANIC est DISJOINT du périmètre staff (aucune permission :manage ni financière)', () => {
    for (const p of permissionsOf('MECHANIC')) {
      expect(p.endsWith(':manage')).toBe(false)
      expect(p).not.toBe('financial:read')
    }
  })
})

describe('authz — deny by default', () => {
  it('rôle inconnu → toute permission refusée', () => {
    for (const perm of ALL_PERMISSIONS) expect(can('SUPERADMIN', perm)).toBe(false)
  })
  it('null / undefined / vide → refusé', () => {
    expect(can(null, 'job:manage')).toBe(false)
    expect(can(undefined, 'job:manage')).toBe(false)
    expect(can('', 'job:manage')).toBe(false)
  })
  it('permission inconnue → refusée pour tous les rôles', () => {
    for (const role of ROLES) expect(can(role, 'god:mode' as Permission)).toBe(false)
  })
  it('permissionsOf(rôle inconnu) = liste vide', () => {
    expect(permissionsOf('SUPERADMIN')).toEqual([])
    expect(permissionsOf(null)).toEqual([])
  })
})
