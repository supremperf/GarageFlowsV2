/**
 * ADMINISTRATION DES LICENCES — trois défauts démontrés sur les VRAIES routes.
 *
 * Ces tests exercent `PATCH` et `DELETE /api/admin/licenses/[id]` avec le vrai
 * module `record-mac` et la vraie machine à états ; seule la base est simulée.
 *
 * ── 1. `revoked → active` était une écriture de champ ordinaire ──────────────
 * `data.status = body.status`, sans validation ni journal. Réactiver une licence
 * révoquée était indiscernable d'un changement de libellé : ni acteur, ni motif,
 * ni horodatage, ni confirmation.
 *
 * ── 2. `status` n'était typé qu'à la COMPILATION ─────────────────────────────
 * `req.json()` ne valide rien à l'exécution. `{"status":"Revoked"}` était
 * persisté tel quel PUIS scellé par un `recordMac` recalculé — donc « intègre ».
 * Or toute la chaîne de contrôle compare par égalité stricte : dans
 * `/api/license/check`, une telle valeur ne déclenche ni la branche `revoked`,
 * ni `suspended`, et retombe sur « still active » → `allowed:true`. La licence
 * s'affichait « Revoked » dans l'admin et ouvrait l'accès complet.
 *
 * ── 3. `DELETE` ressuscitait une licence révoquée ────────────────────────────
 * `/api/license/activate` interprète l'ABSENCE de ligne comme un premier usage
 * et la recrée avec `status:'active'`. Supprimer une licence révoquée la rendait
 * donc ACTIVE au prochain démarrage du poste — alors que
 * `/api/admin/licenses/revoke-by-key` pose justement une pierre tombale pour
 * empêcher exactement cela.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

process.env.GF_DB_MAC_SECRET = 'secret-de-test-machine-a-etats-licence'

interface Ligne {
  id: number
  licenseId: string
  token: string
  status: string
  expiryAt: Date
  hwid: string | null
  recordMac: string | null
  parentLicenseId: string | null
  mechanicId: string | null
  revokedAt: Date | null
  licenseType: string
}

const db = vi.hoisted(() => ({
  ligne: null as unknown,
  ecrits: [] as Record<string, unknown>[],
  supprimes: [] as unknown[],
  evenements: [] as Record<string, unknown>[],
  /** Simule une table d'audit indisponible (panne, migration en cours…). */
  auditEnPanne: false,
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    licenseKey: {
      findUnique: async () => db.ligne,
      update: async (a: { data: Record<string, unknown> }) => {
        db.ecrits.push(a.data)
        return { ...(db.ligne as Record<string, unknown>), ...a.data }
      },
      delete: async (a: unknown) => {
        db.supprimes.push(a)
        return db.ligne
      },
    },
    licenseDeviceEvent: {
      create: async (a: { data: Record<string, unknown> }) => {
        if (db.auditEnPanne) throw new Error('journal indisponible')
        db.evenements.push(a.data)
        return a.data
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const { prisma } = await import('@/lib/db')
      return fn(prisma)
    },
    $executeRaw: async () => 0,
  },
  isPostgresDatabase: () => false,
}))

vi.mock('@/lib/logger', () => ({ logger: { info: () => {}, warn: () => {}, error: () => {} } }))
// La session admin est réputée valide : ce n'est pas l'objet de ces tests.
vi.mock('@/lib/api-helpers', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  isAdminSession: async () => true,
}))

import { computeRecordMac } from '@/lib/license/record-mac'
import { PATCH, DELETE } from '@/app/api/admin/licenses/[id]/route'

const MOTIF = 'remise en service après régularisation du litige commercial'

function ligne(status: string): Ligne {
  const base = {
    id: 7,
    licenseId: 'lid-machine-etats',
    token: 'GF2.aaa.bbb.ccc',
    status,
    expiryAt: new Date('2099-01-01T00:00:00Z'),
    hwid: null,
    parentLicenseId: null,
    mechanicId: null,
    revokedAt: status === 'revoked' ? new Date('2026-01-01T00:00:00Z') : null,
    licenseType: 'premium',
  }
  return {
    ...base,
    recordMac: computeRecordMac({
      licenseId: base.licenseId,
      token: base.token,
      status: base.status,
      expiryAt: base.expiryAt,
      hwid: base.hwid,
    }),
  }
}

const patch = (corps: unknown) =>
  PATCH(
    new Request('http://localhost/api/admin/licenses/7', {
      method: 'PATCH',
      body: JSON.stringify(corps),
      headers: { 'content-type': 'application/json' },
    }) as never,
    { params: { id: '7' } },
  )

const supprimer = () =>
  DELETE(new Request('http://localhost/api/admin/licenses/7', { method: 'DELETE' }) as never, {
    params: { id: '7' },
  })

beforeEach(() => {
  db.ligne = null
  db.ecrits = []
  db.supprimes = []
  db.evenements = []
  db.auditEnPanne = false
})

/**
 * Le journal n'est pas un ornement : c'est ce qui rend une réactivation
 * vérifiable après coup. Les deux régimes sont donc DISSYMÉTRIQUES, et cette
 * dissymétrie doit être éprouvée — un test de mutation a montré qu'à ne
 * vérifier que la PRÉSENCE de l'événement, on pouvait déplacer l'écriture hors
 * de la transaction (donc perdre le fail-closed) sans qu'aucun test ne tombe.
 */
describe('journal — fail-closed sur les réactivations, best-effort sur les coupures', () => {
  it('journal indisponible → la RÉACTIVATION échoue et la licence reste révoquée', async () => {
    db.ligne = ligne('revoked')
    db.auditEnPanne = true
    const res = await patch({ status: 'active', confirmReactivation: true, reason: MOTIF })
    expect(res.status).toBe(500)
    // Le point décisif : aucune écriture de statut. Pas de trace, pas de réactivation.
    expect(db.ecrits).toHaveLength(0)
  })

  it('journal indisponible → la RÉVOCATION aboutit quand même', async () => {
    // Une table d'audit en panne ne doit jamais empêcher de couper un accès.
    db.ligne = ligne('active')
    db.auditEnPanne = true
    const res = await patch({ status: 'revoked' })
    expect(res.status).toBe(200)
    expect(db.ecrits).toHaveLength(1)
    expect(db.ecrits[0].status).toBe('revoked')
  })

  it('journal indisponible → la SUSPENSION aboutit quand même', async () => {
    db.ligne = ligne('active')
    db.auditEnPanne = true
    const res = await patch({ status: 'suspended' })
    expect(res.status).toBe(200)
    expect(db.ecrits).toHaveLength(1)
  })
})

describe('PATCH — une licence révoquée ne se réactive pas par une écriture ordinaire', () => {
  it('refuse `revoked → active` sans confirmation ni motif, et n\'écrit RIEN', async () => {
    db.ligne = ligne('revoked')
    const res = await patch({ status: 'active' })
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('REACTIVATION_REQUIRES_CONFIRMATION')
    // Le point qui compte : la base n'a pas bougé.
    expect(db.ecrits).toHaveLength(0)
  })

  it('refuse la confirmation SANS motif', async () => {
    db.ligne = ligne('revoked')
    const res = await patch({ status: 'active', confirmReactivation: true })
    expect(res.status).toBe(409)
    expect(db.ecrits).toHaveLength(0)
  })

  it('refuse le motif SANS confirmation', async () => {
    db.ligne = ligne('revoked')
    const res = await patch({ status: 'active', reason: MOTIF })
    expect(res.status).toBe(409)
    expect(db.ecrits).toHaveLength(0)
  })

  it('refuse `revoked → suspended`', async () => {
    db.ligne = ligne('revoked')
    const res = await patch({ status: 'suspended' })
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('REVOKED_IS_FINAL')
    expect(db.ecrits).toHaveLength(0)
  })

  it('accepte la réactivation ADMINISTRATIVE explicite et la journalise', async () => {
    db.ligne = ligne('revoked')
    const res = await patch({ status: 'active', confirmReactivation: true, reason: MOTIF })
    expect(res.status).toBe(200)
    expect(db.ecrits).toHaveLength(1)
    expect(db.ecrits[0].status).toBe('active')
    expect(db.ecrits[0].revokedAt).toBeNull()

    // Journal : acteur, horodatage, motif, transition.
    expect(db.evenements).toHaveLength(1)
    const ev = db.evenements[0]
    expect(ev.licenseId).toBe('lid-machine-etats')
    expect(ev.action).toBe('license_reactivated')
    const detail = JSON.parse(String(ev.detail))
    expect(detail.from).toBe('revoked')
    expect(detail.to).toBe('active')
    expect(detail.reason).toContain('régularisation')
    expect(typeof detail.at).toBe('string')
  })
})

describe('PATCH — validation d\'exécution du statut', () => {
  it('rejette une valeur hors énumération plutôt que de la persister', async () => {
    db.ligne = ligne('active')
    for (const mauvais of ['Revoked', 'REVOKED', 'revoked ', 'banana', 'expired', '', 42, null, {}]) {
      db.ecrits = []
      const res = await patch({ status: mauvais })
      expect(res.status, `statut ${JSON.stringify(mauvais)}`).toBe(400)
      expect((await res.json()).code).toBe('INVALID_STATUS')
      expect(db.ecrits, `statut ${JSON.stringify(mauvais)} ne doit rien écrire`).toHaveLength(0)
    }
  })

  it('une licence déjà porteuse d\'un statut inconnu ne peut pas être « réparée » en active', async () => {
    db.ligne = ligne('Revoked') // dégât possible avant l'ajout de la garde
    const res = await patch({ status: 'active', confirmReactivation: true, reason: MOTIF })
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('UNKNOWN_CURRENT_STATE')
    expect(db.ecrits).toHaveLength(0)
  })

  it('laisse passer les transitions ordinaires, en les journalisant', async () => {
    db.ligne = ligne('active')
    const res = await patch({ status: 'suspended' })
    expect(res.status).toBe(200)
    expect(db.ecrits).toHaveLength(1)
    expect(db.ecrits[0].status).toBe('suspended')
    expect(db.evenements).toHaveLength(1)
    expect(db.evenements[0].action).toBe('license_suspended')
  })

  it('une modification SANS statut (libellé seul) ne journalise aucune transition', async () => {
    db.ligne = ligne('active')
    const res = await patch({ label: 'Garage Dupont' })
    expect(res.status).toBe(200)
    expect(db.evenements).toHaveLength(0)
  })
})

describe('DELETE — supprimer une licence révoquée la ressusciterait', () => {
  it('refuse de supprimer une licence révoquée', async () => {
    db.ligne = ligne('revoked')
    const res = await supprimer()
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('REVOKED_CANNOT_BE_DELETED')
    expect(db.supprimes).toHaveLength(0)
  })

  it('refuse également pour une licence suspendue', async () => {
    // Même mécanisme : plus de ligne → `/api/license/activate` recrée en active,
    // la suspension est donc annulée par la suppression.
    db.ligne = ligne('suspended')
    const res = await supprimer()
    expect(res.status).toBe(409)
    expect(db.supprimes).toHaveLength(0)
  })

  it('refuse pour un statut inconnu (on ne sait pas ce qu\'on efface)', async () => {
    db.ligne = ligne('Revoked')
    const res = await supprimer()
    expect(res.status).toBe(409)
    expect(db.supprimes).toHaveLength(0)
  })

  it('autorise la suppression d\'une licence active (retrait du registre)', async () => {
    db.ligne = ligne('active')
    const res = await supprimer()
    expect(res.status).toBe(200)
    expect(db.supprimes).toHaveLength(1)
  })

  it('404 si la licence n\'existe pas', async () => {
    db.ligne = null
    const res = await supprimer()
    expect(res.status).toBe(404)
    expect(db.supprimes).toHaveLength(0)
  })
})
