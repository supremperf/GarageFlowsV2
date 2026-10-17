/**
 * CONTRAT KEYGEN (Python) ↔ API LICENCES (TypeScript).
 *
 * Le Keygen est un outil séparé, écrit dans un autre langage, non couvert par
 * `tsc`. Renommer une route ou un champ côté backend ne casse donc RIEN à la
 * compilation : la divergence n'apparaît qu'au moment où un opérateur tente
 * d'enregistrer une clé, en production.
 *
 * Ce test lit le source Python et vérifie que chaque appel qu'il contient a
 * toujours une contrepartie réelle côté API.
 *
 * MATRICE VÉRIFIÉE
 * ┌──────────────────────────┬─────────────────────────────────────┬────────┬──────────┬─────────────────────────────┐
 * │ ACTION                   │ ENDPOINT                            │ METHOD │ AUTH     │ REQUEST                     │
 * ├──────────────────────────┼─────────────────────────────────────┼────────┼──────────┼─────────────────────────────┤
 * │ enregistrer une licence  │ /api/admin/licenses/create          │ POST   │ x-gf-key │ { token }                   │
 * │ (garage ET mécanicien)   │                                     │        │          │ → 201, 409 = déjà enregistré│
 * │ révoquer / suspendre /   │ /api/admin/licenses/revoke-by-key   │ POST   │ x-gf-key │ { licenseId, status }       │
 * │ réactiver                │                                     │        │          │                             │
 * │ test de connexion        │ /api/admin/licenses/revoke-by-key   │ POST   │ x-gf-key │ { licenseId:'__test_ping__',│
 * │                          │                                     │        │          │   status:'active' }         │
 * └──────────────────────────┴─────────────────────────────────────┴────────┴──────────┴─────────────────────────────┘
 *
 * `seats`, `hwid`, `plid` (parent mécanicien), `exp` et `typ` ne circulent PAS
 * comme champs de requête : ils sont lus du jeton SIGNÉ côté serveur, ce qui
 * rend impossible l'enregistrement d'une licence forgée. Aucun endpoint
 * d'activation/heartbeat n'est appelé par le Keygen — ils appartiennent au
 * poste, pas au générateur de clés.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import path from 'path'

const ROOT = path.resolve(__dirname, '../../../..')
const KEYGEN_UI = path.join(ROOT, 'scripts', 'keygen_ui.py')

let python = ''
beforeAll(() => { python = readFileSync(KEYGEN_UI, 'utf8') })

/** Chemin du fichier de route Next.js pour un endpoint `/api/...`. */
function routeFileFor(endpoint: string): string {
  return path.join(ROOT, 'src', 'app', ...endpoint.split('/').filter(Boolean), 'route.ts')
}

function routeSource(endpoint: string): string {
  const file = routeFileFor(endpoint)
  expect(existsSync(file), `route absente pour ${endpoint} (${file})`).toBe(true)
  return readFileSync(file, 'utf8')
}

/** Tous les endpoints /api/... littéraux présents dans le source Python. */
function endpointsUsedByKeygen(): string[] {
  const found = new Set<string>()
  Array.from(python.matchAll(/["'](\/api\/[A-Za-z0-9/_-]+)["']/g)).forEach(m => found.add(m[1]))
  return Array.from(found).sort()
}

describe('Endpoints appelés par le Keygen', () => {
  it('n’appelle que des routes qui existent réellement', () => {
    const endpoints = endpointsUsedByKeygen()
    // Garde-fou : si l'extraction ne trouve plus rien, le test ne vérifie plus
    // rien — on échoue plutôt que de devenir silencieusement inutile.
    expect(endpoints.length).toBeGreaterThan(0)
    for (const endpoint of endpoints) {
      expect(existsSync(routeFileFor(endpoint)), `endpoint obsolète : ${endpoint}`).toBe(true)
    }
  })

  it('correspond exactement à la matrice documentée', () => {
    expect(endpointsUsedByKeygen()).toEqual([
      '/api/admin/licenses/create',
      '/api/admin/licenses/revoke-by-key',
    ])
  })

  it('chaque route ciblée est authentifiée ou explicitement retirée', () => {
    for (const endpoint of endpointsUsedByKeygen()) {
      const src = routeSource(endpoint)
      expect(src, `${endpoint} doit exposer POST`).toMatch(/export async function POST|export const POST/)
      if (endpoint.endsWith('/revoke-by-key')) expect(src).toContain('ENDPOINT_DISABLED')
      else expect(src, `${endpoint} doit authentifier par x-gf-key`).toContain('x-gf-key')
    }
  })

  it('le Keygen envoie bien l’en-tête d’authentification attendu', () => {
    expect(python).toContain('"x-gf-key"')
  })
})

describe('POST /api/admin/licenses/create', () => {
  it('reçoit le champ `token` que le Keygen envoie', () => {
    expect(python).toMatch(/_json\.dumps\(\{"token": token\}\)/)
    expect(routeSource('/api/admin/licenses/create')).toMatch(/body\.token/)
  })

  it('vérifie le jeton cryptographiquement (licence forgée impossible)', () => {
    expect(routeSource('/api/admin/licenses/create')).toContain('verifyLicenseToken')
  })

  it('409 = déjà enregistrée, traité comme un succès par le Keygen', () => {
    expect(routeSource('/api/admin/licenses/create')).toMatch(/alreadyRegistered/)
    expect(python).toMatch(/e\.code == 409[\s\S]{0,120}return True/)
  })
})

describe('POST /api/admin/licenses/revoke-by-key — retiré', () => {
  it('ne traite plus de corps ni de transition authentifiée par clé partagée', () => {
    const src = routeSource('/api/admin/licenses/revoke-by-key')
    expect(src).toContain('ENDPOINT_DISABLED')
    expect(src).not.toContain('prisma.')
    expect(src).not.toContain('body.licenseId')
  })
})

describe('Périmètre du Keygen', () => {
  it('n’appelle aucun endpoint d’exécution du poste (activate/check/heartbeat)', () => {
    // Ces routes appartiennent au poste licencié, pas au générateur de clés :
    // les appeler depuis le Keygen signalerait une confusion de rôles.
    for (const forbidden of ['/api/license/activate', '/api/license/check', '/api/license/status']) {
      expect(endpointsUsedByKeygen()).not.toContain(forbidden)
    }
  })
})
