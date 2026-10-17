/**
 * /api/admin/diagnostics — la sonde de convergence post-rotation.
 *
 * Elle est le SEUL canal qui dise la vérité sur une variable Vercel :
 * `vercel env pull` rend « [SENSITIVE] », `vercel env run` charge les .env du
 * projet et les écrase. Ce que la porte de rotation refuse ou accepte se décide
 * donc entièrement ici — d'où ces tests.
 *
 * Deux invariants tiennent la route :
 *   · elle ne renvoie JAMAIS une valeur, ni un fragment de valeur ;
 *   · `invisiblesAfterTrim` distingue un caractère invisible SANS EFFET (retiré
 *     par le `.trim()` de tous ses lecteurs) d'un caractère invisible INTERNE,
 *     qui corrompt la valeur pour n'importe quel lecteur. Sans cette mesure, la
 *     porte ne peut que tout refuser en bloc — ce qui, le 2026-08-16, a bloqué
 *     un déploiement sain sur trois clés délibérément préservées et laissé la
 *     production sur un déploiement en panne.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'crypto'

const paire = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
const PUBLIC_PEM = paire.publicKey.export({ type: 'spki', format: 'pem' }) as string
const PRIVATE_PEM = paire.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
const AUTRE_PUBLIC_PEM = crypto
  .generateKeyPairSync('ec', { namedCurve: 'P-256' })
  .publicKey.export({ type: 'spki', format: 'pem' }) as string

const etat = vi.hoisted(() => ({ publicPem: '', limiterDown: false }))

vi.mock('@/lib/license/public-key', () => ({ getPublicKeyPem: () => etat.publicPem }))
vi.mock('@/lib/env', () => ({ validateEnv: () => ({ ok: true, issues: [] }) }))
vi.mock('@/lib/security/rate-limit', () => ({
  clientIpFrom: () => '127.0.0.1',
  enforceRateLimit: async () => etat.limiterDown ? ({ ok: false, degraded: 'fail_closed' }) : ({ ok: true }),
  rateLimitResponse: () => new Response('Service temporairement indisponible', { status: 503 }),
}))

import { GET } from '@/app/api/admin/diagnostics/route'

const CLE_API = 'a1b2c3d4'.repeat(8)
const BOM = '﻿'
const INSECABLE = ' '

type Variable = {
  name: string
  present: boolean
  length?: number
  firstCodePoint?: string
  trimChangesValue?: boolean
  invisibles?: string[]
  invisiblesAfterTrim?: string[]
  fingerprint?: string
}

async function interroger(cle: string | null = CLE_API) {
  const headers: Record<string, string> = {}
  if (cle !== null) headers['x-gf-key'] = cle
  const reponse = await (GET as unknown as (r: Request) => Promise<Response>)(
    new Request('http://127.0.0.1/api/admin/diagnostics', { headers }),
  )
  const corps = reponse.status === 200 ? await reponse.json() : null
  return { status: reponse.status, corps }
}

function variable(corps: { env: Variable[] }, nom: string): Variable {
  const trouvee = corps.env.find((v) => v.name === nom)
  if (!trouvee) throw new Error(`${nom} absente de la charge de diagnostic`)
  return trouvee
}

beforeEach(() => {
  etat.limiterDown = false
  etat.publicPem = PUBLIC_PEM
  process.env.GARAGEFLOW_API_KEY = CLE_API
  process.env.GF_PRIVATE_KEY = Buffer.from(PRIVATE_PEM, 'utf8').toString('base64')
  process.env.DATABASE_URL = 'postgresql://u:p@h/db?sslmode=require'
  process.env.GF_BACKUP_KEY = 'Y2xlLWRlLXNhdXZlZ2FyZGUtdHJlcy1mb3J0ZQ=='
  delete process.env.GF_TOTP_ENC_KEY
})

describe('contrôle d’accès', () => {
  it('sans en-tête x-gf-key : 403', async () => {
    expect((await interroger(null)).status).toBe(403)
  })

  it('avec une clé API erronée : 403', async () => {
    expect((await interroger('b'.repeat(64))).status).toBe(403)
  })

  it('avec la bonne clé : 200', async () => {
    expect((await interroger()).status).toBe(200)
  })

  it('serveur sans GARAGEFLOW_API_KEY exploitable : 500, jamais 200', async () => {
    process.env.GARAGEFLOW_API_KEY = 'trop-court'
    expect((await interroger()).status).toBe(500)
  })
})

describe('caractères invisibles — présence vs effet', () => {
  it('BOM de tête : signalé, mais neutralisé par trim()', async () => {
    process.env.GF_BACKUP_KEY = BOM + 'Y2xlLWRlLXNhdXZlZ2FyZGU='
    const { corps } = await interroger()
    const cle = variable(corps, 'GF_BACKUP_KEY')

    expect(cle.invisibles).toEqual(['U+FEFF'])
    expect(cle.firstCodePoint).toBe('U+FEFF')
    expect(cle.trimChangesValue).toBe(true)
    // Le cœur du sujet : rien ne survit au trim, donc la valeur utilisée par
    // backupKey() — qui lit `process.env.GF_BACKUP_KEY?.trim()` — est intacte.
    expect(cle.invisiblesAfterTrim).toEqual([])
  })

  it('invisible INTERNE : survit à trim(), donc la valeur est bel et bien corrompue', async () => {
    process.env.GF_BACKUP_KEY = 'Y2xlLWRl' + INSECABLE + 'c2F1dmVnYXJkZQ=='
    const { corps } = await interroger()
    const cle = variable(corps, 'GF_BACKUP_KEY')

    expect(cle.invisibles).toEqual(['U+00A0'])
    expect(cle.trimChangesValue).toBe(false)
    expect(cle.invisiblesAfterTrim).toEqual(['U+00A0'])
  })

  it('BOM de tête ET invisible interne : seul l’interne survit', async () => {
    process.env.GF_BACKUP_KEY = BOM + 'Y2xl' + INSECABLE + 'ZGU='
    const { corps } = await interroger()
    const cle = variable(corps, 'GF_BACKUP_KEY')

    expect(cle.invisibles).toEqual(expect.arrayContaining(['U+FEFF', 'U+00A0']))
    expect(cle.invisiblesAfterTrim).toEqual(['U+00A0'])
  })

  it('valeur propre : les deux listes sont vides', async () => {
    const { corps } = await interroger()
    const cle = variable(corps, 'GF_BACKUP_KEY')

    expect(cle.invisibles).toEqual([])
    expect(cle.invisiblesAfterTrim).toEqual([])
    expect(cle.trimChangesValue).toBe(false)
  })

  it('le champ existe même pour une valeur propre — son ABSENCE signifierait « sonde trop ancienne »', async () => {
    const { corps } = await interroger()
    for (const v of (corps as { env: Variable[] }).env.filter((e) => e.present)) {
      expect(Object.prototype.hasOwnProperty.call(v, 'invisiblesAfterTrim')).toBe(true)
    }
  })

  it('variable absente : présente=false, sans mesure trompeuse', async () => {
    const { corps } = await interroger()
    const totp = variable(corps, 'GF_TOTP_ENC_KEY')
    expect(totp.present).toBe(false)
    expect(totp.invisiblesAfterTrim).toBeUndefined()
  })
})

describe('convergence de la paire de licence', () => {
  it('clé publique embarquée et GF_PRIVATE_KEY de la même paire : converged', async () => {
    const { corps } = await interroger()
    expect(corps.licenseKey.converged).toBe(true)
    expect(corps.licenseKey.privateKeyError).toBeNull()
  })

  it('build sur une AUTRE clé publique : converged=false — toute licence émise serait refusée', async () => {
    etat.publicPem = AUTRE_PUBLIC_PEM
    const { corps } = await interroger()
    expect(corps.licenseKey.converged).toBe(false)
  })

  it('GF_PRIVATE_KEY illisible : converged=false, et l’erreur ne reflète rien de la clé', async () => {
    process.env.GF_PRIVATE_KEY = 'pas-une-cle'
    const { corps } = await interroger()
    expect(corps.licenseKey.converged).toBe(false)
    expect(corps.licenseKey.privateKeyError).toBe('illisible')
  })
})

describe('aucune valeur ne sort de cette route', () => {
  it('ni secret, ni fragment de secret, dans la charge complète', async () => {
    const secret = 'valeur-ultra-secrete-a-ne-jamais-divulguer'
    process.env.GF_BACKUP_KEY = secret
    process.env.NEXTAUTH_SECRET = secret
    const { corps } = await interroger()

    const serialise = JSON.stringify(corps)
    expect(serialise).not.toContain(secret)
    expect(serialise).not.toContain(secret.slice(0, 12))
    expect(serialise).not.toContain(CLE_API)
    expect(serialise).not.toContain(PRIVATE_PEM)
    // L'empreinte est bien là : c'est elle, et elle seule, qui prouve le transport.
    expect(variable(corps, 'GF_BACKUP_KEY').fingerprint).toMatch(/^[0-9A-F]{12}$/)
  })

  it('l’empreinte est salée par le NOM : deux variables de même valeur ne se confondent pas', async () => {
    const meme = 'meme-valeur-pour-les-deux'
    process.env.GF_BACKUP_KEY = meme
    process.env.NEXTAUTH_SECRET = meme
    const { corps } = await interroger()

    expect(variable(corps, 'GF_BACKUP_KEY').fingerprint)
      .not.toBe(variable(corps, 'NEXTAUTH_SECRET').fingerprint)
  })
})

it('panne du limiteur : 503 sans métadonnée sensible même avec une clé correcte', async () => {
  etat.limiterDown = true
  const { status, corps } = await interroger()
  expect(status).toBe(503)
  expect(corps).toBeNull()
})
