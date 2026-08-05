/**
 * Fondation « facturation électronique » : flags OFF par défaut, catalogue +
 * recherche, registre d'adaptateurs VIDE (aucun faux connecteur), chiffrement
 * AES-256-GCM des identifiants (aller-retour + détection d'altération).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getEInvoicingFlags } from '../flags'
import { normalizePlatformSearch, searchPlatforms, isPlatformConnectable, EINVOICE_PLATFORM_CATALOG, type ApprovedEInvoicePlatform } from '../catalog'
import { EInvoiceAdapterRegistry, einvoiceAdapterRegistry, type EInvoiceProviderAdapter } from '../adapter'
import { encryptCredential, decryptCredential, envelopeKeyVersion, isCredentialKeyConfigured, EInvoiceCipherError } from '../credentials-cipher'

describe('flags — désactivé par défaut', () => {
  const saved = { ...process.env }
  beforeEach(() => {
    for (const k of Object.keys(process.env)) if (k.startsWith('EINVOICING_')) delete process.env[k]
  })
  afterEach(() => { process.env = { ...saved } })

  it('tout OFF par défaut, sandbox forcé, catalogue visible', () => {
    const f = getEInvoicingFlags()
    expect(f.enabled).toBe(false)
    expect(f.connectionsEnabled).toBe(false)
    expect(f.outgoingEnabled).toBe(false)
    expect(f.sandboxOnly).toBe(true)
    expect(f.defaultEnvironment).toBe('sandbox')
    expect(f.providerCatalogEnabled).toBe(true)
  })

  it('les sous-fonctions restent OFF si le maître est OFF', () => {
    process.env.EINVOICING_OUTGOING_ENABLED = 'true'
    process.env.EINVOICING_CONNECTIONS_ENABLED = 'true'
    const f = getEInvoicingFlags()
    expect(f.enabled).toBe(false)
    expect(f.outgoingEnabled).toBe(false)
    expect(f.connectionsEnabled).toBe(false)
  })

  it('sandboxOnly force sandbox même si production demandé', () => {
    process.env.EINVOICING_ENABLED = 'true'
    process.env.EINVOICING_SANDBOX_ONLY = 'true'
    process.env.EINVOICING_DEFAULT_ENVIRONMENT = 'production'
    expect(getEInvoicingFlags().defaultEnvironment).toBe('sandbox')
  })

  it('production possible uniquement si sandboxOnly=false', () => {
    process.env.EINVOICING_ENABLED = 'true'
    process.env.EINVOICING_SANDBOX_ONLY = 'false'
    process.env.EINVOICING_DEFAULT_ENVIRONMENT = 'production'
    expect(getEInvoicingFlags().defaultEnvironment).toBe('production')
  })
})

describe('catalogue — recherche insensible casse/accents, tri alpha', () => {
  it('normalise accents et casse', () => {
    expect(normalizePlatformSearch('  ÉlÉctro  ')).toBe('electro')
  })
  it('« aze » retourne Azer', () => {
    const r = searchPlatforms('aze')
    expect(r[0]?.officialName).toBe('Azer')
  })
  it('« a » place EN TÊTE les entrées commençant par A, triées (puis les autres)', () => {
    const r = searchPlatforms('a')
    const startsA = r.filter((p) => p.normalizedName.startsWith('a')).map((p) => p.normalizedName)
    expect(startsA.length).toBeGreaterThanOrEqual(3)
    // le groupe « commence par a » est en tête du résultat…
    expect(r.slice(0, startsA.length).map((p) => p.normalizedName)).toEqual(startsA)
    // …et il est trié alphabétiquement.
    expect([...startsA].sort((a, b) => a.localeCompare(b, 'fr'))).toEqual(startsA)
  })
  it('requête vide → tout, trié alphabétiquement', () => {
    const r = searchPlatforms('')
    expect(r.length).toBe(EINVOICE_PLATFORM_CATALOG.length)
  })
  it('aucune plateforme du seed n’est connectable (pas d’adaptateur)', () => {
    for (const p of EINVOICE_PLATFORM_CATALOG) {
      expect(isPlatformConnectable(p, () => false)).toBe(false)
    }
  })
})

describe('registre d’adaptateurs — vide par défaut', () => {
  it('le registre global ne contient AUCUN connecteur', () => {
    expect(einvoiceAdapterRegistry.listAvailableAdapters()).toHaveLength(0)
    expect(einvoiceAdapterRegistry.hasAdapter('nimporte')).toBe(false)
    expect(() => einvoiceAdapterRegistry.getAdapter('nimporte')).toThrow()
  })
  it('register/get/list fonctionnent', () => {
    const reg = new EInvoiceAdapterRegistry()
    const stub = { providerId: 'p1', displayName: 'P1', mapProviderStatus: () => 'unknown' } as unknown as EInvoiceProviderAdapter
    reg.register(stub)
    expect(reg.hasAdapter('p1')).toBe(true)
    expect(reg.getAdapter('p1')).toBe(stub)
    expect(reg.listAvailableAdapters()).toHaveLength(1)
  })
})

describe('chiffrement des identifiants (AES-256-GCM)', () => {
  const saved = process.env.GF_EINVOICE_CREDENTIALS_KEY
  beforeEach(() => { process.env.GF_EINVOICE_CREDENTIALS_KEY = Buffer.alloc(32, 7).toString('base64') })
  afterEach(() => { if (saved === undefined) delete process.env.GF_EINVOICE_CREDENTIALS_KEY; else process.env.GF_EINVOICE_CREDENTIALS_KEY = saved })

  it('aller-retour : déchiffrer(chiffrer(x)) == x', () => {
    const secret = 'client_secret_très-sensible_éàü'
    const env = encryptCredential(secret)
    expect(env.startsWith('gfeic1.')).toBe(true)
    expect(env).not.toContain(secret) // jamais en clair dans l’enveloppe
    expect(decryptCredential(env)).toBe(secret)
  })
  it('la version de clé est encodée dans l’enveloppe', () => {
    process.env.GF_EINVOICE_CREDENTIALS_KEY_VERSION = '3'
    expect(envelopeKeyVersion(encryptCredential('x'))).toBe(3)
    delete process.env.GF_EINVOICE_CREDENTIALS_KEY_VERSION
  })
  it('altération détectée (GCM tag)', () => {
    const env = encryptCredential('données')
    const parts = env.split('.')
    parts[4] = Buffer.from('falsifie').toString('base64url')
    expect(() => decryptCredential(parts.join('.'))).toThrow(EInvoiceCipherError)
  })
  it('mauvaise clé → échec de déchiffrement (pas de fuite)', () => {
    const env = encryptCredential('données')
    process.env.GF_EINVOICE_CREDENTIALS_KEY = Buffer.alloc(32, 9).toString('base64')
    expect(() => decryptCredential(env)).toThrow(EInvoiceCipherError)
  })
  it('clé absente → indisponible (jamais de valeur par défaut)', () => {
    delete process.env.GF_EINVOICE_CREDENTIALS_KEY
    expect(isCredentialKeyConfigured()).toBe(false)
    expect(() => encryptCredential('x')).toThrow(EInvoiceCipherError)
  })
})
