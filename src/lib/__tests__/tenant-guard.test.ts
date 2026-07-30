/**
 * Garde multi-tenant (Phase 12) — assertRelations / relationInGarage.
 *
 * Vérifie qu'une FK fournie par le client est acceptée seulement si elle
 * appartient au garage authentifié, et rejetée (400) sinon — protection IDOR
 * de second ordre (empêche d'attacher/lire une ressource d'un autre garage).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const H = vi.hoisted(() => {
  // Ressources par (model, id) → garageId propriétaire.
  const owners: Record<string, string> = {
    'client:c-A': 'A', 'vehicle:v-A': 'A', 'part:p-A': 'A',
    'client:c-B': 'B', 'part:p-B': 'B',
  }
  const finder = (model: string) => ({
    findFirst: async ({ where }: any) =>
      owners[`${model}:${where.id}`] === where.garageId ? { id: where.id } : null,
  })
  return {
    prisma: {
      client:  finder('client'),
      vehicle: finder('vehicle'),
      job:     finder('job'),
      mechanic: finder('mechanic'),
      part:    finder('part'),
      loanerVehicle: finder('loanerVehicle'),
      invoice: finder('invoice'),
      quote:   finder('quote'),
    },
  }
})

vi.mock('@/lib/db', () => ({ prisma: H.prisma }))

import { relationInGarage, assertRelations } from '@/lib/tenant'

describe('relationInGarage', () => {
  it('accepte une ressource du même garage', async () => {
    expect(await relationInGarage('A', 'client', 'c-A')).toBe(true)
    expect(await relationInGarage('A', 'part', 'p-A')).toBe(true)
  })
  it('refuse une ressource d’un autre garage', async () => {
    expect(await relationInGarage('A', 'client', 'c-B')).toBe(false)
    expect(await relationInGarage('B', 'part', 'p-A')).toBe(false)
  })
  it('ignore les FK absentes (rien à vérifier)', async () => {
    expect(await relationInGarage('A', 'client', null)).toBe(true)
    expect(await relationInGarage('A', 'client', undefined)).toBe(true)
  })
})

describe('assertRelations', () => {
  it('renvoie null quand toutes les FK appartiennent au garage', async () => {
    const res = await assertRelations('A', [
      { model: 'client', id: 'c-A' },
      { model: 'vehicle', id: 'v-A' },
      { model: 'part', id: 'p-A' },
    ])
    expect(res).toBeNull()
  })

  it('renvoie 400 dès qu’une FK est hors du garage (anti-IDOR)', async () => {
    const res = await assertRelations('A', [
      { model: 'client', id: 'c-A' },
      { model: 'part', id: 'p-B', label: 'Pièce' },   // appartient au garage B
    ])
    expect(res).not.toBeNull()
    expect(res!.status).toBe(400)
    const body = await res!.json()
    expect(body.error).toMatch(/Pièce/)
  })

  it('un garage ne peut pas s’approprier la ressource d’un autre', async () => {
    // Garage B tente d'utiliser un client du garage A.
    const res = await assertRelations('B', [{ model: 'client', id: 'c-A' }])
    expect(res!.status).toBe(400)
  })
})
