/**
 * `attachLicenseToGarage` — le rattachement licence ↔ garage sur le poste.
 *
 * LE DÉFAUT QU'IL VERROUILLE (mesuré le 2026-08-16 sur un poste packagé).
 * Sous Electron, `licenseEnforcementEnabled()` rend `false` — à bon droit : la
 * licence y est déjà contrôlée par la fenêtre native. Mais le rattachement au
 * garage ne vivait QUE dans `validateLicensedSession`, donc dans ce chemin
 * désactivé : `LicenseKey.garageId` restait `null` définitivement. Or
 * `garageLicenseToken()` cherche la licence PAR garageId — la remontée vers
 * l'espace mécanicien sortait aussitôt en `NO_GARAGE_LICENSE` et ne partait
 * JAMAIS, l'écran du comptoir affichant « Synchronisation cloud en attente »
 * sans fin.
 *
 * Ce que ces tests fixent : le rattachement a bien lieu, et il ne devient
 * jamais un contrôle d'accès déguisé — il ne refuse rien, ne lève rien, et
 * n'écrase jamais un rattachement existant.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SignJWT } from 'jose'

const SECRET = 'secret-de-test-pour-la-session-de-licence-0123456789'

const etat = vi.hoisted(() => ({
  licences: [] as Record<string, unknown>[],
  updates: [] as { where: Record<string, unknown>; data: Record<string, unknown> }[],
  leverSurLecture: false,
}))

vi.mock('@/lib/auth-secret', () => ({ getAuthSecret: () => SECRET }))
vi.mock('@/lib/db', () => ({
  prisma: {
    licenseKey: {
      findUnique: async ({ where }: { where: { licenseId: string } }) => {
        if (etat.leverSurLecture) throw new Error('base indisponible')
        return etat.licences.find((l) => l.licenseId === where.licenseId) ?? null
      },
      updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        etat.updates.push(args)
        const cible = etat.licences.find(
          (l) => l.licenseId === args.where.licenseId && l.garageId === (args.where.garageId ?? null),
        )
        if (!cible) return { count: 0 }
        Object.assign(cible, args.data)
        return { count: 1 }
      },
    },
  },
}))

import { attachLicenseToGarage } from '@/lib/license/session'

async function cookieSession(payload: Record<string, unknown>): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(SECRET))
}

function licence(over: Record<string, unknown> = {}) {
  return {
    licenseId: 'LID-1',
    garageId: null,
    status: 'active',
    licenseType: 'premium',
    ...over,
  }
}

beforeEach(() => {
  etat.licences = [licence()]
  etat.updates = []
  etat.leverSurLecture = false
})

describe('rattachement au premier usage', () => {
  it('rattache une licence encore libre au garage de la session', async () => {
    const raw = await cookieSession({ lid: 'LID-1', did: 'DEV-1', typ: 'premium' })
    await attachLicenseToGarage({ rawGfSession: raw, garageId: 'GARAGE-A' })

    expect(etat.licences[0].garageId).toBe('GARAGE-A')
  })

  it('la garde de concurrence porte sur garageId: null — jamais un écrasement aveugle', async () => {
    const raw = await cookieSession({ lid: 'LID-1', typ: 'premium' })
    await attachLicenseToGarage({ rawGfSession: raw, garageId: 'GARAGE-A' })

    expect(etat.updates).toHaveLength(1)
    expect(etat.updates[0].where).toMatchObject({ licenseId: 'LID-1', garageId: null })
  })

  it('n’écrase JAMAIS un rattachement existant, même vers un autre garage', async () => {
    etat.licences = [licence({ garageId: 'GARAGE-DEJA-LIE' })]
    const raw = await cookieSession({ lid: 'LID-1', typ: 'premium' })
    await attachLicenseToGarage({ rawGfSession: raw, garageId: 'GARAGE-B' })

    expect(etat.licences[0].garageId).toBe('GARAGE-DEJA-LIE')
    expect(etat.updates).toHaveLength(0)
  })

  it('est idempotent : deux appels ne produisent qu’un seul rattachement', async () => {
    const raw = await cookieSession({ lid: 'LID-1', typ: 'premium' })
    await attachLicenseToGarage({ rawGfSession: raw, garageId: 'GARAGE-A' })
    await attachLicenseToGarage({ rawGfSession: raw, garageId: 'GARAGE-A' })

    expect(etat.licences[0].garageId).toBe('GARAGE-A')
    expect(etat.updates).toHaveLength(1)
  })
})

describe('ce qui ne doit JAMAIS être rattaché par cette voie', () => {
  it('une session MÉCANICIEN : une clé mécanicien ne licencie pas le garage', async () => {
    const raw = await cookieSession({ lid: 'LID-1', typ: 'mechanic' })
    await attachLicenseToGarage({ rawGfSession: raw, garageId: 'GARAGE-A' })

    expect(etat.licences[0].garageId).toBeNull()
    expect(etat.updates).toHaveLength(0)
  })

  it('une licence de type mechanic en BASE, même si le cookie prétend le contraire', async () => {
    etat.licences = [licence({ licenseType: 'mechanic' })]
    const raw = await cookieSession({ lid: 'LID-1', typ: 'premium' })
    await attachLicenseToGarage({ rawGfSession: raw, garageId: 'GARAGE-A' })

    expect(etat.licences[0].garageId).toBeNull()
    expect(etat.updates).toHaveLength(0)
  })

  it('une licence inconnue en base', async () => {
    const raw = await cookieSession({ lid: 'LID-ABSENTE', typ: 'premium' })
    await attachLicenseToGarage({ rawGfSession: raw, garageId: 'GARAGE-A' })

    expect(etat.updates).toHaveLength(0)
  })
})

describe('ne refuse rien, ne lève jamais', () => {
  it('cookie absent : sans effet, sans exception', async () => {
    await expect(attachLicenseToGarage({ rawGfSession: '', garageId: 'GARAGE-A' })).resolves.toBeUndefined()
    expect(etat.updates).toHaveLength(0)
  })

  it('cookie signé par un AUTRE secret : ignoré, sans exception', async () => {
    const usurpe = await new SignJWT({ lid: 'LID-1', typ: 'premium' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('un-tout-autre-secret-qui-ne-vaut-rien-ici'))

    await expect(attachLicenseToGarage({ rawGfSession: usurpe, garageId: 'GARAGE-A' })).resolves.toBeUndefined()
    expect(etat.licences[0].garageId).toBeNull()
  })

  it('garageId vide : sans effet', async () => {
    const raw = await cookieSession({ lid: 'LID-1', typ: 'premium' })
    await attachLicenseToGarage({ rawGfSession: raw, garageId: '' })

    expect(etat.updates).toHaveLength(0)
  })

  it('base indisponible : l’application doit continuer de servir', async () => {
    etat.leverSurLecture = true
    const raw = await cookieSession({ lid: 'LID-1', typ: 'premium' })

    await expect(attachLicenseToGarage({ rawGfSession: raw, garageId: 'GARAGE-A' })).resolves.toBeUndefined()
  })
})
