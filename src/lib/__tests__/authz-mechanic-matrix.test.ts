/**
 * Matrice de permissions mécanicien (task « Permissions mécanicien »).
 * Prouve : deny-by-default, périmètre strict du MÉCANICIEN, et que les actions
 * d'administration des clés sont réservées (OWNER ⊇ MANAGER ⊇ …).
 */
import { describe, it, expect } from 'vitest'
import { can, type Permission } from '@/lib/authz'

type Role = 'OWNER' | 'MANAGER' | 'RECEPTIONIST' | 'MECHANIC'
const roles: Role[] = ['OWNER', 'MANAGER', 'RECEPTIONIST', 'MECHANIC']

// Chaque ligne : permission → rôles ATTENDUS true (les autres doivent être false).
const MATRIX: Array<{ perm: Permission; allowed: Role[] }> = [
  // Espace mécanicien — le mécanicien agit sur SON travail uniquement.
  { perm: 'job:read_assigned',        allowed: ['MECHANIC'] },
  { perm: 'photo:create_assigned',    allowed: ['MECHANIC'] },
  { perm: 'comment:create_assigned',  allowed: ['MECHANIC'] },
  { perm: 'timer:update_assigned',    allowed: ['MECHANIC'] },
  // Le mécanicien ne voit JAMAIS les finances / la gestion.
  { perm: 'financial:read',           allowed: ['OWNER', 'MANAGER'] },
  { perm: 'job:manage',               allowed: ['OWNER', 'MANAGER', 'RECEPTIONIST'] },
  { perm: 'settings:manage',          allowed: ['OWNER'] },
  // Administration des clés mécanicien.
  { perm: 'mechanicLicense:read',       allowed: ['OWNER', 'MANAGER'] },
  { perm: 'mechanicLicense:disconnect', allowed: ['OWNER', 'MANAGER'] },
  { perm: 'mechanicLicense:register',   allowed: ['OWNER'] },
  { perm: 'mechanicLicense:assign',     allowed: ['OWNER'] },
  { perm: 'mechanicLicense:suspend',    allowed: ['OWNER'] },
  { perm: 'mechanicLicense:reactivate', allowed: ['OWNER'] },
  { perm: 'mechanicLicense:revoke',     allowed: ['OWNER'] },
  { perm: 'mechanicLicense:copyToken',  allowed: ['OWNER'] },
]

describe('matrice de permissions mécanicien / staff', () => {
  for (const { perm, allowed } of MATRIX) {
    it(`${perm} : autorisé pour [${allowed.join(', ')}] uniquement`, () => {
      for (const role of roles) {
        expect(can(role, perm)).toBe(allowed.includes(role))
      }
    })
  }

  it('deny-by-default : rôle inconnu / vide → toujours refusé', () => {
    expect(can('ADMINX' as Role, 'mechanicLicense:read')).toBe(false)
    expect(can(null, 'job:read_assigned')).toBe(false)
    expect(can(undefined, 'settings:manage')).toBe(false)
  })

  it('le MÉCANICIEN n\'a AUCUNE permission d\'administration ni financière', () => {
    const forbidden: Permission[] = [
      'financial:read', 'job:manage', 'settings:manage', 'user:manage',
      'mechanicLicense:read', 'mechanicLicense:register', 'mechanicLicense:assign',
      'mechanicLicense:revoke', 'mechanicLicense:copyToken', 'invoice:manage',
    ]
    for (const p of forbidden) expect(can('MECHANIC', p)).toBe(false)
  })
})
