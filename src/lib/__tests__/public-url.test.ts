import { describe, it, expect, afterEach } from 'vitest'
import { OFFICIAL_PUBLIC_APP_URL, isUsablePublicBase, publicAppUrl, publicUrlFor } from '../public-url'

// NEXT_PUBLIC_APP_URL reste dans la liste pour être RESTAURÉE proprement et
// pour prouver, plus bas, qu'elle n'a plus aucun effet : c'est un alias retiré
// le 15/08/2026, pas une variable oubliée.
const KEYS = ['NEXT_PUBLIC_APP_URL', 'GF_APP_URL', 'NEXTAUTH_URL'] as const
const saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]]))

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k] as string
  }
})

function clear() {
  for (const k of KEYS) delete process.env[k]
}

describe('isUsablePublicBase — rejet des origines non publiques', () => {
  const rejected = [
    'http://192.168.195.1:4028',
    'https://192.168.1.42',
    'http://10.0.0.5:4028',
    'https://172.16.4.9',
    'https://172.31.255.254',
    'http://localhost:4028',
    'https://localhost',
    'http://127.0.0.1:4028',
    'https://127.0.0.1',
    'https://[::1]',
    'https://169.254.10.10',           // APIPA (Hyper-V / WSL sans DHCP)
    'https://100.100.0.1',             // CGNAT
    'https://DESKTOP-4H2K1',           // hostname NetBIOS
    'https://garage-pc.local',         // mDNS
    'http://app.garageflows.fr',       // pas de HTTPS
    '',
    'pas-une-url',
  ]
  for (const c of rejected) {
    it(`rejette ${JSON.stringify(c)}`, () => expect(isUsablePublicBase(c)).toBe(false))
  }

  it('accepte le domaine public officiel', () => {
    expect(isUsablePublicBase('https://app.garageflows.fr')).toBe(true)
  })
})

describe('publicAppUrl — repli sur le domaine officiel', () => {
  it('sans variable d’environnement', () => {
    clear()
    expect(publicAppUrl()).toBe(OFFICIAL_PUBLIC_APP_URL)
  })

  it('sous Electron (NEXTAUTH_URL = http://localhost:4028)', () => {
    clear()
    process.env.NEXTAUTH_URL = 'http://localhost:4028'
    expect(publicAppUrl()).toBe('https://app.garageflows.fr')
  })

  it('avec une IP LAN injectée', () => {
    clear()
    process.env.GF_APP_URL = 'http://192.168.195.1:4028'
    process.env.NEXTAUTH_URL = 'http://localhost:4028'
    expect(publicAppUrl()).toBe('https://app.garageflows.fr')
  })

  it('honore un domaine public alternatif valide', () => {
    clear()
    process.env.GF_APP_URL = 'https://demo.garageflows.fr/'
    expect(publicAppUrl()).toBe('https://demo.garageflows.fr')
  })

  // Un alias retiré doit être INERTE, pas silencieusement honoré : sinon deux
  // noms continuent de désigner la même donnée et la garde de cohérence ne
  // protège plus rien.
  it('NEXT_PUBLIC_APP_URL, alias retiré, n’a plus AUCUN effet', () => {
    clear()
    process.env.NEXT_PUBLIC_APP_URL = 'https://alias-retire.example'
    expect(publicAppUrl()).toBe('https://app.garageflows.fr')
  })

  it('GF_APP_URL prime sur NEXTAUTH_URL quand les deux sont publiques', () => {
    clear()
    process.env.GF_APP_URL = 'https://canonique.garageflows.fr'
    process.env.NEXTAUTH_URL = 'https://next-auth.garageflows.fr'
    expect(publicAppUrl()).toBe('https://canonique.garageflows.fr')
  })
})

describe('publicUrlFor — lien portail client', () => {
  const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJ0eXAiOiJwb3J0YWwifQ.sig'

  it('pointe toujours sur la PWA officielle sous Electron', () => {
    clear()
    process.env.NEXTAUTH_URL = 'http://localhost:4028'
    const url = publicUrlFor(`/portal/${TOKEN}`)
    expect(url).toBe(`https://app.garageflows.fr/portal/${TOKEN}`)
    expect(url.startsWith('https://app.garageflows.fr/portal/')).toBe(true)
  })

  it('ne contient jamais d’adresse locale', () => {
    clear()
    process.env.NEXTAUTH_URL = 'http://192.168.195.1:4028'
    const url = publicUrlFor(`/portal/${TOKEN}`)
    for (const bad of ['192.168.', '10.', '172.16.', 'localhost', '127.0.0.1', ':4028']) {
      expect(url.includes(bad), `${url} contient ${bad}`).toBe(false)
    }
  })

  it('préserve le jeton à l’identique', () => {
    clear()
    expect(publicUrlFor(`/portal/${TOKEN}`).split('/portal/')[1]).toBe(TOKEN)
  })

  it('normalise un chemin sans slash initial', () => {
    clear()
    expect(publicUrlFor('portal/abc')).toBe('https://app.garageflows.fr/portal/abc')
  })
})
