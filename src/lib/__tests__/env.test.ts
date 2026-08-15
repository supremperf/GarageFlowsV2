import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  validateEnv, assertEnv, upstashTimeoutMs,
  UPSTASH_TIMEOUT_DEFAUT_MS, UPSTASH_TIMEOUT_MIN_MS, UPSTASH_TIMEOUT_MAX_MS,
} from '@/lib/env'

const OLD = { ...process.env }
afterEach(() => {
  process.env = { ...OLD }
  vi.unstubAllEnvs()
})

describe('env — validation & fail-fast', () => {
  it('signale NEXTAUTH_SECRET faible et DATABASE_URL absente', () => {
    delete process.env.DATABASE_URL
    process.env.NEXTAUTH_SECRET = 'weak'
    const { ok, issues } = validateEnv()
    expect(ok).toBe(false)
    expect(issues.map((i) => i.name)).toContain('NEXTAUTH_SECRET')
    expect(issues.map((i) => i.name)).toContain('DATABASE_URL')
  })

  it('valide une configuration correcte', () => {
    process.env.DATABASE_URL = 'file:./dev.db'
    process.env.NEXTAUTH_SECRET = 'x'.repeat(40)
    expect(validateEnv().ok).toBe(true)
  })

  it('assertEnv LÈVE en production si invalide', () => {
    vi.stubEnv('NODE_ENV', 'production')
    delete process.env.DATABASE_URL
    process.env.NEXTAUTH_SECRET = 'weak'
    expect(() => assertEnv()).toThrow(/Démarrage refusé/)
  })

  it('assertEnv NE lève PAS en développement (avertit seulement)', () => {
    vi.stubEnv('NODE_ENV', 'development')
    delete process.env.DATABASE_URL
    process.env.NEXTAUTH_SECRET = 'weak'
    expect(() => assertEnv()).not.toThrow()
  })

  it("assertEnv ne lève jamais quand la config est valide, même en production", () => {
    vi.stubEnv('NODE_ENV', 'production')
    process.env.DATABASE_URL = 'postgresql://u:p@h:5432/db'
    process.env.NEXTAUTH_SECRET = 'x'.repeat(40)
    process.env.DEVICE_TOKEN_PEPPER = 'p'.repeat(40)
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io'
    process.env.UPSTASH_REDIS_REST_TOKEN = 't'.repeat(32)
    process.env.TRUST_PROXY_HEADERS = '1'
    expect(() => assertEnv()).not.toThrow()
  })
})

describe('env — garde-fou PWA production (PostgreSQL obligatoire)', () => {
  it('PWA production + SQLite (file:) = erreur bloquante', () => {
    vi.stubEnv('NODE_ENV', 'production')
    delete process.env.ELECTRON
    process.env.DATABASE_URL = 'file:./prod.db'
    process.env.NEXTAUTH_SECRET = 'x'.repeat(40)
    const { ok, issues } = validateEnv()
    expect(ok).toBe(false)
    expect(issues.some(i => i.name === 'DATABASE_URL' && /SQLite/.test(i.problem))).toBe(true)
    expect(() => assertEnv()).toThrow(/Démarrage refusé/)
  })

  // Le message ne doit PAS accuser SQLite quand le schéma est simplement
  // méconnaissable : c'est ce qui a fait chercher une base locale alors que la
  // production tournait sur PostgreSQL (incident du 15/08/2026).
  it('PWA production + URL au schéma non reconnu ≠ diagnostic SQLite', () => {
    vi.stubEnv('NODE_ENV', 'production')
    delete process.env.ELECTRON
    process.env.DATABASE_URL = 'mysql://u:p@h:3306/db'
    process.env.NEXTAUTH_SECRET = 'x'.repeat(40)
    const probleme = validateEnv().issues.find((i) => i.name === 'DATABASE_URL')?.problem ?? ''
    expect(probleme).toMatch(/schéma non reconnu/)
    expect(probleme).not.toMatch(/SQLite/)
    expect(probleme).toContain('mysql')
  })

  it('PWA production + URL PostgreSQL avec guillemets parasites : le schéma trahit la cause', () => {
    vi.stubEnv('NODE_ENV', 'production')
    delete process.env.ELECTRON
    process.env.DATABASE_URL = '"postgresql://u:p@h:5432/db"'
    process.env.NEXTAUTH_SECRET = 'x'.repeat(40)
    const probleme = validateEnv().issues.find((i) => i.name === 'DATABASE_URL')?.problem ?? ''
    expect(probleme).toMatch(/schéma non reconnu/)
    // Le guillemet est NOMMÉ par son point de code : U+0022. Un « ? » ne
    // distinguerait pas un guillemet d'une espace insécable ou d'une marque
    // d'ordre d'octets, invisibles dans une interface web.
    expect(probleme).toContain('U+0022postgresql')
    expect(probleme).not.toContain('u:p@h')
  })

  it('le diagnostic ne divulgue jamais hôte ni identifiants', () => {
    vi.stubEnv('NODE_ENV', 'production')
    delete process.env.ELECTRON
    process.env.DATABASE_URL = ' postgresql://utilisateur:motdepasse@hote-secret.example/base'
    process.env.NEXTAUTH_SECRET = 'x'.repeat(40)
    const probleme = validateEnv().issues.find((i) => i.name === 'DATABASE_URL')?.problem ?? ''
    for (const secret of ['utilisateur', 'motdepasse', 'hote-secret']) {
      expect(probleme).not.toContain(secret)
    }
  })

  it('PWA production + PostgreSQL + pepper + Upstash + proxy de confiance = accepté', () => {
    vi.stubEnv('NODE_ENV', 'production')
    delete process.env.ELECTRON
    process.env.DATABASE_URL = 'postgresql://u:p@h:5432/db'
    process.env.NEXTAUTH_SECRET = 'x'.repeat(40)
    process.env.DEVICE_TOKEN_PEPPER = 'p'.repeat(40)
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io'
    process.env.UPSTASH_REDIS_REST_TOKEN = 't'.repeat(32)
    process.env.TRUST_PROXY_HEADERS = '1'
    expect(validateEnv().ok).toBe(true)
  })

  it('PWA production sans signal de proxy de confiance (VERCEL/TRUST_PROXY_HEADERS) = refusé', () => {
    vi.stubEnv('NODE_ENV', 'production')
    delete process.env.ELECTRON
    delete process.env.VERCEL
    delete process.env.TRUST_PROXY_HEADERS
    process.env.DATABASE_URL = 'postgresql://u:p@h:5432/db'
    process.env.NEXTAUTH_SECRET = 'x'.repeat(40)
    process.env.DEVICE_TOKEN_PEPPER = 'p'.repeat(40)
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io'
    process.env.UPSTASH_REDIS_REST_TOKEN = 't'.repeat(32)
    const { ok, issues } = validateEnv()
    expect(ok).toBe(false)
    expect(issues.some((i) => i.name === 'TRUST_PROXY_HEADERS')).toBe(true)
  })

  it('PWA production avec VERCEL=1 (proxy géré Vercel) = accepté sans TRUST_PROXY_HEADERS', () => {
    vi.stubEnv('NODE_ENV', 'production')
    delete process.env.ELECTRON
    delete process.env.TRUST_PROXY_HEADERS
    process.env.VERCEL = '1'
    process.env.DATABASE_URL = 'postgresql://u:p@h:5432/db'
    process.env.NEXTAUTH_SECRET = 'x'.repeat(40)
    process.env.DEVICE_TOKEN_PEPPER = 'p'.repeat(40)
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io'
    process.env.UPSTASH_REDIS_REST_TOKEN = 't'.repeat(32)
    expect(validateEnv().ok).toBe(true)
  })

  it('Electron production + SQLite = autorisé (ELECTRON=1), sans pepper ni Upstash', () => {
    vi.stubEnv('NODE_ENV', 'production')
    process.env.ELECTRON = '1'
    process.env.DATABASE_URL = 'file:./garageflow.db'
    process.env.NEXTAUTH_SECRET = 'x'.repeat(40)
    delete process.env.DEVICE_TOKEN_PEPPER
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    expect(validateEnv().ok).toBe(true)
  })

  it('PWA production sans DEVICE_TOKEN_PEPPER = démarrage refusé', () => {
    vi.stubEnv('NODE_ENV', 'production')
    delete process.env.ELECTRON
    process.env.DATABASE_URL = 'postgresql://u:p@h:5432/db'
    process.env.NEXTAUTH_SECRET = 'x'.repeat(40)
    delete process.env.DEVICE_TOKEN_PEPPER
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io'
    process.env.UPSTASH_REDIS_REST_TOKEN = 't'.repeat(32)
    const { ok, issues } = validateEnv()
    expect(ok).toBe(false)
    expect(issues.some((i) => i.name === 'DEVICE_TOKEN_PEPPER')).toBe(true)
    expect(() => assertEnv()).toThrow(/Démarrage refusé/)
  })

  it('PWA production avec pepper générique (« changeme ») = refusé', () => {
    vi.stubEnv('NODE_ENV', 'production')
    delete process.env.ELECTRON
    process.env.DATABASE_URL = 'postgresql://u:p@h:5432/db'
    process.env.NEXTAUTH_SECRET = 'x'.repeat(40)
    process.env.DEVICE_TOKEN_PEPPER = 'changeme'
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io'
    process.env.UPSTASH_REDIS_REST_TOKEN = 't'.repeat(32)
    expect(validateEnv().ok).toBe(false)
  })

  it('PWA production + URL Upstash rediss:// (non REST) = refusé', () => {
    vi.stubEnv('NODE_ENV', 'production')
    delete process.env.ELECTRON
    process.env.VERCEL = '1'
    process.env.DATABASE_URL = 'postgresql://u:p@h:5432/db'
    process.env.NEXTAUTH_SECRET = 'x'.repeat(40)
    process.env.DEVICE_TOKEN_PEPPER = 'p'.repeat(40)
    process.env.UPSTASH_REDIS_REST_URL = 'rediss://default:token@host:6379'
    process.env.UPSTASH_REDIS_REST_TOKEN = 't'.repeat(32)
    const { ok, issues } = validateEnv()
    expect(ok).toBe(false)
    expect(issues.some((i) => i.name === 'UPSTASH_REDIS_REST_URL')).toBe(true)
  })

  it('PWA production sans Upstash = démarrage refusé (rate limiting distribué requis)', () => {
    vi.stubEnv('NODE_ENV', 'production')
    delete process.env.ELECTRON
    process.env.DATABASE_URL = 'postgresql://u:p@h:5432/db'
    process.env.NEXTAUTH_SECRET = 'x'.repeat(40)
    process.env.DEVICE_TOKEN_PEPPER = 'p'.repeat(40)
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    const { ok, issues } = validateEnv()
    expect(ok).toBe(false)
    expect(issues.some((i) => /UPSTASH/.test(i.name))).toBe(true)
  })
})

describe('env — délai Upstash configurable', () => {
  /** Configuration PWA production valide, délai laissé libre au test. */
  function pwaProduction() {
    vi.stubEnv('NODE_ENV', 'production')
    delete process.env.ELECTRON
    process.env.DATABASE_URL = 'postgresql://u:p@h:5432/db'
    process.env.NEXTAUTH_SECRET = 'x'.repeat(40)
    process.env.DEVICE_TOKEN_PEPPER = 'p'.repeat(40)
    process.env.UPSTASH_REDIS_REST_URL = 'https://exemple.upstash.io'
    process.env.UPSTASH_REDIS_REST_TOKEN = 't'.repeat(32)
    process.env.TRUST_PROXY_HEADERS = '1'
    delete process.env.UPSTASH_REDIS_TIMEOUT_MS
  }

  // LE test qui compte : rendre une valeur configurable ne doit rien changer
  // pour qui ne la configure pas. 1500 ms était la valeur codée en dur.
  it('absente : le délai reste EXACTEMENT celui d’avant (1500 ms)', () => {
    delete process.env.UPSTASH_REDIS_TIMEOUT_MS
    expect(upstashTimeoutMs()).toBe(1500)
    expect(UPSTASH_TIMEOUT_DEFAUT_MS).toBe(1500)
  })

  it('vide : traitée comme absente, sans erreur', () => {
    pwaProduction()
    process.env.UPSTASH_REDIS_TIMEOUT_MS = ''
    expect(upstashTimeoutMs()).toBe(UPSTASH_TIMEOUT_DEFAUT_MS)
    expect(validateEnv().ok).toBe(true)
  })

  it('valeur admise : elle est réellement appliquée', () => {
    pwaProduction()
    process.env.UPSTASH_REDIS_TIMEOUT_MS = '3000'
    expect(upstashTimeoutMs()).toBe(3000)
    expect(validateEnv().ok).toBe(true)
  })

  it('les bornes elles-mêmes sont admises', () => {
    pwaProduction()
    for (const v of [UPSTASH_TIMEOUT_MIN_MS, UPSTASH_TIMEOUT_MAX_MS]) {
      process.env.UPSTASH_REDIS_TIMEOUT_MS = String(v)
      expect(upstashTimeoutMs(), `borne ${v}`).toBe(v)
      expect(validateEnv().ok, `borne ${v}`).toBe(true)
    }
  })

  // §47 : une configuration erronée doit ÉCHOUER, pas être rognée en douce.
  // « 15000 » saisi pour « 1500 » ferait patienter dix fois trop longtemps
  // chaque requête critique avant le même refus.
  it('hors bornes en production PWA : démarrage REFUSÉ, pas rogné', () => {
    pwaProduction()
    for (const v of ['15000', '50', '0', '-1', 'abc', '1500ms', '1.5']) {
      process.env.UPSTASH_REDIS_TIMEOUT_MS = v
      const { ok, issues } = validateEnv()
      expect(ok, `valeur « ${v} » aurait dû être refusée`).toBe(false)
      expect(issues.some((i) => i.name === 'UPSTASH_REDIS_TIMEOUT_MS'), `valeur « ${v} »`).toBe(true)
      expect(() => assertEnv()).toThrow(/Démarrage refusé/)
    }
  })

  it('le message indique les bornes sans exiger de connaître le code', () => {
    pwaProduction()
    process.env.UPSTASH_REDIS_TIMEOUT_MS = '999999'
    const probleme = validateEnv().issues.find((i) => i.name === 'UPSTASH_REDIS_TIMEOUT_MS')?.problem ?? ''
    expect(probleme).toContain(String(UPSTASH_TIMEOUT_MIN_MS))
    expect(probleme).toContain(String(UPSTASH_TIMEOUT_MAX_MS))
    expect(probleme).toContain(String(UPSTASH_TIMEOUT_DEFAUT_MS))
  })

  // Hors production PWA (Electron, développement, tests), le démarrage n'est pas
  // bloqué : on retient alors le défaut plutôt qu'un délai absurde.
  it('hors production PWA : repli sur le défaut, sans blocage', () => {
    vi.stubEnv('NODE_ENV', 'production')
    process.env.ELECTRON = '1'
    process.env.UPSTASH_REDIS_TIMEOUT_MS = '999999'
    expect(upstashTimeoutMs()).toBe(UPSTASH_TIMEOUT_DEFAUT_MS)
  })
})
