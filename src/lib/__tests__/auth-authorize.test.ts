/**
 * Tests de CredentialsProvider.authorize() (src/lib/auth.ts).
 *
 * Couvre les cas exigés par la mission (§4.3, §17) sans BD réelle : prisma est
 * simulé ; bcrypt est RÉEL (hash de référence calculé au démarrage) pour tester
 * le vrai chemin de vérification. Prouve que :
 *  - identifiants absents / utilisateur inexistant / mauvais mot de passe → null
 *    (échec d'auth normal, JAMAIS de 500) ;
 *  - une erreur d'infrastructure (BD indisponible) est RELEVÉE (non masquée en
 *    « identifiants invalides ») ;
 *  - un utilisateur sans garage rattaché → null (garde défensive, pas de crash) ;
 *  - un succès renvoie l'objet utilisateur attendu (id, role, garage*).
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import bcrypt from 'bcryptjs'

process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'x'.repeat(48)

const findUnique = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db', () => ({ prisma: { user: { findUnique } } }))

import { authOptions } from '@/lib/auth'

// Récupère authorize() du CredentialsProvider (next-auth v4). ATTENTION :
// provider.authorize est un stub interne « () => null » ; la vraie fonction est
// dans provider.options.authorize.
const provider = authOptions.providers[0] as any
const authorize: (creds: any) => Promise<any> = provider.options.authorize

let validUser: Record<string, unknown>

beforeAll(async () => {
  const password = await bcrypt.hash('bonMotDePasse', 4) // coût faible = tests rapides
  validUser = {
    id: 'u1',
    email: 'jean@garage.fr',
    name: 'Jean',
    password,
    role: 'OWNER',
    garageId: 'g1',
    garage: { name: 'Garage Jean', slug: 'garage-jean' },
  }
})

beforeEach(() => {
  findUnique.mockReset()
})

describe('authorize() — chemins d\'échec (jamais de 500, jamais de session indue)', () => {
  it('identifiants absents → null (sans toucher la BD)', async () => {
    expect(await authorize({ email: '', password: '' })).toBeNull()
    expect(await authorize({ email: 'a@b.fr' })).toBeNull()
    expect(findUnique).not.toHaveBeenCalled()
  })

  it('utilisateur inexistant → null', async () => {
    findUnique.mockResolvedValue(null)
    expect(await authorize({ email: 'ghost@x.fr', password: 'p' })).toBeNull()
  })

  it('mauvais mot de passe → null', async () => {
    findUnique.mockResolvedValue(validUser)
    expect(await authorize({ email: 'jean@garage.fr', password: 'mauvais' })).toBeNull()
  })

  it('utilisateur sans garage rattaché → null (garde défensive, pas de crash)', async () => {
    findUnique.mockResolvedValue({ ...validUser, garage: null })
    expect(await authorize({ email: 'jean@garage.fr', password: 'bonMotDePasse' })).toBeNull()
  })

  it('erreur BD (indisponibilité) → RELEVÉE, non masquée en identifiants invalides', async () => {
    findUnique.mockRejectedValue(new Error('ECONNREFUSED'))
    await expect(authorize({ email: 'jean@garage.fr', password: 'bonMotDePasse' })).rejects.toThrow(
      /AUTH_INFRA_ERROR/,
    )
  })
})

describe('authorize() — succès', () => {
  it('identifiants valides → objet utilisateur (id, role, garage*), email en minuscules', async () => {
    findUnique.mockResolvedValue(validUser)
    const res = await authorize({ email: 'JEAN@garage.fr', password: 'bonMotDePasse' })
    expect(res).toEqual({
      id: 'u1',
      email: 'jean@garage.fr',
      name: 'Jean',
      role: 'OWNER',
      garageId: 'g1',
      garageName: 'Garage Jean',
      garageSlug: 'garage-jean',
    })
    // La recherche s'est faite sur l'email normalisé en minuscules.
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'jean@garage.fr' } }),
    )
  })
})
