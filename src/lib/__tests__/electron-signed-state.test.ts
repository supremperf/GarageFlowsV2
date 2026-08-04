import { describe, it, expect } from 'vitest'

// Module CommonJS du process Electron (état de licence local signé).
const { sign, verify } = require('../../../electron/signed-state.js')

const SECRET = 'install-secret-très-long-et-aléatoire-0123456789'
const HWID = 'HWID-ABC-123'

describe('signed-state — anti-altération de l\'état de licence local', () => {
  it('round-trip : sign puis verify rend le payload d\'origine', () => {
    const raw = sign({ ts: 1700000000000 }, SECRET, HWID)
    expect(verify(raw, SECRET, HWID)).toEqual({ ts: 1700000000000 })
  })

  it('rejette une valeur ÉDITÉE À LA MAIN (JSON clair sans MAC)', () => {
    // Ce que ferait un utilisateur qui « prolonge » sa grâce en éditant le fichier.
    const handEdited = JSON.stringify({ ts: Date.now() + 10 * 365 * 24 * 3600_000 })
    expect(verify(handEdited, SECRET, HWID)).toBeNull()
  })

  it('rejette un payload falsifié (MAC ne correspond plus)', () => {
    const raw = sign({ ts: 1000 }, SECRET, HWID)
    const obj = JSON.parse(raw)
    obj.payload.ts = 9_999_999_999_999 // on change la valeur sans recalculer le MAC
    expect(verify(JSON.stringify(obj), SECRET, HWID)).toBeNull()
  })

  it('rejette un fichier copié d\'une AUTRE machine (hwid différent)', () => {
    const raw = sign({ ts: 1000 }, SECRET, 'HWID-OTHER-MACHINE')
    expect(verify(raw, SECRET, HWID)).toBeNull()
  })

  it('rejette avec un mauvais secret d\'installation', () => {
    const raw = sign({ ts: 1000 }, SECRET, HWID)
    expect(verify(raw, 'un-autre-secret-installation-9876543210', HWID)).toBeNull()
  })

  it('rejette une entrée illisible / vide', () => {
    expect(verify('pas du json', SECRET, HWID)).toBeNull()
    expect(verify('', SECRET, HWID)).toBeNull()
  })

  it('lie à l\'appareil : le même payload signé pour un hwid ne vaut pas pour un autre', () => {
    const forA = sign({ wall: 42 }, SECRET, 'HWID-A')
    expect(verify(forA, SECRET, 'HWID-A')).toEqual({ wall: 42 })
    expect(verify(forA, SECRET, 'HWID-B')).toBeNull()
  })
})
